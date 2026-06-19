import type { Message, User } from "discord.js";
import type { ImageAttachment, ReactionInfo } from "./types";
import { compressImage, encodeUncompressed } from "./utils/imageProcessor";
import type { Logger } from "./utils/logger";
import type { CommandMetadataStore } from "./stores/commandMetadataStore";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  member?: User | null;
  reactions?: ReactionInfo[];
  hasAttachments?: boolean;
}

export interface ReferencedMessageInfo {
  text: string;
  images: ImageAttachment[];
}

export interface FormattedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  reactions?: ReactionInfo[];
  hasAttachments?: boolean;
}

// clamp to discord's 100 message fetch limit. fuck that api.
export async function fetchMessageHistory(
  log: Logger,
  metadataStore: CommandMetadataStore,
  message: Message,
  limit: number,
  botId: string | null,
): Promise<HistoryMessage[]> {
  const clampedLimit = Math.min(Math.max(limit || 50, 1), 100);
  try {
    const fetched = await message.channel.messages.fetch({ limit: clampedLimit });

    // drop the trigger message itself, the caller appends it separately so we force a reply to it
    const filtered = Array.from(fetched.values()).filter((msg) => msg.id !== message.id);
    const sorted = filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const mentionPattern = /<@!?(\d+)>/g;
    const allMentionIds = new Set<string>();
    for (const msg of sorted) {
      for (const match of msg.content.matchAll(mentionPattern)) allMentionIds.add(match[1]!);
    }

    const memberNameMap = new Map<string, string>();
    if (message.guild && allMentionIds.size > 0) {
      await Promise.all(
        [...allMentionIds].map(async (userId) => {
          const cached = message.guild!.members.cache.get(userId);
          if (cached) {
            memberNameMap.set(userId, cached.displayName || cached.user.displayName || cached.user.username);
            return;
          }
          try {
            const member = await message.guild!.members.fetch(userId);
            memberNameMap.set(userId, member.displayName || member.user.displayName || member.user.username);
          } catch {
            log.debug(`Could not resolve mention for user ${userId}`);
          }
        }),
      );
    }

    const resolveMentions = (content: string): string =>
      content.replace(mentionPattern, (_, userId) => {
        const name = memberNameMap.get(userId as string);
        return name ? `@${name}` : `<@${userId}>`;
      });

    const processed = await Promise.all(
      sorted.map(async (msg) => {
        const hasStickers = msg.stickers.size > 0;
        const hasAttachments = msg.attachments.size > 0;
        if (msg.author.bot && msg.content.trim() === "" && !hasStickers && !hasAttachments) return null;

        let processedContent = resolveMentions(msg.content);
        if (hasStickers) {
          const stickerStr = Array.from(msg.stickers.values())
            .map((s) => `Sent sticker: "${s.name}"`)
            .join(", ");
          processedContent = processedContent.trim() ? `${processedContent}\n${stickerStr}` : stickerStr;
        }

        const isBotMessage = msg.author.bot && botId != null && msg.author.id === botId;
        const reactions: ReactionInfo[] = Array.from(msg.reactions.cache.values()).map((reaction) => ({
          emoji: reaction.emoji?.toString() ?? "",
          userIds: [],
          userNames: [],
        }));

        return {
          id: msg.id,
          role: (isBotMessage ? "assistant" : "user") as "user" | "assistant",
          content: processedContent,
          createdAt: msg.createdAt,
          member: msg.author,
          reactions: reactions.length > 0 ? reactions : undefined,
          hasAttachments: msg.attachments.size > 0 || undefined,
        } as HistoryMessage;
      }),
    );

    const result = processed.filter((m): m is HistoryMessage => m !== null);

    const activeIds = new Set(result.map((m) => m.id));
    await metadataStore.cleanupByChannel(message.channelId, activeIds);

    return result;
  } catch (error) {
    log.error("Error fetching message history:", error);
    return [];
  }
}

export function formatMessagesForAI(messages: HistoryMessage[]): FormattedMessage[] {
  return messages.map((msg) => {
    let content = msg.content;
    const username = msg.member?.username || "unknown";
    const userDisplayName = msg.member?.displayName || username || "unknown";
    const userId = msg.member?.id || "unknown";

    if (msg.role === "user") content = `${userDisplayName} (${username} - ${userId}): ${content}`;
    return {
      id: msg.id,
      role: msg.role,
      content,
      createdAt: msg.createdAt,
      reactions: msg.reactions,
      hasAttachments: msg.hasAttachments,
    };
  });
}

async function downloadAndEncodeImage(log: Logger, url: string, contentType: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`Failed to download image from ${url}: ${res.statusText}`);
      return null;
    }
    const originalBuffer = Buffer.from(await res.arrayBuffer());
    const compressed = await compressImage(log, originalBuffer);
    if (compressed) {
      log.debug(
        `Image compressed: ${(compressed.originalSize / 1024).toFixed(0)}KB -> ${(compressed.compressedSize / 1024).toFixed(0)}KB`,
      );
      return compressed.base64DataUrl;
    }
    log.debug(`No image backend available for ${url}, using original (${(originalBuffer.length / 1024).toFixed(0)}KB)`);
    return encodeUncompressed(originalBuffer, contentType);
  } catch (error) {
    log.error(`Error encoding image from ${url}:`, error);
    return null;
  }
}

function isImageAttachment(attachment: any): boolean {
  return (attachment.contentType || "").startsWith("image/");
}

export async function extractImagesFromMessage(log: Logger, message: Message): Promise<ImageAttachment[]> {
  const results = await Promise.all(
    Array.from(message.attachments.values())
      .filter(isImageAttachment)
      .map(async (attachment) => {
        const { url, contentType } = attachment;
        if (!url || !contentType) return null;
        const base64 = await downloadAndEncodeImage(log, url, contentType);
        return base64 ? { url, contentType: "image/jpeg", base64 } : null;
      }),
  );
  return results.filter((img): img is ImageAttachment => img !== null);
}

export async function fetchReferencedMessage(
  log: Logger,
  message: Message,
): Promise<ReferencedMessageInfo | null> {
  if (!message.reference || !message.reference.messageId) return null;
  try {
    const referenced = await message.channel.messages.fetch(message.reference.messageId);
    if (!referenced) return null;

    const displayName =
      referenced.member?.displayName ||
      referenced.author.displayName ||
      referenced.author.username;
    const text = `{{user}} is replying to ${referenced.content} (by @${displayName})`;

    const images = await extractImagesFromMessage(log, referenced);
    const stickerImages = await extractStickerImagesFromMessage(log, referenced);
    return { text, images: [...images, ...stickerImages] };
  } catch (error) {
    log.error("Error fetching referenced message:", error);
    return null;
  }
}

export async function extractStickerImagesFromMessage(log: Logger, message: Message): Promise<ImageAttachment[]> {
  const results = await Promise.all(
    Array.from(message.stickers.values())
      .filter((s) => s.format !== 3) // 3 == lottie json animation, not raster
      .map(async (sticker) => {
        if (!sticker.url) return null;
        const contentType = sticker.format === 2 ? "image/apng" : "image/png";
        const base64 = await downloadAndEncodeImage(log, sticker.url, contentType);
        return base64 ? { url: sticker.url, contentType: "image/jpeg", base64 } : null;
      }),
  );
  return results.filter((img): img is ImageAttachment => img !== null);
}
