// LLM request capture viewer.
//
// GET /api/bots/:id/requests   last 25 captured request bodies, newest first

import { Elysia } from "elysia";
import { db } from "../../db";
import { llmRequestCapture } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import type { LlmRequestCapture } from "../../../shared/types";

export const requestsRoutes = new Elysia({ prefix: "/api/bots" }).get("/:id/requests", async ({ params }) => {
  const rows = await db
    .select()
    .from(llmRequestCapture)
    .where(eq(llmRequestCapture.botId, params.id))
    .orderBy(desc(llmRequestCapture.id))
    .limit(25);

  const captures: LlmRequestCapture[] = rows.map((r) => ({
    id: r.id,
    source: r.source,
    model: r.model,
    temperature: r.temperature,
    messages: r.messages,
    promptTokens: r.promptTokens,
    success: r.success,
    createdAt: r.createdAt.getTime(),
  }));
  return { captures };
});
