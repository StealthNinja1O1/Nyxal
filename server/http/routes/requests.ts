// LLM request capture viewer.
//
// GET /api/bots/:id/requests   last 25 captured request bodies, newest first

import { Elysia } from "elysia";
import { db } from "../../db";
import { llmRequestCapture } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import { encode } from "gpt-tokenizer";
import type { LlmRequestCapture } from "../../../shared/types";

// same estimator the bot uses (server/bot/utils/tokenCounter.ts)
function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export const requestsRoutes = new Elysia({ prefix: "/api/bots" }).get("/:id/requests", async ({ params }) => {
  const rows = await db
    .select()
    .from(llmRequestCapture)
    .where(eq(llmRequestCapture.botId, params.id))
    .orderBy(desc(llmRequestCapture.id))
    .limit(25);

  const captures: LlmRequestCapture[] = rows.map((r) => {
    // token estimates over the sanitized capture: system prompt + tools field.
    // cheap (~ms per row) and keeps gpt-tokenizer out of the web bundle.
    const system = r.messages.find((m) => m.role === "system");
    const systemTokens =
      system && typeof system.content === "string" ? countTokens(system.content) : undefined;
    const toolsTokens = r.tools ? countTokens(JSON.stringify(r.tools)) : undefined;
    return {
      id: r.id,
      source: r.source,
      model: r.model,
      temperature: r.temperature,
      messages: r.messages,
      tools: r.tools ?? null,
      tokenStats:
        systemTokens !== undefined || toolsTokens !== undefined
          ? { system: systemTokens, tools: toolsTokens }
          : null,
      promptTokens: r.promptTokens,
      success: r.success,
      createdAt: r.createdAt.getTime(),
    };
  });
  return { captures };
});
