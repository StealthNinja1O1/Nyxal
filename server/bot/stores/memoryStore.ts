import { db } from "../../db";
import { memoryEntries } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { CharacterBookEntry } from "../lorebook/types";
import type { ChatMemoryBook } from "../types";
import { dbRowFromEntry } from "./characterStore";

function rowToEntry(row: typeof memoryEntries.$inferSelect): CharacterBookEntry {
  return {
    keys: row.keys,
    content: row.content,
    enabled: row.enabled,
    case_sensitive: row.caseSensitive,
    name: row.name,
    priority: row.priority,
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

export async function loadMemoryBook(botId: string): Promise<ChatMemoryBook> {
  const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.botId, botId));
  return { entries: rows.map(rowToEntry) };
}

/**
 * Create or update a memory entry by name. persists to db and returns the
 * updated book. 
 */
export async function upsertMemoryEntry(
  botId: string,
  book: ChatMemoryBook,
  entryName: string,
  keywords: string[],
  content: string,
): Promise<ChatMemoryBook> {
  const lower = entryName.toLowerCase();
  const existingIdx = book.entries.findIndex((e) => (e.name ?? "").toLowerCase() === lower);
  const now = new Date();

  if (existingIdx !== -1) {
    // update in place + persist that one row
    const existing = book.entries[existingIdx]!;
    const updated: CharacterBookEntry = {
      ...existing,
      content,
      keys: keywords.length > 0 ? keywords : existing.keys,
    };
    book.entries[existingIdx] = updated;
    // there is no stable id on the processing entry, so match by name + content-hash
    const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.botId, botId));
    const target = rows.find((r) => r.name.toLowerCase() === lower);
    if (target) {
      await db
        .update(memoryEntries)
        .set({ content, keys: updated.keys, updatedAt: now })
        .where(eq(memoryEntries.id, target.id));
    } else {
      await db.insert(memoryEntries).values(dbRowFromEntry(botId, updated, now));
    }
  } else {
    const newEntry: CharacterBookEntry = {
      keys: keywords.length > 0 ? keywords : [entryName.toLowerCase()],
      content,
      enabled: true,
      case_sensitive: false,
      name: entryName,
      priority: 10,
      order: 0,
      selective: false,
      secondary_keys: [],
      keysecondary: [],
      constant: false,
      selectiveLogic: 0,
      probability: 100,
      useProbability: false,
      scanDepth: null,
      extensions: {},
    };
    book.entries.push(newEntry);
    await db.insert(memoryEntries).values(dbRowFromEntry(botId, newEntry, now));
  }

  return { ...book, entries: [...book.entries] };
}
