import { Elysia } from "elysia";
import { runMigrations } from "./db/migrate";
import { seedSettings } from "./db/seed";
import { providersRoutes } from "./http/routes/providers";

const PORT = Number(process.env.NYXAL_PORT || 3000);

runMigrations();
await seedSettings();

const app = new Elysia()
  .use(providersRoutes)
  .get("/api/health", () => ({ ok: true, ts: Date.now() }))
  .ws("/ws", {
    open(ws) {
      ws.send({ type: "hello", ts: Date.now() });
    },
    message(ws, message) {
      ws.send({ type: "hello", ts: Date.now(), echo: message });
    },
  })
  .listen(PORT, ({ port }) => {
    console.log(`Nyxal API + WS listening on http://localhost:${port}`);
  });

export default app;
