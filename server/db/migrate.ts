import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./index";

/**
 * Apply pending Drizzle migrations.
 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: "./server/db/migrations" });
  console.log("[db] migrations applied");
}

// Allow running directly: `bun run db:migrate`
if (import.meta.main) 
  runMigrations();

