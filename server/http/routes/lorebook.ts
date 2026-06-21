// lorebook-style entries CRUD. shared columns for static lorebook + memory,
// so one route file serves both via a `book` param ("static" | "memory").
//
// GET    /api/bots/:id/lorebook/:book          list entries
// POST   /api/bots/:id/lorebook/:book          create entry
// PATCH  /api/bots/:id/lorebook/:book/:entryId update entry
// DELETE /api/bots/:id/lorebook/:book/:entryId delete entry
//
// POST   /api/bots/:id/lorebook/:book/import   bulk import from parsed JSON
//
// character.json + chatMemory.json imports are client-side parsed into the
// entry shape and pushed via the import endpoint. no server file io.

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { staticLorebookEntries, memoryEntries } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { botManager } from "../../bot/BotManager";
import { dbRowFromEntry } from "../../bot/stores/characterStore";
import type { CharacterBookEntry } from "../../bot/lorebook/types";

function tableFor(book: "static" | "memory") {
  return book === "static" ? staticLorebookEntries : memoryEntries;
}

export interface EntryWire {
  id: string;
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  caseSensitive: boolean;
  selective: boolean;
  secondaryKeys: string[];
  selectiveLogic: number;
  constant: boolean;
  priority: number;
  order: number;
  scanDepth: number | null;
  probability: number;
  useProbability: boolean;
  extensions: Record<string, unknown>;
  updatedAt: number;
}

function rowToWire(row: typeof staticLorebookEntries.$inferSelect): EntryWire {
  return {
    id: row.id,
    name: row.name,
    keys: row.keys,
    content: row.content,
    enabled: row.enabled,
    caseSensitive: row.caseSensitive,
    selective: row.selective,
    secondaryKeys: row.secondaryKeys,
    selectiveLogic: row.selectiveLogic,
    constant: row.constant,
    priority: row.priority,
    order: row.order,
    scanDepth: row.scanDepth,
    probability: row.probability,
    useProbability: row.useProbability,
    extensions: row.extensions,
    updatedAt: row.updatedAt.getTime(),
  };
}

function wireToBookEntry(e: Omit<EntryWire, "id" | "updatedAt">): CharacterBookEntry {
  return {
    name: e.name,
    keys: e.keys,
    content: e.content,
    enabled: e.enabled,
    case_sensitive: e.caseSensitive,
    selective: e.selective,
    secondary_keys: e.secondaryKeys,
    keysecondary: e.secondaryKeys,
    selectiveLogic: e.selectiveLogic,
    constant: e.constant,
    priority: e.priority,
    order: e.order,
    scanDepth: e.scanDepth,
    probability: e.probability,
    useProbability: e.useProbability,
    extensions: e.extensions,
  };
}

export const lorebookRoutes = new Elysia({ prefix: "/api/bots/:id/lorebook" })
  .get("/:book", async ({ params, set }) => {
    if (params.book !== "static" && params.book !== "memory") {
      set.status = 400;
      return { error: "book must be 'static' or 'memory'" };
    }
    const table = tableFor(params.book);
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.botId, params.id))
      .orderBy(table.order, table.name);
    return rows.map(rowToWire);
  })

  .post(
    "/:book",
    async ({ params, body, set }) => {
      if (params.book !== "static" && params.book !== "memory") {
        set.status = 400;
        return { error: "book must be 'static' or 'memory'" };
      }
      const table = tableFor(params.book);
      const now = new Date();
      const row = dbRowFromEntry(params.id, wireToBookEntry(body as EntryWire), now);
      // dbRowFromEntry makes its own id; override with none so the db keeps it
      await db.insert(table).values(row);
      const [inserted] = await db
        .select()
        .from(table)
        .where(eq(table.id, row.id));
      return rowToWire(inserted!);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        keys: t.Array(t.String()),
        content: t.String(),
        enabled: t.Boolean(),
        caseSensitive: t.Boolean(),
        selective: t.Boolean(),
        secondaryKeys: t.Array(t.String()),
        selectiveLogic: t.Integer(),
        constant: t.Boolean(),
        priority: t.Integer(),
        order: t.Integer(),
        scanDepth: t.Union([t.Null(), t.Integer()]),
        probability: t.Integer(),
        useProbability: t.Boolean(),
        extensions: t.Record(t.String(), t.Unknown()),
      }),
    },
  )

  .patch(
    "/:book/:entryId",
    async ({ params, body, set }) => {
      if (params.book !== "static" && params.book !== "memory") {
        set.status = 400;
        return { error: "book must be 'static' or 'memory'" };
      }
      const table = tableFor(params.book);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const map: Record<string, keyof typeof staticLorebookEntries.$inferSelect> = {
        name: "name",
        keys: "keys",
        content: "content",
        enabled: "enabled",
        caseSensitive: "caseSensitive",
        selective: "selective",
        secondaryKeys: "secondaryKeys",
        selectiveLogic: "selectiveLogic",
        constant: "constant",
        priority: "priority",
        order: "order",
        scanDepth: "scanDepth",
        probability: "probability",
        useProbability: "useProbability",
        extensions: "extensions",
      };
      for (const [k, col] of Object.entries(map)) {
        if (body[k as keyof typeof body] !== undefined) patch[col] = body[k as keyof typeof body];
      }
      await db
        .update(table)
        .set(patch)
        .where(and(eq(table.id, params.entryId), eq(table.botId, params.id)));

      const [updated] = await db
        .select()
        .from(table)
        .where(eq(table.id, params.entryId));
      if (!updated) {
        set.status = 404;
        return { error: "Entry not found" };
      }
      return rowToWire(updated);
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        keys: t.Optional(t.Array(t.String())),
        content: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        caseSensitive: t.Optional(t.Boolean()),
        selective: t.Optional(t.Boolean()),
        secondaryKeys: t.Optional(t.Array(t.String())),
        selectiveLogic: t.Optional(t.Integer()),
        constant: t.Optional(t.Boolean()),
        priority: t.Optional(t.Integer()),
        order: t.Optional(t.Integer()),
        scanDepth: t.Optional(t.Union([t.Null(), t.Integer()])),
        probability: t.Optional(t.Integer()),
        useProbability: t.Optional(t.Boolean()),
        extensions: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  )

  .delete("/:book/:entryId", async ({ params, set }) => {
    if (params.book !== "static" && params.book !== "memory") {
      set.status = 400;
      return { error: "book must be 'static' or 'memory'" };
    }
    const table = tableFor(params.book);
    const [existing] = await db
      .select()
      .from(table)
      .where(and(eq(table.id, params.entryId), eq(table.botId, params.id)));
    if (!existing) {
      set.status = 404;
      return { error: "Entry not found" };
    }
    await db.delete(table).where(eq(table.id, params.entryId));
    return { ok: true };
  })

  //  bulk import (parsed client-side) 
  // mode: "merge" (default) keeps existing entries, "replace" wipes the book first
  .post(
    "/:book/import",
    async ({ params, body, set }) => {
      if (params.book !== "static" && params.book !== "memory") {
        set.status = 400;
        return { error: "book must be 'static' or 'memory'" };
      }
      const table = tableFor(params.book);
      const mode = body.mode ?? "merge";
      if (mode === "replace") {
        await db.delete(table).where(eq(table.botId, params.id));
      }
      const now = new Date();
      const inserted: string[] = [];
      for (const e of body.entries) {
        const row = dbRowFromEntry(params.id, wireToBookEntry(e), now);
        await db.insert(table).values(row);
        inserted.push(row.id);
      }
      // refresh the bot's in-memory book if it's running
      if (params.book === "static") await botManager.refreshCharacter(params.id).catch(() => {});
      else await botManager.refreshMemory(params.id).catch(() => {});
      return { ok: true, imported: inserted.length };
    },
    {
      body: t.Object({
        mode: t.Optional(t.Union([t.Literal("merge"), t.Literal("replace")])),
        entries: t.Array(
          t.Object({
            name: t.String({ minLength: 1 }),
            keys: t.Array(t.String()),
            content: t.String(),
            enabled: t.Boolean(),
            caseSensitive: t.Boolean(),
            selective: t.Boolean(),
            secondaryKeys: t.Array(t.String()),
            selectiveLogic: t.Integer(),
            constant: t.Boolean(),
            priority: t.Integer(),
            order: t.Integer(),
            scanDepth: t.Union([t.Null(), t.Integer()]),
            probability: t.Integer(),
            useProbability: t.Boolean(),
            extensions: t.Record(t.String(), t.Unknown()),
          }),
        ),
      }),
    },
  );
