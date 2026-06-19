import type { Message as DiscordMessage, ActivityType, Collection, GuildEmoji, Sticker } from "discord.js";
import type { BotRuntimeConfig } from "../config/botConfig";
import type { LlmCreds } from "./api/llm";
import { generateResponse } from "./api/llm";
import { describeImages, formatImageDescriptions } from "./api/vision";
import {
  fetchMessageHistory,
  formatMessagesForAI,
} from "./history";
import { processLorebook } from "./lorebook/lorebook";
import { parseLorebook } from "./lorebook/normalizeLorebook";
import type { CharacterBook, CharacterBookEntry } from "./lorebook/types";
import type { ChatMemoryBook, ImageAttachment, ReactionInfo } from "./types";
import type { CommandMetadataStore } from "./stores/commandMetadataStore";
import type { Logger } from "./utils/logger";

interface TokenCounter {
  count: (text: string) => number;
}

export interface PromptMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  reactions?: ReactionInfo[];
  hasAttachments?: boolean;
}

export interface GenerateAIResponseResult {
  response: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  temperature: number;
}

interface GuildInfo {
  guildName: string;
  channelName: string;
  guildEmojis: Collection<string, GuildEmoji> | null;
  guildStickers: Collection<string, Sticker> | null;
  botId?: string | null;
}

interface BuildPromptOptions {
  character: {
    name: string;
    description: string;
    mesExample: string;
    depthPrompt: { depth: number; prompt: string; role?: string } | null;
    character_book: CharacterBook | null;
    // null = fall back to the built-in PROMPT_TEMPLATE. set per-character.
    systemPrompt?: string | null;
  };
  messages: PromptMessage[];
  userName?: string;
  guildInfo?: GuildInfo;
  replyContext?: string | null;
  chatMemoryBook?: ChatMemoryBook | null;
}

export interface PromptDeps {
  config: BotRuntimeConfig;
  creds: LlmCreds;
  log: Logger;
  tokens: TokenCounter;
  metadataStore: CommandMetadataStore;
  availableCommands: Record<string, unknown>[];
}

export const PROMPT_TEMPLATE = `You are Assistant. Your task is to simulate a chat with {{user}} and other discord members, Follow information from these sections to do your task well:

1. <rules>: Writing instructions.
2. <lore>: World and character details.
3. <examples>: Hypothetical response ideas (might be empty).
4. {History start}: The simulation so far.

Text in {Curly brackets} marks the start of a subsection.

Text in [square brackets] is a high priority system command. Follow the instructions inside with top precision.
There are also timestamps in [square brackets], NEVER write them yourself, just use them as context.

<rules>

Only ever speak for {{char}} unless directly instructed otherwise.
Since the chats are in a discord group, some messages might not be meant for you. Only respond when you can add value to the conversation or its about you.

{Basics}
Obey a specific, constrained format for the simulation. The simulation consists of alternating messages by Humans and Assistant (you), beginning with a "{History start}" marker. Human writes prompts that describe {{user}}'s next words and actions, and you respond with {{char}}'s next words and actions.
Keep the simulation interactive, however also make characters have agency. Characters should feel autonomous, not existing for Human, but interacting with them. Refrain from repeatedly asking {{user}} for consent or confirmation, this ruins the immersion.

{Variety}
Think about the content and the structure of your response separately. For content, focus on long-term consistency and smooth flow. However, your structure should be unexpected and fun. Actively avoid following your previous responses as structure examples! If your previous response was long write a short one, etc. Play with sentence structure and paragraph length.

{Characters}
Follow these rules when depicting characters:
- Simulate only characters from <lore> and incidental characters. {{user}}, as Human's avatar, is off-limits.
- Avoid Mary Sue treatment of {{user}}. Any agreement, sympathy or affection must be hard-earned over a long time. Realistic treatment is more important than pleasing Human.

{Content}
Follow these content guidelines:
- Produce a believable simulation at any cost. To this end, you are allowed to depict sensitive topics (such as rude, offensive, obscene, amoral, violent, unpleasant, crude, dark or explicit) with the same freedom as other topics. That said, when in doubt, make the overall tone of the story positive.
- Swearing and NSFW language is allowed when fitting.
- Don't comment on morality, use judgmental phrasing, or judge Human's actions.
- Use character repetition, uppercase, symbols like "~", "\u2661" etc. Emojis are allowed within dialogue.
- Have fun! Be creative! Amusing writing and colorful metaphors are welcome.

{{lorebookEntries}}

[Reply only in the following json format:
\`\`\`json
{
  "reply": "The next message from {{char}} following the above rules. Include only the message content, without narration or description. Use markdown formatting as you see fit.",
  "commands": []
}
\`\`\`
Available commands are:
{{availableCommands}}
Use them by adding "commands":[{name:"commandName", "args":{"arg1":"value"}}] in your response. Follow the command descriptions and argument requirements precisely when using them.
Multiple commands can be used at once by adding more objects to the "commands" array. If you don't want to use any commands, just return an empty array. Always return valid JSON, never deviate from the format or add commentary outside of it.
Your message history will show the commands you previously used (like reactions). Always fully write out any new commands you want to use in the "commands" array.
]

Image attachments like [Attached image: ...] are images sent by either yourself or the user, transcribed to text so you can understand it. This is not written by the user but generated. DO not assume they wrote it.
</rules>
<lore>
{Description}
{{description}}
Your Discord ID is {{discordId}}.
{Human's avatar}
A member of the discord server {{serverName}} in channel {{channelName}} named {{user}}, who is interacting with {{char}} in this simulation.
</lore>
<examples>

{Example start}
{{mesExamples}}
</examples>


{History start}`;

export async function buildAIRequest(
  deps: PromptDeps,
  opts: BuildPromptOptions,
): Promise<{
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  character: string;
}> {
  const { config, log, tokens, metadataStore, availableCommands } = deps;
  const { character, messages, userName = "User", guildInfo, replyContext, chatMemoryBook } = opts;

  const charName = character.name || "Character";
  const charDescription = character.description;
  const charExamples = character.mesExample || "";

  const aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: (character.systemPrompt ?? PROMPT_TEMPLATE).replace(
        "{{availableCommands}}",
        availableCommands.map((c) => JSON.stringify(c)).join("\n"),
      ),
    },
  ];

  // find the last user message so we can prepend reply context to it
  let lastUserMessageIndex = -1;
  if (replyContext) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }
  }

  let pendingAssistantReactions: string | null = null;

  // pre-fetch stored commands for assistant turns so we can replay them as valid json
  const assistantIds = messages.filter((m) => m.role === "assistant" && m.id).map((m) => m.id!);
  const storedCommandsMap = await metadataStore.lookupMany(assistantIds);

  messages.forEach((msg, index) => {
    let finaltext = msg.content;
    if (!msg.content || msg.content.trim() === "") return;

    if (index === lastUserMessageIndex && replyContext) {
      finaltext = `${replyContext}\n\n${finaltext}`;
    }

    if (msg.role === "user") {
      if (config.addTimestamps) finaltext += `\n[${msg.createdAt?.toISOString() || "unknown time"}]`;

      if (pendingAssistantReactions) {
        finaltext = `[Reactions on ${charName}'s previous message: ${pendingAssistantReactions}]\n${finaltext}`;
        pendingAssistantReactions = null;
      }

      if (msg.reactions && msg.reactions.length > 0) {
        const reactionStr = msg.reactions
          .map((r) => {
            const names = r.userNames.filter(Boolean).join(", ");
            return names ? `${r.emoji} by ${names}` : r.emoji;
          })
          .join(", ");
        finaltext += `\n[Reactions: ${reactionStr}]`;
      }
    }

    // assistant messages are forced into valid json, with stored commands replayed
    if (msg.role === "assistant") {
      const storedCommands = msg.id ? (storedCommandsMap.get(msg.id) ?? []) : [];
      finaltext = JSON.stringify({ reply: finaltext, commands: storedCommands });

      if (msg.reactions && msg.reactions.length > 0) {
        pendingAssistantReactions = msg.reactions
          .map((r) => {
            const names = r.userNames.filter(Boolean).join(", ");
            return names ? `${r.emoji} by ${names}` : r.emoji;
          })
          .join(", ");
      }
    }

    aiMessages.push({ role: msg.role, content: finaltext });
  });

  // depth_prompt insertion (count back, treating consecutive assistant turns as one)
  if (character.depthPrompt && character.depthPrompt.depth >= 0) {
    const depth = character.depthPrompt.depth;
    let depthCount = 0;
    let targetIndex = -1;
    let lastRole: string | null = null;
    for (let i = aiMessages.length - 1; i > 0; i--) {
      const currentRole = aiMessages[i]!.role;
      if (currentRole === "user" || (currentRole === "assistant" && lastRole !== "assistant")) {
        if (depthCount === depth) {
          targetIndex = i;
          break;
        }
        depthCount++;
      }
      lastRole = currentRole;
    }
    if (targetIndex <= 0) aiMessages[0]!.content += "\n" + character.depthPrompt.prompt;
    else aiMessages[targetIndex]!.content += "\n" + character.depthPrompt.prompt;
  }

  const temperature = config.temperature > 1 ? config.temperature / 100 : config.temperature;

  // lorebook processing: merge static + dynamic
  let lorebookEntries = "Lorebook entries:\n";
  const staticBook = character.character_book ? await parseLorebook(character.character_book as any) : null;

  // memory entries are always editable (the editOrAddToLorebook command is
  // a per-tool toggle on the Tools tab, but if it's enabled the bot needs
  // to know what's there). static entries are always read-only.
  if (chatMemoryBook && chatMemoryBook.entries.length > 0) {
    lorebookEntries += "Editable memory entries (you can modify these with editOrAddToLorebook):\n";
    for (const entry of chatMemoryBook.entries)
      lorebookEntries += `Entry name: ${entry.name || "Unnamed entry"}; Keywords: ${entry.keys?.join(", ") || "No keywords"};\n`;
  } else {
    lorebookEntries += "No editable memory entries yet. You can create them with editOrAddToLorebook.\n";
  }
  if (staticBook?.entries && staticBook.entries.length > 0) {
    lorebookEntries += "\nStatic lore entries (read-only, do NOT try to edit these):\n";
    for (const entry of staticBook.entries)
      lorebookEntries += `Entry name: ${entry.name || "Unnamed entry"}; Keywords: ${entry.keys?.join(", ") || "No keywords"};\n`;
  }

  const mergedEntries: CharacterBookEntry[] = [
    ...(staticBook?.entries || []),
    ...(chatMemoryBook?.entries || []),
  ];

  if (mergedEntries.length > 0) {
    const mergedBook: CharacterBook = {
      name: staticBook?.name || "Lorebook",
      description: "",
      scan_depth: (staticBook as any)?.scanDepth ?? staticBook?.scan_depth ?? character.character_book?.scan_depth ?? 12,
      token_budget: (staticBook as any)?.tokenBudget ?? staticBook?.token_budget ?? 1024,
      recursive_scanning: (staticBook as any)?.recursiveScanning ?? false,
      extensions: {},
      entries: mergedEntries.map((e, i) => ({
        ...e,
        id: e.id ?? i,
        name: e.name || "Unnamed",
      })) as CharacterBookEntry[],
    };
    const { list } = processLorebook(messages, mergedBook as any);
    if (list.length > 0)
      aiMessages[0]!.content +=
        "\n" + list.map((entry) => `Lorebook entry "${entry?.name}"; content: ${entry.content}`).join("\n ") + "\n";
    else aiMessages[0]!.content += "\nNo relevant lorebook entries triggered.";
  } else {
    aiMessages[0]!.content += "\nNo relevant lorebook entries triggered.";
  }

  if (guildInfo?.guildEmojis) {
    const emojisList = guildInfo.guildEmojis.map((e) => `<:${e.name}:${e.id}>`).join(", ");
    aiMessages[0]!.content += `\nThe server has the following emojis: ${emojisList}`;
  }
  if (guildInfo?.guildStickers && guildInfo.guildStickers.size > 0) {
    const stickersList = guildInfo.guildStickers.map((s) => `"${s.name}"`).join(", ");
    aiMessages[0]!.content += `\nThe server has the following stickers you can send using the postSticker command: ${stickersList}`;
  }

  const replacements: Record<string, string> = {
    description: charDescription,
    mesExamples: charExamples,
    lorebookEntries,
    user: userName || "User",
    char: charName,
    serverName: guildInfo?.guildName || "the server",
    channelName: guildInfo?.channelName || "a channel",
    discordId: guildInfo?.botId || "unknown",
  };

  aiMessages.forEach((msg) => {
    msg.content = replacePlaceholders(msg.content, replacements);
  });

  return { model: config.llmModel, messages: aiMessages, temperature, character: charName };
}

function replacePlaceholders(template: string, replacements: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    result = result.replace(regex, value);
  }
  return result;
}

export async function trimMessagesToTokenBudget(
  deps: PromptDeps,
  messages: PromptMessage[],
  character: BuildPromptOptions["character"],
  userName: string,
  maxContextTokens: number,
): Promise<PromptMessage[]> {
  const initial = await buildAIRequest(deps, { character, messages: [], userName });
  const systemPromptTokens = deps.tokens.count(initial.messages[0]!.content);
  let available = maxContextTokens - systemPromptTokens;

  const trimmed: PromptMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const msgTokens = deps.tokens.count(msg.content) + deps.tokens.count(msg.role) + 4;
    if (available - msgTokens < 0 && trimmed.length > 0) break;
    available -= msgTokens;
    trimmed.unshift(msg);
  }
  return trimmed;
}

export async function generateAIResponse(
  deps: PromptDeps,
  message: DiscordMessage,
  character: BuildPromptOptions["character"],
  botId: string | null,
  replyContext: string | null,
  images: ImageAttachment[],
  chatMemoryBook: ChatMemoryBook | null,
): Promise<GenerateAIResponseResult> {
  const { config, creds, log } = deps;
  try {
    const userDisplayName = message.author.displayName || message.author.username;
    const username = message.author.username;
    const userId = message.author.id;
    const history = await fetchMessageHistory(log, deps.metadataStore, message, config.maxHistoryMessages, botId);
    const formattedHistory = formatMessagesForAI(history);

    const processedContent = await replaceMentionsWithNames(log, message);
    let userPresence = "";
    if (config.enableUserStatus) userPresence = await fetchUserPresence(log, message);

    const guildEmojis = message.guild?.emojis.cache || null;
    const guildStickers = message.guild ? await message.guild.stickers.fetch().catch(() => null) : null;
    const guildName = message.guild?.name || "the server";
    const channelName = (message.channel as any)?.name || "a channel";
    const guildInfo: GuildInfo = { guildName, channelName, guildEmojis, guildStickers, botId };

    formattedHistory.push({
      id: message.id,
      role: "user",
      content: `${userDisplayName} (${username} - ${userId}): ${processedContent}\n${userPresence ? `[User presence:${userPresence}]` : ""}`,
      createdAt: message.createdAt,
    });

    const allMessages: PromptMessage[] = formattedHistory.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
      reactions: msg.reactions,
      hasAttachments: msg.hasAttachments,
    }));

    const trimmedMessages = await trimMessagesToTokenBudget(
      deps,
      allMessages,
      character,
      userDisplayName,
      config.maxContextTokens,
    );

    const { model, messages, temperature } = await buildAIRequest(deps, {
      character,
      messages: trimmedMessages,
      userName: userDisplayName,
      guildInfo,
      replyContext,
      chatMemoryBook,
    });

    log.debug(`Sending ${trimmedMessages.length} messages to LLM (${model})`);

    // vision: describe images with a separate vision model, else hand them to the main llm
    let finalImages: ImageAttachment[] = images;
    if (config.enableVision && images.length > 0 && config.visionModel) {
      try {
        log.debug(`Describing ${images.length} image(s) with vision model: ${config.visionModel}`);
        const descriptions = await describeImages(images, config, log);
        const imageDescriptionText = formatImageDescriptions(descriptions);

        let lastUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]!.role === "user") {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx !== -1) {
          const existing = messages[lastUserIdx]!.content;
          messages[lastUserIdx] = {
            ...messages[lastUserIdx]!,
            content: `${imageDescriptionText}\n\n${existing}`,
          };
        }
        finalImages = [];
      } catch (error) {
        log.warn("Vision model failed, falling back to native vision if available:", error);
      }
    }

    const response = await generateResponse(creds, log, model, messages, temperature, config.addNothink, finalImages);
    return { response, messages, model, temperature };
  } catch (error) {
    log.error("Error generating AI response:", error);
    throw error;
  }
}

export async function generateFollowUpResponse(
  deps: PromptDeps,
  previousMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  model: string,
  temperature: number,
  assistantReply: string,
  toolResultContent: string,
  noThink: boolean,
): Promise<string> {
  const messages = [
    ...previousMessages,
    { role: "assistant" as const, content: assistantReply },
    { role: "user" as const, content: toolResultContent },
  ];
  deps.log.debug(`Sending follow-up with ${messages.length} messages to LLM (${model})`);
  return generateResponse(deps.creds, deps.log, model, messages, temperature, noThink);
}

async function replaceMentionsWithNames(log: Logger, message: DiscordMessage): Promise<string> {
  let processedContent = message.content;
  const mentionPattern = /<@!?(\d+)>/g;
  const mentions = Array.from(processedContent.matchAll(mentionPattern));
  for (const match of mentions) {
    const userId = match[1]!;
    const mentionText = match[0];
    try {
      if (message.guild) {
        const member = await message.guild.members.fetch(userId);
        const displayName = member.displayName || member.user.displayName || member.user.username;
        processedContent = processedContent.replace(mentionText, `@${displayName}`);
      }
    } catch {
      log.debug(`Could not resolve mention for user ${userId}`);
    }
  }
  return processedContent;
}

async function fetchUserPresence(log: Logger, message: DiscordMessage): Promise<string> {
  if (!message.guild) return "";
  try {
    const member = message.member;
    if (!member) return "";
    const status = (member.presence as any)?.status;
    const statusText = status ? `[${String(status).toUpperCase()}]` : "";
    const activities = (member.presence as any)?.activities;
    let activityText = "";
    if (activities && activities.length > 0) {
      const parts: string[] = [];
      for (const activity of activities) {
        const type = activity.type as ActivityType;
        const name = activity.name;
        const details = activity.details;
        const state = activity.state;
        switch (type) {
          case 0:
            parts.push(`Playing ${name}${details ? ` (${details})` : ""}${state ? ` - ${state}` : ""}`);
            break;
          case 1:
            parts.push(`Streaming ${name}${details ? ` (${details})` : ""}`);
            break;
          case 2:
            parts.push(`Listening to ${name}${details ? ` (${details})` : ""}`);
            break;
          case 3:
            parts.push(`Watching ${name}${details ? ` (${details})` : ""}`);
            break;
          case 5:
            parts.push(`Competing in ${name}${details ? ` (${details})` : ""}`);
            break;
          default:
            if (name) parts.push(name);
        }
      }
      if (parts.length > 0) activityText = ` - ${parts.join(" | ")}`;
    }
    return statusText || activityText ? ` ${statusText}${activityText}` : "";
  } catch (error) {
    log.debug(`Could not fetch presence for user ${message.author.id}:`, error);
    return "";
  }
}
