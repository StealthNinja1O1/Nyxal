import type { CharacterBookData, CharacterBookEntry } from "./types";
import { randomUUID } from "crypto";

const LOREBOOK_ENTRY_DEFAULTS = {
  name: "",
  comment: "",
  content: "",
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  priority: 10,
  order: 100,
  insertionOrder: 100,
  position: 1,
  enabled: true,
  disable: false,
  ignoreBudget: false,
  excludeRecursion: false,
  preventRecursion: false,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  delayUntilRecursion: false,
  probability: 100,
  useProbability: true,
  depth: 4,
  outletName: "",
  group: "",
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: "",
  role: null,
  sticky: 0,
  cooldown: 0,
  delay: 0,
  triggers: [],
  displayIndex: 0,
  characterFilter: { isExclude: false, names: [], tags: [] },
};

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function getPropertyValue(entry: any, propName: string, defaultValue: any): any {
  if (entry[propName] !== undefined && entry[propName] !== null) return entry[propName];
  if (entry.extensions && typeof entry.extensions === "object") {
    if (entry.extensions[propName] !== undefined && entry.extensions[propName] !== null) return entry.extensions[propName];
    const snake = camelToSnake(propName);
    if (entry.extensions[snake] !== undefined && entry.extensions[snake] !== null) return entry.extensions[snake];
  }
  return defaultValue;
}

function getExcludeRecursionValue(entry: any, defaultValue: boolean): boolean {
  if (entry.excludeRecursion !== undefined && entry.excludeRecursion !== null) return entry.excludeRecursion;
  if (entry.extensions && typeof entry.extensions === "object") {
    // chub workaround: snake_case first
    if (entry.extensions.exclude_recursion !== undefined && entry.extensions.exclude_recursion !== null)
      return entry.extensions.exclude_recursion;
    if (entry.extensions.excludeRecursion !== undefined && entry.extensions.excludeRecursion !== null)
      return entry.extensions.excludeRecursion;
  }
  return defaultValue;
}

function normalizePosition(entry: any): number {
  const position = entry.position;
  const extensions = entry.extensions;
  if (extensions && typeof extensions === "object" && typeof extensions.position === "number") return extensions.position;
  if (position === "after_char") return 1;
  if (position === "before_char") return 0;
  if (typeof position === "number") return position;
  return LOREBOOK_ENTRY_DEFAULTS.position;
}

function normalizeCaseSensitive(entry: any): boolean | undefined {
  if (entry.extensions && typeof entry.extensions === "object") {
    if (entry.extensions.caseSensitive !== undefined && entry.extensions.caseSensitive !== null) return entry.extensions.caseSensitive;
    if (entry.extensions.case_sensitive !== undefined && entry.extensions.case_sensitive !== null) return entry.extensions.case_sensitive;
  }
  if (entry.caseSensitive !== undefined && entry.caseSensitive !== null) return entry.caseSensitive;
  if (entry.case_sensitive !== undefined && entry.case_sensitive !== null) return entry.case_sensitive;
  return undefined;
}

function normalizeOrder(entry: any): { order: number; insertionOrder: number } {
  const order = entry.order;
  const insertionOrder = entry.insertion_order;
  if (order !== undefined && order !== null) return { order, insertionOrder: order };
  if (insertionOrder !== undefined && insertionOrder !== null && insertionOrder !== 10)
    return { order: insertionOrder, insertionOrder };
  return { order: 100, insertionOrder: 100 };
}

function normalizeNameAndComment(entry: any): { name: string; comment: string } {
  let name = entry.name;
  let comment = entry.comment;
  if ((!name || name === "") && comment) name = comment;
  if ((!comment || comment === "") && name) comment = name;
  return {
    name: name || LOREBOOK_ENTRY_DEFAULTS.name,
    comment: comment || LOREBOOK_ENTRY_DEFAULTS.comment,
  };
}

export function normalizeLorebookData(lorebookData: any): CharacterBookData {
  if (!lorebookData) throw new Error("Lorebook data is required");
  const normalizedEntries = (lorebookData.entries || []).map((entry: any) => normalizeLorebookEntry(entry));
  return {
    name: lorebookData.name,
    description: lorebookData.description,
    scan_depth: lorebookData.scan_depth,
    token_budget: lorebookData.token_budget,
    recursive_scanning: lorebookData.recursive_scanning,
    extensions: lorebookData.extensions || {},
    entries: normalizedEntries,
  };
}

export function normalizeLorebookEntry(entry: any): CharacterBookEntry {
  if (!entry) throw new Error("Lorebook entry is required");

  const { name, comment } = normalizeNameAndComment(entry);
  const { order, insertionOrder } = normalizeOrder(entry);
  const position = normalizePosition(entry);
  const caseSensitive = normalizeCaseSensitive(entry);
  const keys = entry.keys || entry.key || LOREBOOK_ENTRY_DEFAULTS.name;
  const secondaryKeys = entry.secondary_keys || entry.keysecondary || [];
  const enabled = entry.enabled !== undefined ? entry.enabled : !entry.disable;

  const normalizedEntry: any = {
    keys: Array.isArray(keys) ? keys : [keys],
    content: entry.content || LOREBOOK_ENTRY_DEFAULTS.content,
    enabled,
    insertion_order: insertionOrder,
    caseSensitive,
    name,
    priority: getPropertyValue(entry, "priority", LOREBOOK_ENTRY_DEFAULTS.priority),
    id: entry.id,
    comment,
    selective: getPropertyValue(entry, "selective", LOREBOOK_ENTRY_DEFAULTS.selective),
    secondary_keys: secondaryKeys,
    constant: getPropertyValue(entry, "constant", LOREBOOK_ENTRY_DEFAULTS.constant),
    position,
    uid: entry.uid !== undefined ? entry.uid : entry.id !== undefined ? entry.id : randomUUID(),
    vectorized: getPropertyValue(entry, "vectorized", LOREBOOK_ENTRY_DEFAULTS.vectorized),
    selectiveLogic: getPropertyValue(entry, "selectiveLogic", LOREBOOK_ENTRY_DEFAULTS.selectiveLogic),
    addMemo: getPropertyValue(entry, "addMemo", LOREBOOK_ENTRY_DEFAULTS.addMemo),
    order,
    disable: !enabled,
    ignoreBudget: getPropertyValue(entry, "ignoreBudget", LOREBOOK_ENTRY_DEFAULTS.ignoreBudget),
    excludeRecursion: getExcludeRecursionValue(entry, LOREBOOK_ENTRY_DEFAULTS.excludeRecursion),
    preventRecursion: getPropertyValue(entry, "preventRecursion", LOREBOOK_ENTRY_DEFAULTS.preventRecursion),
    matchPersonaDescription: getPropertyValue(entry, "matchPersonaDescription", LOREBOOK_ENTRY_DEFAULTS.matchPersonaDescription),
    matchCharacterDescription: getPropertyValue(entry, "matchCharacterDescription", LOREBOOK_ENTRY_DEFAULTS.matchCharacterDescription),
    matchCharacterPersonality: getPropertyValue(entry, "matchCharacterPersonality", LOREBOOK_ENTRY_DEFAULTS.matchCharacterPersonality),
    matchCharacterDepthPrompt: getPropertyValue(entry, "matchCharacterDepthPrompt", LOREBOOK_ENTRY_DEFAULTS.matchCharacterDepthPrompt),
    matchScenario: getPropertyValue(entry, "matchScenario", LOREBOOK_ENTRY_DEFAULTS.matchScenario),
    matchCreatorNotes: getPropertyValue(entry, "matchCreatorNotes", LOREBOOK_ENTRY_DEFAULTS.matchCreatorNotes),
    delayUntilRecursion: getPropertyValue(entry, "delayUntilRecursion", LOREBOOK_ENTRY_DEFAULTS.delayUntilRecursion),
    probability: getPropertyValue(entry, "probability", LOREBOOK_ENTRY_DEFAULTS.probability),
    useProbability: getPropertyValue(entry, "useProbability", LOREBOOK_ENTRY_DEFAULTS.useProbability),
    depth: getPropertyValue(entry, "depth", LOREBOOK_ENTRY_DEFAULTS.depth),
    outletName: getPropertyValue(entry, "outletName", LOREBOOK_ENTRY_DEFAULTS.outletName),
    group: getPropertyValue(entry, "group", LOREBOOK_ENTRY_DEFAULTS.group),
    groupOverride: getPropertyValue(entry, "groupOverride", LOREBOOK_ENTRY_DEFAULTS.groupOverride),
    groupWeight: getPropertyValue(entry, "groupWeight", LOREBOOK_ENTRY_DEFAULTS.groupWeight),
    scanDepth: getPropertyValue(entry, "scanDepth", LOREBOOK_ENTRY_DEFAULTS.scanDepth),
    matchWholeWords: getPropertyValue(entry, "matchWholeWords", LOREBOOK_ENTRY_DEFAULTS.matchWholeWords),
    useGroupScoring: getPropertyValue(entry, "useGroupScoring", LOREBOOK_ENTRY_DEFAULTS.useGroupScoring),
    automationId: getPropertyValue(entry, "automationId", LOREBOOK_ENTRY_DEFAULTS.automationId),
    role: getPropertyValue(entry, "role", LOREBOOK_ENTRY_DEFAULTS.role),
    sticky: getPropertyValue(entry, "sticky", LOREBOOK_ENTRY_DEFAULTS.sticky),
    cooldown: getPropertyValue(entry, "cooldown", LOREBOOK_ENTRY_DEFAULTS.cooldown),
    delay: getPropertyValue(entry, "delay", LOREBOOK_ENTRY_DEFAULTS.delay),
    triggers: getPropertyValue(entry, "triggers", LOREBOOK_ENTRY_DEFAULTS.triggers),
    displayIndex: getPropertyValue(entry, "displayIndex", LOREBOOK_ENTRY_DEFAULTS.displayIndex),
    characterFilter: getPropertyValue(entry, "characterFilter", LOREBOOK_ENTRY_DEFAULTS.characterFilter),
    extensions: {},
  };

  return normalizedEntry as CharacterBookEntry;
}

export async function parseLorebook(json: any): Promise<CharacterBookData> {
  let lorebook: CharacterBookData;
  if (json.character_book) lorebook = json.character_book;
  else if (json.entries) lorebook = json as CharacterBookData;
  else throw new Error("Invalid lorebook format. Expected character_book object or entries array.");
  return normalizeObjectText(lorebook);
}

export function normalizeObjectText<T>(obj: T): T {
  if (typeof obj === "string") return normalizeFancyCharacters(obj) as T;
  if (Array.isArray(obj)) return obj.map((item) => normalizeObjectText(item)) as T;
  if (obj && typeof obj === "object") {
    const normalized: any = {};
    for (const [key, value] of Object.entries(obj)) normalized[key] = normalizeObjectText(value);
    return normalized as T;
  }
  return obj;
}

export function normalizeFancyCharacters(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2022\u2023\u2043]/g, "*")
    .replace(/\u00A9/g, "(c)")
    .replace(/\u00AE/g, "(r)")
    .replace(/\u2122/g, "(tm)")
    .replace(/\u02BC/g, "'")
    .replace(/\u02BB/g, "'")
    .replace(/\u2019/g, "'");
}
