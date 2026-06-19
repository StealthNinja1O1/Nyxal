// bot lifecycle + CRUD + character routes.
//
// GET    /api/bots                       list bots with live status
// POST   /api/bots                       create a bot (+ empty character)
// GET    /api/bots/:id                   full detail (bot row + status)
// PATCH  /api/bots/:id                   update bot fields, returns restartRequired
// DELETE /api/bots/:id                   stop + delete
// POST   /api/bots/:id/start|stop|restart
// GET    /api/bots/:id/character         get character
// PUT    /api/bots/:id/character         update character (always live)

import { Elysia, t } from "elysia";
import { db } from "../../db";
import { bots, characters, mcpServers, mcpTools } from "../../db/schema";
import { eq, inArray } from "drizzle-orm";
import { botManager } from "../../bot/BotManager";
import { newBotDefaults, ensureCharacter, resolveBotConfig } from "../../config/resolveBotConfig";
import { BUILTIN_COMMANDS } from "../../bot/commands";
import { newId, nowMs } from "../../db/ids";
import type { ToolOverride } from "../../../shared/types";

type ToolOverrideShape = ToolOverride;

function maskToken(token: string): string {
  if (!token || token.length <= 8) return token ? "•".repeat(token.length) : "";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function botRowToPublic(row: typeof bots.$inferSelect) {
  const info = botManager.getStatus(row.id);
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    status: info?.status ?? (row.enabled ? "stopped" : "disabled"),
    detail: info?.detail,
    discordId: info?.discordId ?? null,
    discordTokenMasked: maskToken(row.discordToken),
    hasToken: !!row.discordToken,
    channelIds: row.channelIds,
    allowedUserIds: row.allowedUserIds,
    mentionTriggerAllowedUserIds: row.mentionTriggerAllowedUserIds,
    triggerKeywords: row.triggerKeywords,
    llmProviderId: row.llmProviderId,
    llmModel: row.llmModel,
    temperature: row.temperature,
    visionProviderId: row.visionProviderId,
    visionModel: row.visionModel,
    enableVision: row.enableVision,
    randomResponseRate: row.randomResponseRate,
    maxHistoryMessages: row.maxHistoryMessages,
    maxContextTokens: row.maxContextTokens,
    ignoreOtherBots: row.ignoreOtherBots,
    replyToMentions: row.replyToMentions,
    addTimestamps: row.addTimestamps,
    addNothink: row.addNothink,
    enableUserStatus: row.enableUserStatus,
    minResponseIntervalSeconds: row.minResponseIntervalSeconds,
    maxRecursionDepth: row.maxRecursionDepth,
    logLevel: row.logLevel,
    statusCfg: row.status,
    comfyui: row.comfyui,
    websearch: row.websearch,
    comfyuiWorkflowId: row.comfyuiWorkflowId,
    toolOverrides: row.toolOverrides ?? {},
    mcpServerIds: row.mcpServerIds ?? [],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export const botsRoutes = new Elysia({ prefix: "/api/bots" })
  .get("/", async () => {
    const rows = await db.select().from(bots).orderBy(bots.createdAt);
    return rows.map(botRowToPublic);
  })

  .post(
    "/",
    async ({ body }) => {
      const id = newId();
      const ts = new Date(nowMs());
      await db.insert(bots).values({
        id,
        name: body.name,
        enabled: body.enabled ?? false,
        discordToken: body.discordToken,
        llmProviderId: body.llmProviderId ?? null,
        llmModel: body.llmModel ?? "",
        ...newBotDefaults(),
        createdAt: ts,
        updatedAt: ts,
      });
      await ensureCharacter(id);
      if (body.characterName) {
        const [char] = await db.select().from(characters).where(eq(characters.botId, id));
        if (char)
          await db
            .update(characters)
            .set({ name: body.characterName, updatedAt: new Date() })
            .where(eq(characters.id, char.id));
      }
      const [row] = await db.select().from(bots).where(eq(bots.id, id));
      return botRowToPublic(row!);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        discordToken: t.String({ minLength: 1 }),
        llmProviderId: t.Optional(t.String()),
        llmModel: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        characterName: t.Optional(t.String()),
      }),
    },
  )

  .get("/:id", async ({ params, set }) => {
    const [row] = await db.select().from(bots).where(eq(bots.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "Bot not found" };
    }
    return botRowToPublic(row);
  })

  .patch(
    "/:id",
    async ({ params, body, set }) => {
      const [existing] = await db.select().from(bots).where(eq(bots.id, params.id));
      if (!existing) {
        set.status = 404;
        return { error: "Bot not found" };
      }

      const patch: Partial<typeof bots.$inferInsert> = { updatedAt: new Date(nowMs()) };
      const keys = [
        "name", "enabled", "discordToken", "channelIds", "allowedUserIds",
        "mentionTriggerAllowedUserIds", "triggerKeywords", "llmProviderId", "llmModel",
        "temperature", "visionProviderId", "visionModel", "enableVision",
        "randomResponseRate", "maxHistoryMessages", "maxContextTokens",
        "ignoreOtherBots", "replyToMentions", "addTimestamps", "addNothink",
        "enableUserStatus", "minResponseIntervalSeconds", "maxRecursionDepth", "logLevel",
        "status", "comfyui", "websearch", "comfyuiWorkflowId",
        "toolOverrides", "mcpServerIds",
      ] as const;
      for (const k of keys) {
        if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
      }

      await db.update(bots).set(patch).where(eq(bots.id, params.id));

      // live-apply if running, classify restart-required
      let restartRequired = false;
      let reasons: string[] = [];
      let applied = false;
      try {
        const result = await botManager.applyConfig(params.id);
        restartRequired = result.restartRequired;
        reasons = result.reasons;
        applied = result.running;
      } catch {
        // apply failed non-fatally; db write still succeeded
      }

      if (body.enabled === true) {
        const info = botManager.getStatus(params.id);
        if (info && info.status !== "online" && info.status !== "starting") {
          await botManager.start(params.id).catch(() => {});
        }
      }
      if (body.enabled === false) {
        await botManager.stop(params.id).catch(() => {});
      }

      return { ok: true, restartRequired, reasons, applied };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        enabled: t.Optional(t.Boolean()),
        discordToken: t.Optional(t.String()),
        channelIds: t.Optional(t.Array(t.String())),
        allowedUserIds: t.Optional(t.Array(t.String())),
        mentionTriggerAllowedUserIds: t.Optional(t.Array(t.String())),
        triggerKeywords: t.Optional(t.Array(t.String())),
        llmProviderId: t.Optional(t.String()),
        llmModel: t.Optional(t.String()),
        temperature: t.Optional(t.Number()),
        visionProviderId: t.Optional(t.String()),
        visionModel: t.Optional(t.String()),
        enableVision: t.Optional(t.Boolean()),
        randomResponseRate: t.Optional(t.Integer()),
        maxHistoryMessages: t.Optional(t.Integer()),
        maxContextTokens: t.Optional(t.Integer()),
        ignoreOtherBots: t.Optional(t.Boolean()),
        replyToMentions: t.Optional(t.Boolean()),
        addTimestamps: t.Optional(t.Boolean()),
        addNothink: t.Optional(t.Boolean()),
        enableUserStatus: t.Optional(t.Boolean()),
        minResponseIntervalSeconds: t.Optional(t.Integer()),
        maxRecursionDepth: t.Optional(t.Integer()),
        status: t.Optional(t.Record(t.String(), t.Unknown())),
        comfyui: t.Optional(t.Record(t.String(), t.Unknown())),
        websearch: t.Optional(t.Record(t.String(), t.Unknown())),
        comfyuiWorkflowId: t.Optional(t.Union([t.String(), t.Null()])),
        toolOverrides: t.Optional(t.Record(t.String(), t.Record(t.String(), t.Unknown()))),
        mcpServerIds: t.Optional(t.Array(t.String())),
        logLevel: t.Optional(t.String()),
      }),
    },
  )

  .delete("/:id", async ({ params, set }) => {
    const [existing] = await db.select().from(bots).where(eq(bots.id, params.id));
    if (!existing) {
      set.status = 404;
      return { error: "Bot not found" };
    }
    await botManager.delete(params.id);
    await db.delete(bots).where(eq(bots.id, params.id));
    return { ok: true };
  })

  .post("/:id/start", async ({ params, set }) => {
    // persist enabled=true so the bot auto-starts on next process boot.
    await db
      .update(bots)
      .set({ enabled: true, updatedAt: new Date(nowMs()) })
      .where(eq(bots.id, params.id));
    const ok = await botManager.start(params.id);
    if (!ok) {
      set.status = 400;
      return { error: "Bot could not start (already running or misconfigured)" };
    }
    return { ok: true, status: botManager.getStatus(params.id)?.status };
  })
  .post("/:id/stop", async ({ params }) => {
    // persist enabled=false so the bot stays stopped on next boot.
    await db
      .update(bots)
      .set({ enabled: false, updatedAt: new Date(nowMs()) })
      .where(eq(bots.id, params.id));
    await botManager.stop(params.id);
    return { ok: true, status: botManager.getStatus(params.id)?.status };
  })
  .post("/:id/restart", async ({ params }) => {
    const ok = await botManager.restart(params.id);
    return { ok, status: botManager.getStatus(params.id)?.status };
  })

  .get("/:id/character", async ({ params, set }) => {
    const [char] = await db.select().from(characters).where(eq(characters.botId, params.id));
    if (!char) {
      set.status = 404;
      return { error: "Character not found" };
    }
    return {
      id: char.id,
      botId: char.botId,
      name: char.name,
      description: char.description,
      mesExample: char.mesExample,
      systemPrompt: char.systemPrompt,
      depthPrompt: char.depthPrompt,
      updatedAt: char.updatedAt.getTime(),
    };
  })
  .put(
    "/:id/character",
    async ({ params, body, set }) => {
      const [char] = await db.select().from(characters).where(eq(characters.botId, params.id));
      if (!char) {
        set.status = 404;
        return { error: "Character not found" };
      }
      await db
        .update(characters)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.mesExample !== undefined && { mesExample: body.mesExample }),
          ...(body.systemPrompt !== undefined && {
            // empty string = reset to default (store as null)
            systemPrompt: body.systemPrompt.trim() === "" ? null : body.systemPrompt,
          }),
          ...(body.depthPrompt !== undefined && { depthPrompt: body.depthPrompt }),
          updatedAt: new Date(nowMs()),
        })
        .where(eq(characters.id, char.id));

      // character edits always live-apply
      await botManager.refreshCharacter(params.id).catch(() => {});

      const [updated] = await db.select().from(characters).where(eq(characters.botId, params.id));
      return {
        id: updated!.id,
        botId: updated!.botId,
        name: updated!.name,
        description: updated!.description,
        mesExample: updated!.mesExample,
        systemPrompt: updated!.systemPrompt,
        depthPrompt: updated!.depthPrompt,
        updatedAt: updated!.updatedAt.getTime(),
      };
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        mesExample: t.Optional(t.String()),
        systemPrompt: t.Optional(t.String()),
        depthPrompt: t.Optional(
          t.Union([
            t.Null(),
            t.Object({ depth: t.Number(), prompt: t.String(), role: t.Optional(t.String()) }),
          ]),
        ),
      }),
    },
  )

  //  import a Character Card V2 (character.json). parses on the client, but
  // the server does a light sanity pass so a malformed card doesn't nuke data.
  .post(
    "/:id/character/import",
    async ({ params, body, set }) => {
      const [char] = await db.select().from(characters).where(eq(characters.botId, params.id));
      if (!char) {
        set.status = 404;
        return { error: "Character not found" };
      }
      const card = body.card;
      const data = (card as any)?.data ?? card;

      const patch: Partial<typeof characters.$inferInsert> = { updatedAt: new Date(nowMs()) };
      const mode = body.mode ?? "replace";

      const take = (field: string): unknown | undefined => data?.[field];
      const name = take("name");
      const description = take("description");
      const mesExample = take("mes_example") ?? take("mesExample");
      const depthPrompt = take("depth_prompt") ?? (data?.extensions?.depth_prompt);

      if (mode === "replace") {
        if (typeof name === "string" && name) patch.name = name;
        if (typeof description === "string") patch.description = description;
        if (typeof mesExample === "string") patch.mesExample = mesExample;
        if (depthPrompt && typeof depthPrompt === "object") {
          const dp = depthPrompt as { prompt?: string; depth?: number; role?: string };
          if (dp.prompt && typeof dp.depth === "number") {
            patch.depthPrompt = { prompt: dp.prompt, depth: dp.depth, role: dp.role };
          }
        }
      } else {
        // merge: only fill blanks
        if (!char.name && typeof name === "string") patch.name = name;
        if (!char.description && typeof description === "string") patch.description = description;
        if (!char.mesExample && typeof mesExample === "string") patch.mesExample = mesExample;
        if (!char.depthPrompt && depthPrompt && typeof depthPrompt === "object") {
          const dp = depthPrompt as { prompt?: string; depth?: number; role?: string };
          if (dp.prompt && typeof dp.depth === "number") {
            patch.depthPrompt = { prompt: dp.prompt, depth: dp.depth, role: dp.role };
          }
        }
      }

      await db.update(characters).set(patch).where(eq(characters.id, char.id));
      await botManager.refreshCharacter(params.id).catch(() => {});

      const [updated] = await db.select().from(characters).where(eq(characters.botId, params.id));
      return {
        ok: true,
        character: {
          id: updated!.id,
          botId: updated!.botId,
          name: updated!.name,
          description: updated!.description,
          mesExample: updated!.mesExample,
          systemPrompt: updated!.systemPrompt,
          depthPrompt: updated!.depthPrompt,
          updatedAt: updated!.updatedAt.getTime(),
        },
      };
    },
    {
      body: t.Object({
        mode: t.Optional(t.Union([t.Literal("replace"), t.Literal("merge")])),
        // we accept the whole card object; the handler does the digging
        card: t.Record(t.String(), t.Unknown()),
      }),
    },
  )

  // structured tool list for the bot-detail Tools tab. returns builtins
  // (with computed default + override state) + all MCP servers (with enabled
  // flag for this bot) + tools for each enabled server.
  .get("/:id/tools", async ({ params, set }) => {
    const [row] = await db.select().from(bots).where(eq(bots.id, params.id));
    if (!row) {
      set.status = 404;
      return { error: "Bot not found" };
    }
    const config = await resolveBotConfig(row);
    const overrides = config.toolOverrides;

    const builtin = BUILTIN_COMMANDS.map((c) => {
      const cat = c.kind === "async" ? "comfyui" : c.name === "webSearch" || c.name === "fetchWebpage" || c.name === "searchAndFetch" || c.name === "deepResearch" || c.name === "crawlSite" ? "websearch" : "builtin";
      const def = c.defaultEnabled(config);
      const ov = overrides[c.name];
      return {
        name: c.name,
        kind: c.kind,
        category: cat,
        args: c.args,
        description: c.description,
        defaultEnabled: def,
        effectiveEnabled: ov?.enabled !== undefined ? ov.enabled : def,
        override: ov,
      };
    });

    // all servers, with `enabled` for this bot + their tool list
    const allServers = await db.select().from(mcpServers).orderBy(mcpServers.name);
    const enabledIds = new Set(config.mcpServerIds);
    // query ALL tools for ALL servers so toolCount is accurate even for
    // not-yet-enabled ones (so the user sees "22 tools" before toggling on).
    const allServerIds = allServers.map((s) => s.id);
    const toolRows = allServerIds.length
      ? await db.select().from(mcpTools).where(inArray(mcpTools.serverId, allServerIds))
      : [];

    const mcpServersOut = allServers.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      enabled: enabledIds.has(s.id),
      lastFetchedAt: s.lastFetchedAt?.getTime() ?? null,
      lastFetchError: s.lastFetchError,
      toolCount: toolRows.filter((t) => t.serverId === s.id).length,
    }));

    // group MCP tools by serverId for ALL servers (enabled or not). the UI
    // toggles a server on locally before saving, so it needs the tool list
    // up front to render immediately without a reload.
    const mcpToolsByServer: Record<string, Array<{
      name: string;
      description: string;
      defaultEnabled: boolean;
      effectiveEnabled: boolean;
      override: ToolOverrideShape | undefined;
    }>> = {};
    for (const s of allServers) {
      const tools = toolRows
        .filter((t) => t.serverId === s.id)
        .map((t) => {
          // mirror mcpCommands.mcpCommandName sanitization exactly so
          // override keys match between this endpoint and the live registry.
          const sanitized = s.name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40) || "server";
          const cmdName = `mcp__${sanitized}__${t.name}`;
          const ov = overrides[cmdName];
          return {
            name: cmdName,
            description: t.description || "(no description)",
            defaultEnabled: true,
            effectiveEnabled: ov?.enabled !== undefined ? ov.enabled : true,
            override: ov,
          };
        });
      mcpToolsByServer[s.id] = tools;
    }

    return { builtin, mcpServers: mcpServersOut, mcpToolsByServer };
  });
