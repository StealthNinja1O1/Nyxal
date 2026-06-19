// client-side parsers that turn a raw character.json (character card v2) or
// chatMemory.json into the flat entry shape the import endpoint expects.
// the parsing mirrors what the old bot's normalizeLorebook did

import type { NewEntry } from "../api/lorebook-types";
import type { DepthPrompt } from "@shared/types";

type AnyEntry = Record<string, any>;

function strArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** normalise one raw entry from any provider (sillytavern, chub, etc.) into our flat shape. */
function normaliseEntry(raw: AnyEntry): NewEntry {
  const ext = (raw.extensions && typeof raw.extensions === "object" ? raw.extensions : {}) as Record<string, any>;
  const name = (raw.name ?? raw.comment ?? "Unnamed entry") as string;

  // case_sensitive lives in both places depending on source
  const caseSensitive = bool(
    raw.caseSensitive ?? raw.case_sensitive ?? ext.caseSensitive ?? ext.case_sensitive,
    false,
  );
  const secondaryKeys = strArr(raw.secondary_keys ?? raw.keysecondary ?? raw.secondaryKeys);
  const selectiveLogic = num(ext.selectiveLogic ?? raw.selectiveLogic, 0);
  const enabled = raw.enabled !== undefined ? bool(raw.enabled, true) : !bool(raw.disable, false);
  const probability = num(ext.probability ?? raw.probability, 100);
  const useProbability = bool(ext.useProbability ?? raw.useProbability, false);
  const rawScan = raw.scanDepth ?? ext.scanDepth ?? ext.scan_depth;
  const scanDepth = typeof rawScan === "number" ? rawScan : null;

  return {
    name: String(name),
    keys: strArr(raw.keys ?? raw.key),
    content: String(raw.content ?? ""),
    enabled,
    caseSensitive,
    selective: bool(raw.selective ?? ext.selective, false),
    secondaryKeys,
    selectiveLogic,
    constant: bool(raw.constant ?? ext.constant, false),
    priority: num(raw.priority ?? ext.priority, 10),
    order: num(raw.order ?? ext.insertion_order ?? ext.order, 0),
    scanDepth,
    probability,
    useProbability,
    extensions: { _raw: raw },
  };
}

/**
 * Parse a chatMemory.json file. 
 */
export function parseChatMemoryJson(text: string): NewEntry[] {
  const json = JSON.parse(text) as { entries?: AnyEntry[] };
  const entries = Array.isArray(json.entries) ? json.entries : [];
  return entries.map(normaliseEntry);
}

/**
 * Parse a character card v2 file (character.json). pulls out the
 * character_book.entries (static lorebook)
 * Returns null if there is no character_book.
 */
export function parseCharacterBook(text: string): NewEntry[] | null {
  const json = JSON.parse(text) as any;
  const book = json?.data?.character_book ?? json?.character_book ?? null;
  if (!book || !Array.isArray(book.entries)) return null;
  return book.entries.map(normaliseEntry);
}

/**
 * Parse the character fields out of a character.json (v2 card). used by the
 * character import button on the Character tab.
 */
export function parseCharacterCard(text: string): {
  name?: string;
  description?: string;
  mesExample?: string;
  depthPrompt?: DepthPrompt;
} {
  const json = JSON.parse(text) as any;
  const data = json?.data ?? json;
  const dp = data?.extensions?.depth_prompt ?? data?.depth_prompt;
  return {
    name: typeof data?.name === "string" ? data.name : undefined,
    description: typeof data?.description === "string" ? data.description : undefined,
    mesExample: typeof data?.mes_example === "string" ? data.mes_example : undefined,
    depthPrompt:
      dp && typeof dp.prompt === "string" && typeof dp.depth === "number"
        ? { prompt: dp.prompt, depth: dp.depth, role: typeof dp.role === "string" ? dp.role : "user" }
        : undefined,
  };
}

/** validate that a string looks like parseable JSON without throwing. */
export function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
