// discord.js implementation of the DiscordClient seam. the only bot file that imports the discord.js client

import {
  Client,
  GatewayIntentBits,
  Events,
  type Message,
  type Interaction,
} from "discord.js";
import type { DiscordClient, DiscordClientEvents, PresenceInput } from "./DiscordClient";

export class DiscordJsClient implements DiscordClient {
  private client: Client;
  private userId: string | null = null;

  constructor(events: DiscordClientEvents, enableUserStatus: boolean) {
    const intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ];
    if (enableUserStatus) intents.push(GatewayIntentBits.GuildPresences);

    this.client = new Client({ intents });

    this.client.once(Events.ClientReady, (c) => {
      this.userId = c.user.id;
      events.onReady(c.user.id, c.user.tag);
    });
    this.client.on(Events.MessageCreate, (msg: Message) => events.onMessage(msg));
    this.client.on(Events.InteractionCreate, (i: Interaction) => events.onInteraction(i));
  }

  async login(token: string): Promise<void> {
    await this.client.login(token);
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }

  setPresence(presence: PresenceInput): void {
    try {
      this.client.user?.setPresence({
        activities: presence.activities.map((a) => ({ name: a.name, type: a.type as any })),
        status: presence.status,
      });
    } catch {
    }
  }

  getUserId(): string | null {
    return this.userId;
  }

  raw(): unknown {
    return this.client;
  }

  setUserStatusIntent(_enabled: boolean): void {
    // intents are fixed at client construction, cant be changed without reboot which the botmanager does
  }
}
