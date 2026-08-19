// Conversation summaries viewer/editor routes.
//
// GET    /api/bots/:id/summaries                 list all summaries grouped by channel
// PATCH  /api/bots/:id/summaries/:sid            edit summary text { content }
// DELETE /api/bots/:id/summaries/:sid            delete one (recomputes the watermark)
// DELETE /api/bots/:id/summaries?channelId=x     clear every summary in a channel
//
// Edits never touch the watermark. Deletes recompute it from the remaining
// rows (see summaryStore.deleteSummaryById).

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { chatSummaryState } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  loadAllSummaries,
  updateSummaryContent,
  deleteSummaryById,
  clearSummaries,
  type SummaryRow,
} from "../../bot/stores/summaryStore";

export interface SummaryWire {
  id: string;
  seq: number;
  content: string;
  tokenEstimate: number;
  startMessageId: string | null;
  endMessageId: string | null;
  createdAt: number;
}

export interface SummaryChannelGroupWire {
  channelId: string;
  watermark: string | null;
  summaries: SummaryWire[];
}

function toWire(row: SummaryRow): SummaryWire {
  return {
    id: row.id,
    seq: row.seq,
    content: row.content,
    tokenEstimate: row.tokenEstimate,
    startMessageId: row.startMessageId,
    endMessageId: row.endMessageId,
    createdAt: row.createdAt,
  };
}

export const summariesRoutes = new Elysia({ prefix: "/api/bots" })
  .get("/:id/summaries", async ({ params, set }) => {
    const rows = await loadAllSummaries(params.id);
    const states = await db
      .select()
      .from(chatSummaryState)
      .where(eq(chatSummaryState.botId, params.id));

    const byChannel = new Map<string, SummaryWire[]>();
    for (const row of rows) {
      const list = byChannel.get(row.channelId) ?? [];
      list.push(toWire(row));
      byChannel.set(row.channelId, list);
    }

    const groups: SummaryChannelGroupWire[] = [];
    for (const [channelId, summaries] of byChannel) {
      const state = states.find((s) => s.channelId === channelId);
      groups.push({
        channelId,
        watermark: state?.lastSummarizedMessageId ?? null,
        summaries, // already seq-ascending (oldest recap first)
      });
    }
    // most recently active channel on top
    groups.sort((a, b) => {
      const aLast = a.summaries[a.summaries.length - 1]?.createdAt ?? 0;
      const bLast = b.summaries[b.summaries.length - 1]?.createdAt ?? 0;
      return bLast - aLast;
    });
    return { channels: groups };
  })

  .patch(
    "/:id/summaries/:sid",
    async ({ params, body, set }) => {
      const content = body.content.trim();
      if (!content) {
        set.status = 400;
        return { error: "Content cannot be empty" };
      }
      await updateSummaryContent(params.id, params.sid, content);
      return { ok: true };
    },
    { body: t.Object({ content: t.String({ minLength: 1 }) }) },
  )

  .delete("/:id/summaries/:sid", async ({ params, set }) => {
    const channelId = await deleteSummaryById(params.id, params.sid);
    if (channelId === null) {
      set.status = 404;
      return { error: "Summary not found" };
    }
    return { ok: true, channelId };
  })

  .delete("/:id/summaries", async ({ params, query, set }) => {
    if (!query.channelId) {
      set.status = 400;
      return { error: "channelId query param required" };
    }
    await clearSummaries(params.id, query.channelId);
    return { ok: true };
  });
