import { Elysia } from "elysia";
import { runMigrations } from "./db/migrate";
import { seedSettings } from "./db/seed";
import { providersRoutes } from "./http/routes/providers";
import { botsRoutes } from "./http/routes/bots";
import { lorebookRoutes } from "./http/routes/lorebook";
import { workflowsRoutes } from "./http/routes/workflows";
import { statsRoutes } from "./http/routes/stats";
import { settingsRoutes } from "./http/routes/settings";
import { toolCallRoutes } from "./http/routes/toolCalls";
import { refreshSettingsCache } from "./http/routes/settingsCache";
import { wsRoutes } from "./http/routes/ws";
import { botManager } from "./bot/BotManager";
import { startLogRetentionPruner } from "./bot/logRetention";

const PORT = Number(process.env.NYXAL_PORT || 3000);

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
  .use(wsRoutes)
  .get("/api/health", () => ({ ok: true, ts: Date.now() }))
  .listen(PORT, async ({ port }) => {
    console.log(`Nyxal API + WS listening on http://localhost:${port}`);
    // prune old logs on boot + every hour based on settings.log_retention_days
    startLogRetentionPruner();
    // start all enabled bots after the http server is up
    await botManager.startAll().catch((err) => console.error("Bot startup error:", err));
  });

export default app;
