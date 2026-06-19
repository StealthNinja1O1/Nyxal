import type { Message } from "discord.js";
import { ActivityType } from "discord.js";
import type { PresenceStatusData, Client } from "discord.js";
import type { BotRuntimeConfig } from "../config/botConfig";
import type { LlmCreds } from "./api/llm";
import type { RuntimeCharacter, ChatMemoryBook, ImageAttachment } from "./types";
import type { Logger } from "./utils/logger";
import { makeTokenCounter } from "./utils/tokenCounter";
import { CommandMetadataStore } from "./stores/commandMetadataStore";
import { upsertMemoryEntry } from "./stores/memoryStore";
import { buildRegistry, availableCommands, recursiveCommandNames } from "./commands";
import type { CommandRegistry, CommandExecutionContext } from "./commands";
import { CommandHandler } from "./commands/CommandHandler";
import { MessageQueue } from "./MessageQueue";
import { DiscordJsClient } from "./adapter/DiscordJsClient";
import type { DiscordClient } from "./adapter/DiscordClient";
import { generateAIResponse, type PromptDeps } from "./prompt";
import { runResponsePipeline } from "./utils/responsePipeline";
import { MessageResponseContext } from "./utils/ResponseContexts";
import { fetchReferencedMessage, extractImagesFromMessage, extractStickerImagesFromMessage } from "./history";

export interface DiscordBotOptions {
  config: BotRuntimeConfig;
  character: RuntimeCharacter;
  chatMemoryBook: ChatMemoryBook;
  log: Logger;
}

export class DiscordBot {
  config: BotRuntimeConfig;
  private character: RuntimeCharacter;
  private chatMemoryBook: ChatMemoryBook;
  readonly log: Logger;
  readonly tokens: ReturnType<typeof makeTokenCounter>;
  readonly metadataStore: CommandMetadataStore;
  readonly registry: CommandRegistry = buildRegistry();
  recursiveNames: string[];
  availableCommands: Record<string, unknown>[];
  readonly creds: LlmCreds;
  readonly deps: PromptDeps;

  private client: DiscordClient;
  private commandHandler: CommandHandler;
  private messageQueue: MessageQueue;

  // runtime state
  private randomResponsesEnabled = true;
  private runtimeEnabled = true;
  private messageCounter = 0;
  private isBusy = new Map<string, boolean>();
  private lastResponseTimestamp = new Map<string, number>();
  botDiscordId: string | null = null;

  constructor(opts: DiscordBotOptions) {
    this.config = opts.config;
    this.character = opts.character;
    this.chatMemoryBook = opts.chatMemoryBook;
    this.log = opts.log;
    this.tokens = makeTokenCounter(this.log);

    this.metadataStore = new CommandMetadataStore(this.config.botId, this.log);
    this.recursiveNames = recursiveCommandNames(this.config);
    this.availableCommands = availableCommands(this.config);

    this.creds = {
      baseUrl: this.config.llmBaseUrl,
      apiKey: this.config.llmApiKey,
      botId: this.config.botId,
      providerId: this.config.llmProviderId,
    };
    this.deps = {
      config: this.config,
      creds: this.creds,
      log: this.log,
      tokens: this.tokens,
      metadataStore: this.metadataStore,
      availableCommands: this.availableCommands,
    };

    this.messageQueue = new MessageQueue(this.log);
    this.client = new DiscordJsClient(
      {
        onReady: (id, tag) => this.onReady(id, tag),
        onMessage: (m) => void this.handleMessage(m),
        onInteraction: (i) => void this.commandHandler.handleInteraction(i),
      },
      this.config.enableUserStatus,
    );
    this.commandHandler = new CommandHandler(this, this.log);
  }

  private async onReady(userId: string | null, tag: string | null): Promise<void> {
    this.botDiscordId = userId;
    this.log.info(`Logged in as ${tag}`);
    this.log.info(`Character: ${this.character.name}`);
    this.log.info(
      `Channels: ${this.config.channelIds.length > 0 ? this.config.channelIds.join(", ") : "all"}`,
    );
    this.log.info(`Random response rate: 1 in ${this.config.randomResponseRate}`);
    const visionInfo = this.config.enableVision
      ? this.config.visionModel
        ? `enabled (separate model: ${this.config.visionModel})`
        : "enabled (native)"
      : "disabled";
    this.log.info(
      `Vision: ${visionInfo} | Memory book editing: ${this.config.allowLorebookEditing ? "enabled" : "disabled"}`,
    );
    this.log.info(
      `Model: ${this.config.llmModel} | Max tokens: ${this.config.maxContextTokens} | History: ${this.config.maxHistoryMessages} messages`,
    );
    this.log.info(`Memory book: ${this.chatMemoryBook.entries.length} entries loaded`);

    await this.commandHandler.registerCommands(userId!);
    this.setIdlePresence();
  }

  private shouldRespond(message: Message, ignoreBusy = false): boolean {
    const channelId = message.channelId;
    if (!ignoreBusy && this.isBusy.get(channelId)) return false;
    if (!this.runtimeEnabled) return false;

    const whiteListedUser = this.config.mentionTriggerAllowedUserIds.includes(message.author.id);
    const canUserMention = this.config.replyToMentions || whiteListedUser;

    const lastTs = this.lastResponseTimestamp.get(channelId) || 0;
    const now = Date.now();
    if (now - lastTs < this.config.minResponseIntervalSeconds * 1000 && !whiteListedUser) return false;

    if (message.author.id === this.botDiscordId) return false;
    if (message.author.bot && this.config.ignoreOtherBots) return false;
    if (this.config.channelIds.length > 0 && !this.config.channelIds.includes(message.channelId)) return false;

    if (canUserMention) {
      if (this.botDiscordId && message.mentions.has(this.botDiscordId)) return true;
      const characterName = this.character.name.toLowerCase() || "";
      if (characterName) {
        const re = new RegExp(`\\b${characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(message.content)) return true;
      }
      for (const keyword of this.config.triggerKeywords) {
        const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(message.content)) return true;
      }
    }

    if (this.randomResponsesEnabled && this.config.randomResponseRate > 0) {
      this.messageCounter++;
      if (Math.random() * this.config.randomResponseRate < 1) return true;
    }

    return false;
  }

  private async handleMessage(message: Message): Promise<void> {
    const channelId = message.channelId;
    if (this.shouldRespond(message)) {
      await this.processMessage(message);
      return;
    }
    if (this.isBusy.get(channelId) && this.shouldRespond(message, true)) {
      this.messageQueue.enqueue(channelId, message);
    }
  }

  private async processMessage(message: Message): Promise<void> {
    const channelId = message.channelId;
    this.isBusy.set(channelId, true);

    let typingInterval: ReturnType<typeof setInterval> | null = null;
    try {
      if ("sendTyping" in message.channel) {
        await (message.channel as any).sendTyping();
        typingInterval = setInterval(async () => {
          try {
            await (message.channel as any).sendTyping();
          } catch {
            // ignore
          }
        }, 8000);
      }

      const referenced = await fetchReferencedMessage(this.log, message);
      const replyContext = referenced?.text || null;
      const currentImages = await extractImagesFromMessage(this.log, message);
      const stickerImages = await extractStickerImagesFromMessage(this.log, message);
      const allImages: ImageAttachment[] = [...currentImages, ...stickerImages, ...(referenced?.images || [])];

      const { response, messages, model, temperature } = await generateAIResponse(
        this.deps,
        message,
        this.character,
        this.botDiscordId,
        replyContext,
        allImages,
        this.chatMemoryBook,
      );
      this.log.debug(`Raw LLM response: ${response}`);

      const ctx = new MessageResponseContext(message);
      await runResponsePipeline({
        deps: this.deps,
        registry: this.registry,
        metadataStore: this.metadataStore,
        recursiveNames: this.recursiveNames,
        rawResponse: response,
        llmMessages: messages,
        model,
        temperature,
        ctx,
        channelId: message.channelId,
        maxRecursionDepth: this.config.maxRecursionDepth,
        addNothink: this.config.addNothink,
        message,
        character: this.character,
        execCtx: this.buildExecCtx(message),
        onAsyncStart: () => this.setGeneratingPresence(),
        onAsyncEnd: () => this.setIdlePresence(),
      });

      if (typingInterval) clearInterval(typingInterval);
    } catch (error) {
      if (typingInterval) clearInterval(typingInterval);
      this.setIdlePresence();
      this.log.error("Error handling message:", error);
      try {
        await message.reply("*Something went wrong... The static consumes my words.*");
      } catch (replyError) {
        this.log.error("Failed to send error reply:", replyError);
      }
    } finally {
      this.isBusy.set(channelId, false);
      this.lastResponseTimestamp.set(channelId, Date.now());
      await this.processQueue(channelId);
    }
  }

  private async processQueue(channelId: string): Promise<void> {
    while (this.messageQueue.hasPending(channelId)) {
      const nextMessage = this.messageQueue.dequeue(channelId);
      if (!nextMessage) break;
      if (!this.shouldRespond(nextMessage)) {
        this.log.debug(`Skipping queued message from ${nextMessage.author.username} - no longer meets response criteria`);
        continue;
      }
      this.log.debug(
        `Processing queued message from ${nextMessage.author.username} in channel ${channelId} (remaining: ${this.messageQueue.size(channelId)})`,
      );
      await this.processMessage(nextMessage);
      return;
    }
    if (!this.messageQueue.hasPending(channelId)) this.log.debug(`Queue drained for channel ${channelId}`);
  }

  // command exec context builder. shared by chat + slash command paths.
  buildExecCtx(message: Message | null): CommandExecutionContext {
    return {
      message,
      config: this.config,
      log: this.log,
      botId: this.config.botId,
      chatMemoryBook: this.chatMemoryBook,
      onChatMemoryUpdate: (book) => {
        this.chatMemoryBook = book;
      },
      upsertMemoryEntry: async (book, entryName, keywords, content) => {
        const updated = await upsertMemoryEntry(this.config.botId, book, entryName, keywords, content);
        this.chatMemoryBook = updated;
        return updated;
      },
    };
  }

  // BotCommandSurface getters (used by CommandHandler)
  getConfig(): BotRuntimeConfig {
    return this.config;
  }
  getCharacter(): RuntimeCharacter {
    return this.character;
  }
  getChatMemoryBook(): ChatMemoryBook {
    return this.chatMemoryBook;
  }
  setChatMemoryBook(book: ChatMemoryBook): void {
    this.chatMemoryBook = book;
  }
  toggleRandomResponses(): boolean {
    this.randomResponsesEnabled = !this.randomResponsesEnabled;
    return this.randomResponsesEnabled;
  }
  toggleRuntime(): boolean {
    this.runtimeEnabled = !this.runtimeEnabled;
    if (this.runtimeEnabled) this.setIdlePresence();
    else this.setDisabledPresence();
    return this.runtimeEnabled;
  }
  getDeps(): PromptDeps {
    return this.deps;
  }
  getRegistry(): CommandRegistry {
    return this.registry;
  }
  getMetadataStore(): CommandMetadataStore {
    return this.metadataStore;
  }
  getRecursiveNames(): string[] {
    return this.recursiveNames;
  }
  getBotDiscordId(): string | null {
    return this.botDiscordId;
  }
  getRawClient(): Client {
    return this.client.raw() as Client;
  }

  public getQueueDepths(): Record<string, number> {
    const depths: Record<string, number> = {};
    for (const channelId of this.isBusy.keys()) depths[channelId] = this.messageQueue.size(channelId);
    return depths;
  }

  // runtime config + character hot reload (live apply). called by BotManager.
  // swaps the whole config, then rebuilds the enabled-command list and
  // refreshes presence so status text/type edits show up live.
  applyConfigUpdate(config: BotRuntimeConfig): void {
    this.config = config;
    this.deps.config = config;
    this.creds.baseUrl = config.llmBaseUrl;
    this.creds.apiKey = config.llmApiKey;
    this.creds.providerId = config.llmProviderId;
    this.deps.creds = this.creds;

    this.availableCommands = availableCommands(config);
    this.recursiveNames = recursiveCommandNames(config);
    this.deps.availableCommands = this.availableCommands;

    this.log.setLevel((config.logLevel.toUpperCase() as any) || "INFO");

    // refresh presence so status text/type/disabled-status edits land live.
    if (this.botDiscordId) {
      if (!this.runtimeEnabled) this.setDisabledPresence();
      else this.setIdlePresence();
    }
  }
  setCharacter(character: RuntimeCharacter): void {
    this.character = character;
  }

  async start(): Promise<void> {
    await this.metadataStore.cleanupByTTL();
    await this.client.login(this.config.botToken);
  }

  async stop(): Promise<void> {
    await this.metadataStore.flushNow();
    await this.client.destroy();
  }

  // presence helpers
  private activityTypeFromString(type: string): number {
    switch (type.toLowerCase()) {
      case "playing":
        return ActivityType.Playing;
      case "streaming":
        return ActivityType.Streaming;
      case "listening":
        return ActivityType.Listening;
      case "watching":
        return ActivityType.Watching;
      case "competing":
        return ActivityType.Competing;
      default:
        return ActivityType.Playing;
    }
  }

  private setBotPresence(data: { activities: { name: string; type: number }[]; status: PresenceStatusData }): void {
    this.client.setPresence(data);
  }

  private setGeneratingPresence(): void {
    const { status } = this.config;
    this.setBotPresence({
      activities: [{ name: status.generatingText, type: this.activityTypeFromString(status.generatingType) }],
      status: "dnd",
    });
  }

  private setIdlePresence(): void {
    const { status } = this.config;
    if (status.idleText && status.idleText.trim()) {
      this.setBotPresence({
        activities: [{ name: status.idleText, type: this.activityTypeFromString(status.idleType) }],
        status: "online",
      });
    } else {
      this.setBotPresence({ activities: [], status: "online" });
    }
  }

  private setDisabledPresence(): void {
    const { status } = this.config;
    this.setBotPresence({
      activities: [{ name: status.disabledText, type: this.activityTypeFromString(status.disabledType) }],
      status: status.disabledStatus as PresenceStatusData,
    });
  }
}
