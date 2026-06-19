import { db } from "../db";
import { bots } from "../db/schema";
import { eq } from "drizzle-orm";
import { resolveBotConfig, ensureCharacter } from "../config/resolveBotConfig";
import { loadCharacter } from "./stores/characterStore";
import { loadMemoryBook } from "./stores/memoryStore";
import { DiscordBot } from "./DiscordBot";
import { applyConfigUpdate } from "./configStore";
import { broadcast } from "./ws/hub";
import { createLogger, type LogLevel } from "./utils/logger";
import { log as systemLog } from "./utils/logger";

export type BotStatus = "stopped" | "starting" | "online" | "error" | "disabled";

export interface BotRuntimeInfo {
  botId: string;
  name: string;
  status: BotStatus;
  enabled: boolean;
  detail?: string;
  discordId?: string | null;
}

class BotManager {
  private instances = new Map<string, DiscordBot>();
  private statuses = new Map<string, BotRuntimeInfo>();

  list(): BotRuntimeInfo[] {
    return [...this.statuses.values()];
  }

  get(botId: string): DiscordBot | undefined {
    return this.instances.get(botId);
  }

  getStatus(botId: string): BotRuntimeInfo | undefined {
    return this.statuses.get(botId);
  }

  // boot all enabled bots. called once on server start.
  async startAll(): Promise<void> {
    const rows = await db.select().from(bots);
    for (const row of rows) {
      // seed an info entry even for disabled bots so the dashboard can list them
      if (!row.enabled) {
        this.statuses.set(row.id, {
          botId: row.id,
          name: row.name,
          status: "disabled",
          enabled: false,
        });
        continue;
      }
      await this.start(row.id).catch((err) => {
        systemLog.error(`Failed to start bot ${row.id} (${row.name}):`, err);
      });
    }
  }

  async start(botId: string): Promise<boolean> {
    if (this.instances.has(botId)) {
      systemLog.warn(`Bot ${botId} already running`);
      return false;
    }

    this.setStatus(botId, "starting");
    try {
      const [row] = await db.select().from(bots).where(eq(bots.id, botId));
      if (!row) throw new Error("Bot row not found");
      await ensureCharacter(botId);

      const config = await resolveBotConfig(row);
      const character = await loadCharacter(botId);
      const chatMemoryBook = await loadMemoryBook(botId);

      const logger = createLogger(`bot:${row.name}`, (config.logLevel.toUpperCase() as LogLevel) || "INFO", botId);

      const bot = new DiscordBot({ config, character, chatMemoryBook, log: logger });
      this.instances.set(botId, bot);

      await bot.start();
      this.statuses.set(botId, {
        botId,
        name: row.name,
        status: "online",
        enabled: true,
        discordId: bot.botDiscordId,
      });
      broadcast({
        type: "bot.status",
        botId,
        status: "online",
        name: row.name,
        detail: undefined,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // look up the name for a nicer error
      const [row] = await db.select().from(bots).where(eq(bots.id, botId));
      this.statuses.set(botId, {
        botId,
        name: row?.name ?? botId,
        status: "error",
        enabled: row?.enabled ?? true,
        detail: msg,
      });
      broadcast({
        type: "bot.status",
        botId,
        status: "error",
        name: row?.name ?? botId,
        detail: msg,
      });
      this.instances.delete(botId);
      systemLog.error(`Bot ${botId} failed to start:`, err);
      return false;
    }
  }

  async stop(botId: string): Promise<boolean> {
    const bot = this.instances.get(botId);
    if (!bot) return false;
    try {
      await bot.stop();
    } catch (err) {
      systemLog.error(`Bot ${botId} failed to stop cleanly:`, err);
    }
    this.instances.delete(botId);
    this.setStatus(botId, "stopped");
    return true;
  }

  async restart(botId: string): Promise<boolean> {
    await this.stop(botId);
    return this.start(botId);
  }

  /**
   * Re-resolve a bot's config from the db and live-apply it to the running
   * instance. returns whether a reconnect is required (token / intent changed).
   * No-op (returns restartRequired=false) if the bot isn't running.
   */
  async applyConfig(botId: string): Promise<{ restartRequired: boolean; reasons: string[]; running: boolean }> {
    const bot = this.instances.get(botId);
    const [row] = await db.select().from(bots).where(eq(bots.id, botId));
    if (!row) throw new Error("Bot row not found");
    if (!bot) return { restartRequired: false, reasons: [], running: false };

    const nextConfig = await resolveBotConfig(row);
    const result = await applyConfigUpdate(bot, nextConfig, bot.log);
    return { restartRequired: result.restartRequired, reasons: result.reasons, running: true };
  }

  // hot-reload a bot's character from the db
  async refreshCharacter(botId: string): Promise<boolean> {
    const bot = this.instances.get(botId);
    if (!bot) return false;
    const character = await loadCharacter(botId);
    bot.setCharacter(character);
    bot.log.info(`Character hot-reloaded: ${character.name}`);
    return true;
  }

  // hot-reload a bot's memory book from the db
  async refreshMemory(botId: string): Promise<boolean> {
    const bot = this.instances.get(botId);
    if (!bot) return false;
    const memory = await loadMemoryBook(botId);
    bot.setChatMemoryBook(memory);
    bot.log.info(`Memory book hot-reloaded: ${memory.entries.length} entries`);
    return true;
  }

  // re-resolve the bot's whole config (used after comfyui workflow / config blob
  // edits since those live on the bot row). returns restart command.
  async refreshConfig(botId: string): Promise<{ restartRequired: boolean; reasons: string[]; running: boolean }> {
    return this.applyConfig(botId);
  }

  async delete(botId: string): Promise<void> {
    if (this.instances.has(botId)) await this.stop(botId);
    this.statuses.delete(botId);
  }

  private setStatus(botId: string, status: BotStatus): void {
    const existing = this.statuses.get(botId);
    this.statuses.set(botId, {
      botId,
      name: existing?.name ?? botId,
      status,
      enabled: existing?.enabled ?? true,
      discordId: existing?.discordId,
    });
    const info = this.statuses.get(botId)!;
    broadcast({
      type: "bot.status",
      botId,
      status,
      name: info.name,
      detail: info.detail,
    });
  }
}

export const botManager = new BotManager();
