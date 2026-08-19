// Persistence for conversation summaries + the per bot, channel
//
// Summaries are stored as ordered segments (seq 0,1,2,...). A channel's
// verbatim history excludes anything with message id <= lastSummarizedMessageId
//
// Snowflake ids are monotonic by time, so id comparison = chronological
// comparison. We compare as BigInt to be safe

import { db } from "../../db";
import { chatSummaries, chatSummaryState } from "../../db/schema";
import { and, asc, eq } from "drizzle-orm";
import { encode } from "gpt-tokenizer";
import { newId } from "../../db/ids";

function estimateTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
export interface SummaryRow {
  id: string;
  botId: string;
  channelId: string;
  seq: number;
  content: string;
  startMessageId: string | null;
  endMessageId: string | null;
  tokenEstimate: number;
  createdAt: number;
}

export interface SummaryState {
  botId: string;
  channelId: string;
  lastSummarizedMessageId: string | null;
  updatedAt: number;
}

function rowToSummary(row: typeof chatSummaries.$inferSelect): SummaryRow {
  return {
    id: row.id,
    botId: row.botId,
    channelId: row.channelId,
    content: row.content,
    startMessageId: row.startMessageId,
    endMessageId: row.endMessageId,
    tokenEstimate: row.tokenEstimate,
    createdAt: row.createdAt.getTime(),
  };
}

/** Load all summaries for a channel, oldest-first. */
export async function loadSummaries(botId: string, channelId: string): Promise<SummaryRow[]> {
  const rows = await db
    .select()
    .from(chatSummaries)
    .where(and(eq(chatSummaries.botId, botId), eq(chatSummaries.channelId, channelId)))
    .orderBy(asc(chatSummaries.seq));
  return rows.map(rowToSummary);
}

/** Get the summarization watermark for a channel (null if never summarized). */
export async function loadSummaryState(botId: string, channelId: string): Promise<SummaryState | null> {
  const [row] = await db
    .select()
    .from(chatSummaryState)
    .where(and(eq(chatSummaryState.botId, botId), eq(chatSummaryState.channelId, channelId)));
  if (!row) return null;
  return {
    botId: row.botId,
    channelId: row.channelId,
    lastSummarizedMessageId: row.lastSummarizedMessageId,
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * Persist a new summary segment and advance the watermark in one go.
 * Also enforces the max-summaries cap via FIFO drop when over the limit.
 * Returns the resulting full summary list for the channel (oldest-first).
 */
export async function addSummary(
  botId: string,
  channelId: string,
  content: string,
  startMessageId: string | null,
  endMessageId: string | null,
  tokenEstimate: number,
  maxSummaries: number,
): Promise<SummaryRow[]> {
  const now = new Date();
  const existing = await db
    .select()
    .from(chatSummaries)
    .where(and(eq(chatSummaries.botId, botId), eq(chatSummaries.channelId, channelId)))
    .orderBy(asc(chatSummaries.seq));
  const nextSeq = existing.length > 0 ? existing[existing.length - 1]!.seq + 1 : 0;

  await db.insert(chatSummaries).values({
    id: newId(),
    botId,
    channelId,
    seq: nextSeq,
    content,
    startMessageId,
    endMessageId,
    tokenEstimate,
    createdAt: now,
  });

  // upsert watermark
  const [stateRow] = await db
    .select()
    .from(chatSummaryState)
    .where(and(eq(chatSummaryState.botId, botId), eq(chatSummaryState.channelId, channelId)));
  if (stateRow) {
    await db
      .update(chatSummaryState)
      .set({ lastSummarizedMessageId: endMessageId, updatedAt: now })
      .where(and(eq(chatSummaryState.botId, botId), eq(chatSummaryState.channelId, channelId)));
  } else {
    await db.insert(chatSummaryState).values({
      botId,
      channelId,
      lastSummarizedMessageId: endMessageId,
      updatedAt: now,
    });
  }

  // FIFO enforce the cap
  if (maxSummaries > 0) {
    const all = await db
      .select()
      .from(chatSummaries)
      .where(and(eq(chatSummaries.botId, botId), eq(chatSummaries.channelId, channelId)))
      .orderBy(asc(chatSummaries.seq));
    const overflow = all.slice(0, Math.max(0, all.length - maxSummaries));
    for (const row of overflow) await db.delete(chatSummaries).where(eq(chatSummaries.id, row.id));
  }

  return loadSummaries(botId, channelId);
}

/** Load every summary for a bot across all channels, oldest-first per channel. */
export async function loadAllSummaries(botId: string): Promise<SummaryRow[]> {
  const rows = await db
    .select()
    .from(chatSummaries)
    .where(eq(chatSummaries.botId, botId))
    .orderBy(asc(chatSummaries.channelId), asc(chatSummaries.seq));
  return rows.map(rowToSummary);
}

/** Edit a summary's text in place. Recomputes the token estimate. */
export async function updateSummaryContent(botId: string, summaryId: string, content: string): Promise<void> {
  await db
    .update(chatSummaries)
    .set({ content, tokenEstimate: estimateTokens(content) })
    .where(and(eq(chatSummaries.id, summaryId), eq(chatSummaries.botId, botId)));
}

/**
 * Delete a single summary and recompute the channel watermark from the remaining rows.
 * If the deleted segment's messages are still within the fetch window they will return
 * and can be re-summarized
 * Returns the channelId so the caller can report it, or null if the row was not found.
 */
export async function deleteSummaryById(botId: string, summaryId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(chatSummaries)
    .where(and(eq(chatSummaries.id, summaryId), eq(chatSummaries.botId, botId)));
  if (!row) return null;

  await db.delete(chatSummaries).where(eq(chatSummaries.id, summaryId));

  const remaining = await db
    .select()
    .from(chatSummaries)
    .where(and(eq(chatSummaries.botId, botId), eq(chatSummaries.channelId, row.channelId)))
    .orderBy(asc(chatSummaries.seq));

  const newWatermark = remaining.length > 0 ? remaining[remaining.length - 1]!.endMessageId : null;
  if (remaining.length === 0) {
    await db
      .delete(chatSummaryState)
      .where(and(eq(chatSummaryState.botId, botId), eq(chatSummaryState.channelId, row.channelId)));
  } else {
    await db
      .update(chatSummaryState)
      .set({ lastSummarizedMessageId: newWatermark, updatedAt: new Date() })
      .where(and(eq(chatSummaryState.botId, botId), eq(chatSummaryState.channelId, row.channelId)));
  }
  return row.channelId;
}

/** Delete all summaries and state for a channel */
export async function clearSummaries(botId: string, channelId: string): Promise<void> {
  await db.delete(chatSummaries).where(and(eq(chatSummaries.botId, botId), eq(chatSummaries.channelId, channelId)));
  await db
    .delete(chatSummaryState)
    .where(and(eq(chatSummaryState.botId, botId), eq(chatSummaryState.channelId, channelId)));
}

/**
 * Compare two discord snowflakes chronologically. Returns true if a is older
 * than b. Falls back to lexicographic if either is null/non-numeric.
 */
export function snowflakeLte(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    try {
      return BigInt(a) <= BigInt(b);
    } catch {
    }
  }
  return a <= b;
}
