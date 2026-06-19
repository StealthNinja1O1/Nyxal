// the discord library seam. bot logic talks to this interface; the only file
// that imports discord.js Client/Events/intents is the DiscordJsClient
// kept it this way to possibly switch to discorddeno later

import type { Message, Interaction, PresenceStatusData } from "discord.js";

export interface PresenceInput {
  activities: { name: string; type: number }[];
  status: PresenceStatusData;
}

export interface DiscordClientEvents {
  onReady: (userId: string | null, userTag: string | null) => void;
  onMessage: (message: Message) => void;
  onInteraction: (interaction: Interaction) => void;
}

export interface DiscordClient {
  login(token: string): Promise<void>;
  destroy(): Promise<void>;
  setPresence(presence: PresenceInput): void;
  getUserId(): string | null;
  raw(): unknown;
  setUserStatusIntent(enabled: boolean): void;
}

export function isTextBasedChannel(channel: unknown): boolean {
  return !!channel && typeof (channel as any).isTextBased === "function" && (channel as any).isTextBased();
}
