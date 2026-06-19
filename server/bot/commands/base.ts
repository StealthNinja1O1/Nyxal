// instant command handlers: react, renameSelf/renameUser/setBio, postSticker etc
// take the resolved config from the exec ctx

import type { Message, TextChannel } from "discord.js";
import type { CommandDef, CommandExecutionContext, CommandResult } from "./registry";

export async function react(args: { emoji: string }, message: Message | null): Promise<CommandResult> {
  const { emoji } = args;
  if (!message) return { success: false, message: "No message to react to (command run without context)" };
  if (!emoji || typeof emoji !== "string") return { success: false, message: "Invalid emoji argument" };

  try {
    const custom = emoji.match(/^<?(a)?:?(\w{2,32}):(\d{17,19})>?$/);
    if (custom) {
      const emojiId = custom[3]!;
      const guildEmoji = message.guild?.emojis.cache.get(emojiId);
      if (guildEmoji) {
        await message.react(guildEmoji);
        return { success: true, message: `Reacted with custom emoji ${emoji}` };
      }
      return { success: false, message: `Custom emoji ${emoji} not found in this server` };
    }
    await message.react(emoji);
    return { success: true, message: `Reacted with ${emoji}` };
  } catch (error) {
    return { success: false, message: `Failed to react: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const reactCommand: CommandDef<{ emoji: string }> = {
  name: "react",
  args: { emoji: "string" },
  description:
    "React to the previous message with the specified emoji. Use official Discord emojis or custom ones from the server (format: emojiName:emojiId).",
  kind: "instant",
  enabled: () => true,
  execute: async (args, ctx) => react(args as { emoji: string }, ctx.message),
};

export async function renameSelf(
  args: { newName: string },
  message: Message | null,
  allowRenaming: boolean,
): Promise<CommandResult> {
  if (!allowRenaming) return { success: false, message: "Renaming is disabled" };
  const { newName } = args;
  if (!newName || typeof newName !== "string") return { success: false, message: "Invalid newName argument" };
  if (!message?.guild) return { success: false, message: "Cannot rename outside of a server" };
  const botMember = message.guild.members.me;
  if (!botMember) return { success: false, message: "Bot is not a member of this server" };
  try {
    await botMember.setNickname(newName);
    return { success: true, message: `Renamed self to "${newName}"` };
  } catch (error) {
    return { success: false, message: `Failed to rename: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function renameUser(
  args: { userId: string; newName: string },
  message: Message | null,
  allowRenaming: boolean,
): Promise<CommandResult> {
  if (!allowRenaming) return { success: false, message: "Renaming is disabled" };
  const { userId, newName } = args;
  if (!userId || typeof userId !== "string") return { success: false, message: "Invalid userId argument" };
  if (!newName || typeof newName !== "string") return { success: false, message: "Invalid newName argument" };
  if (!message?.guild) return { success: false, message: "Cannot rename outside of a server" };

  const extractedUserId = userId.match(/^<@!?(\d+)>$/)?.[1] || userId;
  try {
    const targetMember = await message.guild.members.fetch(extractedUserId);
    if (!targetMember) return { success: false, message: `User ${userId} not found in server` };
    if (!message.guild.members.me?.permissions.has("ManageNicknames"))
      return { success: false, message: "Bot lacks MANAGE_NICKNAMES permission" };
    if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position)
      return { success: false, message: "Cannot rename users with equal or higher role" };
    await targetMember.setNickname(newName);
    return { success: true, message: `Renamed user ${targetMember.user.username} to "${newName}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to rename user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function setBio(
  args: { bio: string },
  message: Message | null,
  config: CommandExecutionContext["config"],
): Promise<CommandResult> {
  if (!config.allowRenaming) return { success: false, message: "Profile editing is disabled" };
  const { bio } = args;
  if (!bio || typeof bio !== "string") return { success: false, message: "Invalid bio argument" };
  if (bio.length > 190) return { success: false, message: `Bio is too long (${bio.length}/190 characters)` };
  if (!message?.guild) return { success: false, message: "Cannot set bio outside of a server" };
  try {
    // discord.js has no GuildMember.setBio(), fuck discord.js
    const res = await fetch(`https://discord.com/api/v10/guilds/${message.guild.id}/members/@me`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${config.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bio }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { success: false, message: `Failed to set bio (HTTP ${res.status}): ${errText}` };
    }
    return { success: true, message: `Updated bio to: "${bio.slice(0, 80)}${bio.length > 80 ? "..." : ""}"` };
  } catch (error) {
    return { success: false, message: `Failed to set bio: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const renameSelfCommand: CommandDef<{ newName: string }> = {
  name: "renameSelf",
  args: { newName: "string" },
  description: "Change {{char}}'s nickname in the server to the specified newName.",
  kind: "instant",
  enabled: (config) => config.allowRenaming,
  execute: async (args, ctx) => renameSelf(args as { newName: string }, ctx.message, ctx.config.allowRenaming),
};

export const renameUserCommand: CommandDef<{ userId: string; newName: string }> = {
  name: "renameUser",
  args: { userId: "string", newName: "string" },
  description: "Change the nickname of the specified user in the server to newName.",
  kind: "instant",
  enabled: (config) => config.allowRenaming,
  execute: async (args, ctx) =>
    renameUser(args as { userId: string; newName: string }, ctx.message, ctx.config.allowRenaming),
};

export const setBioCommand: CommandDef<{ bio: string }> = {
  name: "setBio",
  args: { bio: "string (max 190 characters)" },
  description: `Set {{char}}'s about me / bio text on their server profile`,
  kind: "instant",
  enabled: (config) => config.allowRenaming,
  execute: async (args, ctx) => setBio(args as { bio: string }, ctx.message, ctx.config),
};

export async function postSticker(args: { stickerName: string }, message: Message | null): Promise<CommandResult> {
  const { stickerName } = args;
  if (!stickerName || typeof stickerName !== "string")
    return { success: false, message: "Invalid stickerName argument" };
  if (!message?.guild) return { success: false, message: "Cannot send stickers outside of a server" };
  if (!message.channel.isTextBased()) return { success: false, message: "Cannot send stickers in this channel type" };
  try {
    const stickers = await message.guild.stickers.fetch();
    const sticker = stickers.find((s) => s.name.toLowerCase() === stickerName.toLowerCase());
    if (!sticker) return { success: false, message: `Sticker "${stickerName}" not found in this server` };
    const channel = message.channel as TextChannel;
    await channel.send({ stickers: [sticker] });
    return { success: true, message: `Sent sticker "${sticker.name}"` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to send sticker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const postStickerCommand: CommandDef<{ stickerName: string }> = {
  name: "postSticker",
  args: { stickerName: "string" },
  description: "Send a sticker from the server. Use the exact sticker name from the available stickers list.",
  kind: "instant",
  enabled: () => true,
  execute: async (args, ctx) => postSticker(args as { stickerName: string }, ctx.message),
};

// memory book edit. persists via the per-bot memory store.
export const editOrAddToLorebookCommand: CommandDef<{
  entryName: string;
  keywords: string[];
  content: string;
}> = {
  name: "editOrAddToLorebook",
  args: { entryName: "string", keywords: ["name1", "..."], content: "string" },
  description: `You can create or update existing lorebook entries about people or things you learn. Do this when you learn something new about a user.
      You can also add entries but please only update entries that you can see the value of.
      Keywords are what trigger the entry to be included in context, so use them wisely, its smart to add userid, username and displayname, along with possible nicknames or descriptive keywords.`,
  kind: "instant",
  enabled: (config) => config.allowLorebookEditing,
  execute: async (args, ctx) => {
    const { entryName, keywords, content } = args as { entryName: string; keywords: string[]; content: string };
    if (!entryName || typeof entryName !== "string") return { success: false, message: "Invalid entryName argument" };
    if (!keywords || !Array.isArray(keywords))
      return { success: false, message: "Invalid keywords argument (must be array)" };
    if (!content || typeof content !== "string") return { success: false, message: "Invalid content argument" };
    if (!ctx.config.allowLorebookEditing) return { success: false, message: "Lorebook editing is disabled" };

    try {
      const isExisting = ctx.chatMemoryBook.entries.some(
        (e) => (e.name ?? "").toLowerCase() === entryName.toLowerCase(),
      );
      const updated = await ctx.upsertMemoryEntry(ctx.chatMemoryBook, entryName, keywords, content);
      ctx.onChatMemoryUpdate?.(updated);
      return { success: true, message: `Memory entry "${entryName}" ${isExisting ? "updated" : "created"}` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to edit memory book: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
