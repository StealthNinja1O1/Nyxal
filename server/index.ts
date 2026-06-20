import { Elysia } from "elysia";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "./db/migrate";
import { seedSettings } from "./db/seed";
import { webDistDir } from "./paths";
import { providersRoutes } from "./http/routes/providers";
import { botsRoutes } from "./http/routes/bots";
import { lorebookRoutes } from "./http/routes/lorebook";
import { workflowsRoutes } from "./http/routes/workflows";
import { statsRoutes } from "./http/routes/stats";
import { settingsRoutes } from "./http/routes/settings";
import { toolCallRoutes } from "./http/routes/toolCalls";
import { mcpRoutes } from "./http/routes/mcp";
import { refreshSettingsCache } from "./http/routes/settingsCache";
import { wsRoutes } from "./http/routes/ws";
import { botManager } from "./bot/BotManager";
import { startLogRetentionPruner } from "./bot/logRetention";
import { EMBEDDED_WEB } from "./embeddedManifest.gen";

const PORT = Number(process.env.NYXAL_PORT || 3000);

async function main() {
  runMigrations();
  await seedSettings();
  await refreshSettingsCache();

  const app = new Elysia()
    .use(providersRoutes)
    .use(botsRoutes)
    .use(lorebookRoutes)
    .use(workflowsRoutes)
    .use(statsRoutes)
    .use(settingsRoutes)
    .use(toolCallRoutes)
    .use(mcpRoutes)
    .use(wsRoutes)
    .get("/api/health", () => ({ ok: true, ts: Date.now() }));

  //  - compiled binary: assets are baked in (EMBEDDED_WEB) -> single-file serve.
  //  - bun run start from source: serve web/dist from disk if it exists.
  //  - dev: no static serving (vite serves the ui on :5173 + proxies /api + /ws).
  const embeddedMap = new Map(EMBEDDED_WEB.map((e) => [e.url, e.bunPath]));
  const embeddedIndex = embeddedMap.get("/");
  const serveFromDisk = embeddedMap.size === 0 && existsSync(webDistDir);
  const serveMode = embeddedMap.size > 0 ? "embedded" : serveFromDisk ? "disk" : null;

  if (serveMode) {
    const diskIndexHtml = join(webDistDir, "index.html");
    app.get("/*", ({ request }) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/ws" || pathname.startsWith("/ws/")) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }

      if (serveMode === "embedded") {
        const exact = embeddedMap.get(pathname);
        if (exact) return new Response(Bun.file(exact));
        return new Response(Bun.file(embeddedIndex!)); // spa fallback
      }

      // disk mode
      const safe = join(webDistDir, decodeURIComponent(pathname));
      let isFile = false;
      try {
        isFile = safe.startsWith(webDistDir) && statSync(safe).isFile();
      } catch {
        isFile = false;
      }
      if (isFile) return new Response(Bun.file(safe));
      return new Response(Bun.file(diskIndexHtml));
    });
    console.log(`[web] serving ui (${serveMode})`);
  }

  app.listen(PORT, async ({ port }) => {
    console.log(`Nyxal API + WS listening on http://localhost:${port}`);
    // prune old logs on boot + every hour based on settings.log_retention_days
    startLogRetentionPruner();
    // start all enabled bots after the http server is up
    await botManager.startAll().catch((err) => console.error("Bot startup error:", err));
  });
}

void main();
