import { Elysia, t } from "elysia";
import { db } from "../../db";
import { llmProviders } from "../../db/schema";
import { eq } from "drizzle-orm";
import { newId, nowMs } from "../../db/ids";

/** Public-facing shape — never returns the raw api_key. */
type ProviderPublic = {
  id: string;
  name: string;
  baseUrl: string;
  /** Masked key, e.g. "sk-…3f2a". null if unset. */
  apiKeyMasked: string | null;
  hasKey: boolean;
  createdAt: number;
  updatedAt: number;
};

function mask(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function toPublic(row: typeof llmProviders.$inferSelect): ProviderPublic {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKeyMasked: mask(row.apiKey || null),
    hasKey: !!row.apiKey,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * Lists available models for a provider by calling GET <base_url>/models with
 * its api key. Used by the dashboard's model picker and the test endpoint.
 *
 * Handles the standard OpenAI shape ({ data: [{ id }] }) and bare arrays.
 */
export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Provider returned ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as { data?: { id?: string }[]; id?: string }[] | { data?: { id?: string }[] };
  const arr = Array.isArray(json) ? json : json.data ?? [];
  return arr
    .map((m) => m?.id)
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

export const providersRoutes = new Elysia({ prefix: "/api/providers" })
  // ── list ──
  .get("/", async () => {
    const rows = await db.select().from(llmProviders).orderBy(llmProviders.createdAt);
    return rows.map(toPublic);
  })

  // ── get one (returns the masked public shape) ──
  .get("/:id", async ({ params, set }) => {
    const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "Provider not found" };
    }
    return toPublic(row);
  })

  // ── create ──
  .post(
    "/",
    async ({ body }) => {
      const id = newId();
      const ts = new Date(nowMs());
      await db.insert(llmProviders).values({
        id,
        name: body.name,
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
        apiKey: body.apiKey,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, id));
      return toPublic(row!);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        baseUrl: t.String({ minLength: 1 }),
        apiKey: t.String(),
      }),
    },
  )

  // ── update ──
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const [existing] = await db.select().from(llmProviders).where(eq(llmProviders.id, params.id));
      if (!existing) {
        set.status = 404;
        return { error: "Provider not found" };
      }
      await db
        .update(llmProviders)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.baseUrl !== undefined && { baseUrl: body.baseUrl.replace(/\/+$/, "") }),
          ...(body.apiKey !== undefined && { apiKey: body.apiKey }),
          updatedAt: new Date(nowMs()),
        })
        .where(eq(llmProviders.id, params.id));
      const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, params.id));
      return toPublic(row!);
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        baseUrl: t.Optional(t.String({ minLength: 1 })),
        /** Omit to keep the existing key. */
        apiKey: t.Optional(t.String()),
      }),
    },
  )

  // ── delete ──
  .delete("/:id", async ({ params, set }) => {
    const [existing] = await db.select().from(llmProviders).where(eq(llmProviders.id, params.id));
    if (!existing) {
      set.status = 404;
      return { error: "Provider not found" };
    }
    await db.delete(llmProviders).where(eq(llmProviders.id, params.id));
    return { ok: true };
  })

  // ── live model list (server-side proxy — OpenAI APIs don't send CORS) ──
  .get("/:id/models", async ({ params, set }) => {
    const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "Provider not found" };
    }
    try {
      const models = await fetchProviderModels(row.baseUrl, row.apiKey);
      return { models };
    } catch (err) {
      set.status = 502;
      return { error: err instanceof Error ? err.message : "Failed to fetch models" };
    }
  })

  // ── test connection (cheap probe: just lists models) ──
  .post("/:id/test", async ({ params, set }) => {
    const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "Provider not found" };
    }
    const start = nowMs();
    try {
      const models = await fetchProviderModels(row.baseUrl, row.apiKey);
      return { ok: true, ms: nowMs() - start, modelCount: models.length, sample: models.slice(0, 8) };
    } catch (err) {
      set.status = 502;
      return { ok: false, ms: nowMs() - start, error: err instanceof Error ? err.message : "Failed" };
    }
  });
