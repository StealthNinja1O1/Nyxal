import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./index";
import { migrationsDir, dbPath } from "../paths";
import { EMBEDDED_MIGRATIONS } from "../embeddedManifest.gen";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function resolveMigrationsDir(): string {
  if (EMBEDDED_MIGRATIONS.length === 0) return migrationsDir;
  const outDir = join(dirname(dbPath), ".nyxal-migrations");
  mkdirSync(outDir, { recursive: true });
  for (const { relPath, bunPath } of EMBEDDED_MIGRATIONS) {
    const dest = join(outDir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(bunPath));
  }
  return outDir;
}

/**
 * Apply pending Drizzle migrations.
 */
export function runMigrations(): void {
  const folder = resolveMigrationsDir();
  migrate(db, { migrationsFolder: folder });
  console.log(`[db] migrations applied (${folder})`);
}

// Allow running directly: `bun run db:migrate`
if (import.meta.main) 
  runMigrations();

