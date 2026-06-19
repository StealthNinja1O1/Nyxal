// command metadata store, records the commands the bot ran per message id,
// so we can reconstruct the assistant logs

import { db } from "../../db";
import { commandMetadata } from "../../db/schema";
import { and, eq, lt } from "drizzle-orm";
import type { BotCommand } from "../types";
import type { Logger } from "../utils/logger";

const DEFAULT_TTL_MS = 2 * 30 * 24 * 60 * 60 * 1000; // ~2 months
const FLUSH_DEBOUNCE_MS = 3000;

interface PendingOp {
  kind: "upsert";
  messageId: string;
  channelId: string;
  commands: BotCommand[];
  createdAt: number;
}

export class CommandMetadataStore {
  private pending = new Map<string, PendingOp>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private botId: string,
    private log: Logger,
  ) {}

  record(messageId: string | undefined, channelId: string, commands: BotCommand[]): void {
    if (!messageId || !commands || commands.length === 0) return;
    this.pending.set(messageId, {
      kind: "upsert",
      messageId,
      channelId,
      commands,
      createdAt: Date.now(),
    });
    this.scheduleFlush();
  }

  // look up a message's commands. flushes first so the db is current.
  async lookup(messageId: string): Promise<BotCommand[] | null> {
    await this.flushNow();
    const [row] = await db
      .select()
      .from(commandMetadata)
      .where(eq(commandMetadata.messageId, messageId));
    if (!row) return null;
    return row.commands as BotCommand[];
  }

  // batch lookup for a set of message ids
  async lookupMany(ids: string[]): Promise<Map<string, BotCommand[]>> {
    await this.flushNow();
    const out = new Map<string, BotCommand[]>();
    if (ids.length === 0) return out;
    const rows = await db.select().from(commandMetadata).where(eq(commandMetadata.botId, this.botId));
    const wanted = new Set(ids);
    for (const row of rows) {
      if (wanted.has(row.messageId)) out.set(row.messageId, row.commands as BotCommand[]);
    }
    return out;
  }

  // drop rows for a channel whose message id is not in activeIds
  async cleanupByChannel(channelId: string, activeIds: Set<string>): Promise<void> {
    const rows = await db
      .select()
      .from(commandMetadata)
      .where(eq(commandMetadata.botId, this.botId));
    for (const row of rows) {
      if (row.channelId === channelId && !activeIds.has(row.messageId)) {
        await db.delete(commandMetadata).where(eq(commandMetadata.id, row.id));
      }
    }
  }

  // drop rows older than the ttl. runs on boot.
  async cleanupByTTL(maxAgeMs = DEFAULT_TTL_MS): Promise<void> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    await db.delete(commandMetadata).where(
      and(eq(commandMetadata.botId, this.botId), lt(commandMetadata.createdAt, cutoff)),
    );
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  async flushNow(): Promise<void> {
    if (!this.dirty || this.pending.size === 0) return;
    const ops = [...this.pending.values()];
    this.pending.clear();
    this.dirty = false;
    try {
      for (const op of ops) {
        const existing = await db
          .select()
          .from(commandMetadata)
          .where(eq(commandMetadata.messageId, op.messageId));
        for (const row of existing) {
          if (row.botId === this.botId) await db.delete(commandMetadata).where(eq(commandMetadata.id, row.id));
        }
        await db.insert(commandMetadata).values({
          id: crypto.randomUUID(),
          botId: this.botId,
          messageId: op.messageId,
          channelId: op.channelId,
          commands: op.commands,
          createdAt: new Date(op.createdAt),
        });
      }
    } catch (err) {
      this.log.error("Failed to flush command metadata:", err);
    }
  }
}
