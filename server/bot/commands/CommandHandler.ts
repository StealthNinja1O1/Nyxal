// handle the kept slash commands + the ask context menu.

import {
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  Message,
  Client,
} from "discord.js";
import type { Interaction } from "discord.js";
import type { BotRuntimeConfig } from "../../config/botConfig";
import type { RuntimeCharacter, ChatMemoryBook, BotCommand } from "../types";
import type { PromptDeps } from "../prompt";
import { buildAIRequest, trimMessagesToTokenBudget } from "../prompt";
import type { CommandRegistry, CommandExecutionContext } from "./registry";
import type { CommandMetadataStore } from "../stores/commandMetadataStore";
import { setSummaryWatermark, loadSummaries } from "../stores/summaryStore";
import { runResponsePipeline } from "../utils/responsePipeline";
import { InteractionResponseContext } from "../utils/ResponseContexts";
import {
  fetchMessageHistory,
  formatMessagesForAI,
  extractImagesFromMessage,
  extractStickerImagesFromMessage,
} from "../history";
import { generateResponse, generateToolResponse, type WireMessage } from "../api/llm";
import { describeImages, formatImageDescriptions } from "../api/vision";
import { CommandManager } from "./CommandManager";
import type { Logger } from "../utils/logger";

// what the handler needs from the bot (keeps this file decoupled from DiscordBot)
export interface BotCommandSurface {
  getConfig(): BotRuntimeConfig;
  getCharacter(): RuntimeCharacter;
  getChatMemoryBook(): ChatMemoryBook;
  setChatMemoryBook(book: ChatMemoryBook): void;
  toggleRandomResponses(): boolean;
  toggleRuntime(): boolean;
  getDeps(): PromptDeps;
  getRegistry(): CommandRegistry;
  getMetadataStore(): CommandMetadataStore;
  getRecursiveNames(): string[];
  getBotDiscordId(): string | null;
  getRawClient(): Client;
  buildExecCtx(message: Message | null): CommandExecutionContext;
}

export class CommandHandler {
  private commandManager: CommandManager;
  private pendingAskCharMessages = new Map<string, Message>();

  constructor(
    private bot: BotCommandSurface,
    private log: Logger,
  ) {
    this.commandManager = new CommandManager(bot.getConfig().botToken, log);
  }

  async registerCommands(applicationId: string): Promise<void> {
    await this.commandManager.registerCommands(applicationId, this.bot.getCharacter().name);
  }

  /**
   * Shared generate step for the interaction paths (/ask + ask context menu).
   * Mirrors the native branch of generateAIResponse: in native toolcall mode
   * the tools field goes on the wire and tool_calls come back parsed; the
   * legacy json path is a plain generateResponse. Without this, native mode
   * sends a system prompt with no json format instructions and no tools array,
   * so the model improvises tool calls as text.
   */
  private async generateForInteraction(
    deps: PromptDeps,
    model: string,
    messages: WireMessage[],
    temperature: number,
  ): Promise<{ raw: string; nativeCommands: BotCommand[] | null; initialToolTurn: WireMessage | null }> {
    const config = deps.config;
    if (config.toolcallMode === "native" && deps.tools && deps.tools.length > 0) {
      const res = await generateToolResponse(
        deps.creds,
        deps.log,
        model,
        messages,
        temperature,
        config.addNothink,
        deps.tools,
        "chat",
        [],
      );
      return {
        raw: res.content,
        nativeCommands: res.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
        initialToolTurn:
          res.toolCalls.length > 0
            ? {
                role: "assistant",
                content: res.content,
                tool_calls: res.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : null,
      };
    }
    const raw = await generateResponse(deps.creds, deps.log, model, messages, temperature, config.addNothink);
    return { raw, nativeCommands: null, initialToolTurn: null };
  }

  async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isMessageContextMenuCommand()) {
      await this.handleAskCharCommand(interaction as MessageContextMenuCommandInteraction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction as ChatInputCommandInteraction;
    const config = this.bot.getConfig();
    if (!config.allowedUserIds.includes(cmd.user.id)) {
      await cmd.reply({ content: "You don't have permission to use this command.", ephemeral: true });
      return;
    }

    const name = cmd.commandName;
    try {
      if (name === "togglerandom") {
        const enabled = this.bot.toggleRandomResponses();
        await cmd.reply({ content: `Random responses are now ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
        return;
      }
      if (name === "togglementions") {
        config.replyToMentions = !config.replyToMentions;
        await cmd.reply({
          content: `Reply to mentions is now ${config.replyToMentions ? "enabled" : "disabled"}.`,
          ephemeral: true,
        });
        return;
      }
      if (name === "togglebot") {
        const enabled = this.bot.toggleRuntime();
        await cmd.reply({ content: `Bot runtime is now ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
        return;
      }
      if (name === "resetcontext") {
        await this.handleResetContext(cmd);
        return;
      }
      if (name === "ask") {
        await this.handleAskCommand(cmd);
        return;
      }
    } catch (err) {
      this.log.error("Command error:", err);
      try {
        if (!cmd.replied) await cmd.reply({ content: "Command failed", ephemeral: true });
      } catch {
        // ignore
      }
    }
  }

  private async handleAskCommand(cmd: ChatInputCommandInteraction): Promise<void> {
    const config = this.bot.getConfig();
    const deps = this.bot.getDeps();
    const prompt = cmd.options.getString("prompt", true);
    const userName = cmd.user.username || cmd.user.displayName;
    const displayName = cmd.user.displayName || cmd.user.username;
    const userId = cmd.user.id;

    await cmd.deferReply();
    try {
      const askGuild = cmd.guild;
      const guildEmojis = askGuild?.emojis.cache || null;
      const guildStickers = askGuild ? await askGuild.stickers.fetch().catch(() => null) : null;
      const guildInfo = {
        guildName: askGuild?.name || "the server",
        channelName: (cmd.channel as any)?.name || "a channel",
        guildEmojis,
        guildStickers,
        botId: this.bot.getBotDiscordId(),
      };

      const { model, messages, temperature } = await buildAIRequest(deps, {
        character: this.bot.getCharacter(),
        messages: [
          {
            id: "ask-0",
            role: "user",
            content: `${displayName} (${userName} - ${userId}): ${prompt}`,
            createdAt: new Date(),
          },
        ],
        userName,
        guildInfo,
        chatMemoryBook: this.bot.getChatMemoryBook(),
      });

      const { raw, nativeCommands, initialToolTurn } = await this.generateForInteraction(deps, model, messages, temperature);
      const ctx = new InteractionResponseContext(cmd);

      await runResponsePipeline({
        deps,
        registry: this.bot.getRegistry(),
        metadataStore: this.bot.getMetadataStore(),
        recursiveNames: this.bot.getRecursiveNames(),
        rawResponse: raw,
        llmMessages: messages,
        model,
        temperature,
        ctx,
        channelId: cmd.channelId,
        maxRecursionDepth: config.maxRecursionDepth,
        addNothink: config.addNothink,
        message: null,
        character: this.bot.getCharacter(),
        execCtx: this.bot.buildExecCtx(null),
        nativeCommands,
        initialToolTurn,
      });
    } catch (err) {
      this.log.error("Ask command error:", err);
      try {
        await cmd.editReply("*Something went wrong... The static consumes my words.*");
      } catch {
        // ignore
      }
    }
  }

  /**
   * /resetcontext [offset]: manually set the history watermark for
   * the channel. Everything before the watermark is exlcuded from the prompts.
   */
  private async handleResetContext(cmd: ChatInputCommandInteraction): Promise<void> {
    const config = this.bot.getConfig();
    const offset = Math.min(99, Math.max(0, cmd.options.getInteger("offset") ?? 0));
    const channel = cmd.channel;

    if (!channel || channel.partial || !("messages" in channel)) {
      await cmd.reply({ content: "Cannot read messages in this channel.", ephemeral: true });
      return;
    }

    await cmd.deferReply({ ephemeral: true });
    try {
      const fetched = await channel.messages.fetch({ limit: offset + 1 });
      if (fetched.size === 0) {
        await cmd.editReply("No messages in this channel, nothing to reset.");
        return;
      }
      if (offset > 0 && fetched.size <= offset) {
        await cmd.editReply(`Only ${fetched.size} message(s) in this channel, nothing older to cut.`);
        return;
      }
      const watermark = offset === 0 ? fetched.first()!.id : fetched.last()!.id;
      await setSummaryWatermark(config.botId, cmd.channelId, watermark);
      const summaryCount = (await loadSummaries(config.botId, cmd.channelId)).length;

      await cmd.editReply(
        (offset === 0
          ? "Context fully wiped for this channel."
          : `Context reset: keeping the newest ${offset} message(s), everything older is excluded.`) +
          ` Watermark set to \`${watermark}\`.` +
          (summaryCount > 0
            ? ` ${summaryCount} recap(s) remain active (remove them in the dashboard if desired).`
            : ""),
      );
    } catch (err) {
      this.log.error("ResetContext command error:", err);
      try {
        await cmd.editReply("Failed to reset context.");
      } catch {
      }
    }
  }

  private async handleAskCharCommand(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    const config = this.bot.getConfig();
    if (!config.allowedUserIds.includes(interaction.user.id)) {
      await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
      return;
    }

    this.pendingAskCharMessages.set(interaction.id, interaction.targetMessage as Message);

    const modal = new ModalBuilder()
      .setCustomId(`askchar_modal_${interaction.id}`)
      .setTitle(`Ask ${this.bot.getCharacter().name}`);
    const contextInput = new TextInputBuilder()
      .setCustomId("manual_context")
      .setLabel("Additional context (optional)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setPlaceholder("Paste some recent messages or background info here (optional)");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(contextInput));
    await interaction.showModal(modal);

    const modalCustomId = `askchar_modal_${interaction.id}`;
    const client = this.bot.getRawClient();

    const onModal = async (modalInt: any) => {
      if (!modalInt.isModalSubmit?.() || modalInt.customId !== modalCustomId) return;
      if (modalInt.user.id !== interaction.user.id) return;

      clearTimeout(cleanupTimeout);
      client.removeListener("interactionCreate", onModal);

      const targetMessage = this.pendingAskCharMessages.get(interaction.id);
      this.pendingAskCharMessages.delete(interaction.id);
      if (!targetMessage) {
        await modalInt.reply({ content: "This request expired.", ephemeral: true });
        return;
      }

      const manualContext = modalInt.fields.getTextInputValue("manual_context").trim();
      await modalInt.deferReply();

      try {
        const deps = this.bot.getDeps();
        const botId = this.bot.getBotDiscordId();
        const userName = targetMessage.author.username || targetMessage.author.displayName;
        const displayName = targetMessage.author.displayName || targetMessage.author.username;
        const userId = targetMessage.author.id;

        const history = await fetchMessageHistory(this.log, this.bot.getMetadataStore(), targetMessage as Message, config.maxHistoryMessages, botId);
        const formattedHistory = formatMessagesForAI(history);

        const targetImages = await extractImagesFromMessage(this.log, targetMessage as Message);
        const targetStickerImages = await extractStickerImagesFromMessage(this.log, targetMessage as Message);
        const allTargetImages = [...targetImages, ...targetStickerImages];
        let imageDescriptionText = "";
        if (config.enableVision && allTargetImages.length > 0 && config.visionModel) {
          try {
            this.log.debug(`AskChar: Describing ${allTargetImages.length} image(s) with vision model`);
            const descriptions = await describeImages(allTargetImages, config, this.log);
            imageDescriptionText = formatImageDescriptions(descriptions);
          } catch (err) {
            this.log.warn("AskChar: Vision model failed, skipping image descriptions:", err);
          }
        }

        const targetContent = targetMessage.content || "";
        const messageContent = imageDescriptionText
          ? `${displayName} (${userName} - ${userId}): ${imageDescriptionText}${targetContent ? "\n" + targetContent : ""}`
          : `${displayName} (${userName} - ${userId}): ${targetContent}`;

        formattedHistory.push({
          id: targetMessage.id,
          role: "user",
          content: messageContent,
          createdAt: targetMessage.createdAt,
        });

        const allMessages = formattedHistory.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
        if (manualContext) {
          allMessages.unshift({
            id: "ctx-0",
            role: "user" as const,
            content: `[Context]: ${manualContext}`,
            createdAt: new Date(),
          });
        }

        const trimmed = await trimMessagesToTokenBudget(deps, allMessages, this.bot.getCharacter(), userName, config.maxContextTokens);

        const targetGuild = targetMessage.guild;
        const guildEmojis = targetGuild?.emojis.cache || null;
        const guildStickers = targetGuild ? await targetGuild.stickers.fetch().catch(() => null) : null;
        const guildInfo = {
          guildName: targetGuild?.name || "the server",
          channelName: (targetMessage.channel as any)?.name || "a channel",
          guildEmojis,
          guildStickers,
          botId,
        };

        const { model, messages, temperature } = await buildAIRequest(deps, {
          character: this.bot.getCharacter(),
          messages: trimmed,
          userName,
          guildInfo,
          chatMemoryBook: this.bot.getChatMemoryBook(),
        });

        const { raw, nativeCommands, initialToolTurn } = await this.generateForInteraction(deps, model, messages, temperature);
        const ctx = new InteractionResponseContext(modalInt);

        await runResponsePipeline({
          deps,
          registry: this.bot.getRegistry(),
          metadataStore: this.bot.getMetadataStore(),
          recursiveNames: this.bot.getRecursiveNames(),
          rawResponse: raw,
          llmMessages: messages,
          model,
          temperature,
          ctx,
          channelId: targetMessage.channelId,
          maxRecursionDepth: config.maxRecursionDepth,
          addNothink: config.addNothink,
          message: targetMessage as Message,
          character: this.bot.getCharacter(),
          execCtx: this.bot.buildExecCtx(targetMessage as Message),
          nativeCommands,
          initialToolTurn,
        });
      } catch (err) {
        this.log.error("AskChar modal error:", err);
        try {
          await modalInt.editReply("*Something went wrong... The static consumes my words.*");
        } catch {
          // ignore
        }
      }
    };

    client.on("interactionCreate", onModal);

    const cleanupTimeout = setTimeout(() => {
      this.pendingAskCharMessages.delete(interaction.id);
      client.removeListener("interactionCreate", onModal);
    }, 5 * 60 * 1000);
  }
}
