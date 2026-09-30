import type { Interaction } from "discord.js";
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
  private warnedAmbiguousPrimaries = new Set<string>();

  // several bots may share one Discord token; discord then delivers every
  // interaction to each of them. exactly one gets to answer: the bot that has
  // the channel linked, else the deterministic respondsToCommands pick.
  shouldHandleInteraction(bot: DiscordBot, interaction: Interaction): boolean {
    const group = [...this.instances.values()].filter(
      (b) => b.config.botToken === bot.config.botToken,
    );
    if (group.length <= 1) return true;

    const channelId = interaction.channelId;
    if (channelId) {
      const owners = group.filter((b) => b.config.channelIds.includes(channelId));
      if (owners.length === 1) return owners[0] === bot;
    }

    const primaries = group
      .filter((b) => b.config.respondsToCommands)
      .sort((a, b) => (a.config.botId < b.config.botId ? -1 : 1));
    if (primaries.length > 1 && !this.warnedAmbiguousPrimaries.has(bot.config.botToken)) {
      this.warnedAmbiguousPrimaries.add(bot.config.botToken);
      systemLog.warn(
        `Multiple bots with handles-commands enabled share one token; "${primaries[0]!.config.name}" answers commands in unlinked channels`,
      );
    }
    return primaries[0] === bot;
  }

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

      const bot = new DiscordBot({
        config,
        character,
        chatMemoryBook,
        log: logger,
        shouldHandleInteraction: (b, i) => this.shouldHandleInteraction(b, i),
      });
      this.instances.set(botId, bot);

      const sameToken = [...this.instances.values()].filter(
        (b) => b !== bot && b.config.botToken === config.botToken,
      );
      if (sameToken.length > 0)
        systemLog.warn(
          `Bot "${row.name}" shares a Discord token with ${sameToken.map((b) => `"${b.config.name}"`).join(", ")} - keep their channel lists disjoint or both reply to the same messages`,
        );

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

  /**
   * Force a running bot to re-pull MCP tool defs from the DB. used after a
   * manual "refetch" on an MCP server (mcp_tools rows changed). 
   */
  async refreshMcpTools(botId: string): Promise<boolean> {
    const bot = this.instances.get(botId);
    if (!bot) return false;
    await bot.refreshMcpTools(true);
    return true;
  }

  /**
   * Refresh MCP tools for every running bot that has the given server enabled
   */
  async refreshMcpForServer(serverId: string): Promise<void> {
    for (const bot of this.instances.values()) {
      const cfg = bot.getConfig();
      if (cfg.mcpServerIds.includes(serverId)) {
        await bot.refreshMcpTools(true).catch((err) => bot.log.error("MCP refresh failed:", err));
      }
    }
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
