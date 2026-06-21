// comfyui workflows CRUD. shared resource (like llm_providers) - bots reference
// any number of them via bots.comfyuiWorkflowIds (JSON array); the default
// one is bots.comfyuiDefaultWorkflowId. the workflow JSON lives in `content`.
//
// GET    /api/workflows           list
// POST   /api/workflows           create
// GET    /api/workflows/:id       get one (with full content)
// PATCH  /api/workflows/:id       update name/description/content
// DELETE /api/workflows/:id       delete (drops the id from any bot that referenced it)

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { comfyuiWorkflows, bots } from "../../db/schema";
import { eq } from "drizzle-orm";
import { botManager } from "../../bot/BotManager";
import { newId, nowMs } from "../../db/ids";

/** Find bots that have `workflowId` in their comfyuiWorkflowIds array. */
async function botsUsingWorkflow(workflowId: string) {
  const all = await db.select().from(bots);
  return all.filter((b) => (b.comfyuiWorkflowIds ?? []).includes(workflowId));
}

// list shape - omits the content blob
function toList(row: typeof comfyuiWorkflows.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export const workflowsRoutes = new Elysia({ prefix: "/api/workflows" })
  .get("/", async () => {
    const rows = await db.select().from(comfyuiWorkflows).orderBy(comfyuiWorkflows.createdAt);
    return rows.map(toList);
  })

  .post(
    "/",
    async ({ body }) => {
      const id = newId();
      const ts = new Date(nowMs());
      await db.insert(comfyuiWorkflows).values({
        id,
        name: body.name,
        description: body.description ?? "",
        content: body.content,
        createdAt: ts,
        updatedAt: ts,
      });
      const [row] = await db.select().from(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, id));
      return row!;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        content: t.Record(t.String(), t.Unknown()),
      }),
    },
  )

  .get("/:id", async ({ params, set }) => {
    const [row] = await db.select().from(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "Workflow not found" };
    }
    return row;
  })

  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const [existing] = await db.select().from(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, params.id));
      if (!existing) {
        set.status = 404;
        return { error: "Workflow not found" };
      }
      await db
        .update(comfyuiWorkflows)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.content !== undefined && { content: body.content }),
          updatedAt: new Date(nowMs()),
        })
        .where(eq(comfyuiWorkflows.id, params.id));

      // hot-reload any running bot that uses this workflow
      const usingBots = await botsUsingWorkflow(params.id);
      for (const b of usingBots) {
        await botManager.refreshConfig(b.id).catch(() => {});
      }

      const [updated] = await db.select().from(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, params.id));
      return updated!;
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.String()),
        content: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  )

  .delete("/:id", async ({ params, set }) => {
    const [existing] = await db.select().from(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, params.id));
    if (!existing) {
      set.status = 404;
      return { error: "Workflow not found" };
    }
    // drop the id from any bot's comfyuiWorkflowIds array + clear default if it was it
    const usingBots = await botsUsingWorkflow(params.id);
    for (const b of usingBots) {
      const next = (b.comfyuiWorkflowIds ?? []).filter((id) => id !== params.id);
      const nextDefault = b.comfyuiDefaultWorkflowId === params.id ? null : b.comfyuiDefaultWorkflowId;
      await db
        .update(bots)
        .set({ comfyuiWorkflowIds: next, comfyuiDefaultWorkflowId: nextDefault, updatedAt: new Date(nowMs()) })
        .where(eq(bots.id, b.id));
      await botManager.refreshConfig(b.id).catch(() => {});
    }
    await db.delete(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, params.id));
    return { ok: true };
  });
