// character + static lorebook loader. reads db rows and builds the runtime
// character + character_book that the prompt builder consumes.

import { db } from "../../db";
import { characters, staticLorebookEntries } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { CharacterBook, CharacterBookEntry } from "../lorebook/types";
import type { RuntimeCharacter } from "../types";
import type { LorebookEntry } from "../../../shared/types";

function rowToEntry(row: typeof staticLorebookEntries.$inferSelect): CharacterBookEntry {
  return {
    keys: row.keys,
    content: row.content,
    enabled: row.enabled,
    case_sensitive: row.caseSensitive,
    name: row.name,
    priority: row.priority,
    id: undefined,
    comment: row.name,
    selective: row.selective,
    secondary_keys: row.secondaryKeys,
    keysecondary: row.secondaryKeys,
    constant: row.constant,
    order: row.order,
    probability: row.probability,
    useProbability: row.useProbability,
    selectiveLogic: row.selectiveLogic,
    scanDepth: row.scanDepth,
    extensions: row.extensions,
  };
}

export async function loadCharacter(botId: string): Promise<RuntimeCharacter> {
  const [char] = await db.select().from(characters).where(eq(characters.botId, botId));
  const rows = await db
    .select()
    .from(staticLorebookEntries)
    .where(eq(staticLorebookEntries.botId, botId));

  const book: CharacterBook | null =
    rows.length > 0
      ? {
          name: "Lorebook",
          description: "",
          scan_depth: 12,
          token_budget: 1024,
          recursive_scanning: false,
          extensions: {},
          entries: rows.map(rowToEntry),
        }
      : null;

  return {
    name: char?.name ?? "Character",
    description: char?.description ?? "",
    mesExample: char?.mesExample ?? "",
    depthPrompt: char?.depthPrompt ?? null,
    character_book: book,
    systemPrompt: char?.systemPrompt ?? null,
  };
}

export async function replaceStaticLorebook(botId: string, entries: CharacterBookEntry[]): Promise<void> {
  await db.delete(staticLorebookEntries).where(eq(staticLorebookEntries.botId, botId));
  if (entries.length === 0) return;
  const now = new Date();
  await db.insert(staticLorebookEntries).values(
    entries.map((e) => dbRowFromEntry(botId, e, now)),
  );
}

export function dbRowFromEntry(
  botId: string,
  e: CharacterBookEntry,
  now: Date = new Date(),
): typeof staticLorebookEntries.$inferInsert {
  return {
    id: crypto.randomUUID(),
    botId,
    name: e.name ?? "",
    keys: e.keys ?? [],
    content: e.content ?? "",
    enabled: e.enabled ?? true,
    caseSensitive: e.case_sensitive ?? false,
    selective: e.selective ?? false,
    secondaryKeys: e.secondary_keys ?? e.keysecondary ?? [],
    selectiveLogic: e.selectiveLogic ?? 0,
    constant: e.constant ?? false,
    priority: e.priority ?? 10,
    order: e.order ?? 0,
    scanDepth: e.scanDepth ?? null,
    probability: e.probability ?? 100,
    useProbability: e.useProbability ?? false,
    extensions: e.extensions ?? {},
    updatedAt: now,
  };
}

export type { LorebookEntry };
