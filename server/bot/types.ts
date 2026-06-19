import type { CharacterBook, CharacterBookEntry } from "./lorebook/types";
import type { DepthPrompt } from "./lorebook/types";

export interface RuntimeCharacter {
  name: string;
  description: string;
  mesExample: string;
  depthPrompt: DepthPrompt | null;
  character_book: CharacterBook | null;
}

export interface ChatMemoryBook {
  entries: CharacterBookEntry[];
}

export interface ImageAttachment {
  url: string;
  contentType: string;
  base64: string;
}

export interface ReactionInfo {
  emoji: string;
  userIds: string[];
  userNames: string[];
}

export type BotCommand =
  | { name: "react"; args: { emoji: string } }
  | { name: "renameSelf"; args: { newName: string } }
  | { name: "renameUser"; args: { userId: string; newName: string } }
  | { name: "editOrAddToLorebook"; args: { entryName: string; keywords: string[]; content: string } }
  | { name: "postSticker"; args: { stickerName: string } }
  | { name: "generateImage"; args: { prompt: string; orientation?: "portrait" | "square" | "landscape" } }
  | { name: "setBio"; args: { bio: string } }
  | { name: "webSearch"; args: { query: string } }
  | { name: "fetchWebpage"; args: { url: string } }
  | { name: "searchAndFetch"; args: { query: string; num_results?: number } }
  | { name: "deepResearch"; args: { queries: string[] } }
  | { name: "crawlSite"; args: { start_url: string; max_pages?: number; max_depth?: number } }
  | { name: string; args: Record<string, any> };

export interface AIResponse {
  reply: string;
  commands?: BotCommand[];
}
