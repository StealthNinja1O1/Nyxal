import type { CharacterBook, CharacterBookEntry } from "./types";

enum LorebookEntrySecondaryKeyLogic {
  AND_ANY = 0,
  NOT_ALL = 1,
  NOT_ANY = 2,
  AND_ALL = 3,
}

function checkSingleKeyMatch(key: string, searchText: string, caseSensitive?: boolean): boolean {
  if (!key) return false;
  if (caseSensitive) return searchText.includes(key);
  return searchText.toLowerCase().includes(key.toLowerCase());
}

function checkKeysMatch(
  entry: {
    keys: string[];
    case_sensitive?: boolean;
    secondary_keys?: string[];
    keysecondary?: string[];
    selectiveLogic?: number;
  },
  searchText: string,
): boolean {
  if (!entry.keys || entry.keys.length === 0) return false;

  let mainKeyMatch = false;
  for (const key of entry.keys) {
    if (!key) continue;
    if (checkSingleKeyMatch(key, searchText, entry.case_sensitive)) {
      mainKeyMatch = true;
      break;
    }
  }
  if (!mainKeyMatch) return false;

  const secondaryKeys = entry.secondary_keys || entry.keysecondary;
  if (!secondaryKeys || secondaryKeys.length === 0) return mainKeyMatch;

  const secondaryMatches: boolean[] = [];
  for (const key of secondaryKeys) {
    if (!key) continue;
    secondaryMatches.push(checkSingleKeyMatch(key, searchText, entry.case_sensitive));
  }

  const selectiveLogic = entry.selectiveLogic ?? LorebookEntrySecondaryKeyLogic.AND_ANY;
  let secondaryKeyCheck = false;

  switch (selectiveLogic) {
    case LorebookEntrySecondaryKeyLogic.AND_ANY:
      secondaryKeyCheck = secondaryMatches.some((m) => m);
      break;
    case LorebookEntrySecondaryKeyLogic.NOT_ALL:
      secondaryKeyCheck = !secondaryMatches.every((m) => m);
      break;
    case LorebookEntrySecondaryKeyLogic.NOT_ANY:
      secondaryKeyCheck = !secondaryMatches.some((m) => m);
      break;
    case LorebookEntrySecondaryKeyLogic.AND_ALL:
      secondaryKeyCheck = secondaryMatches.every((m) => m);
      break;
    default:
      secondaryKeyCheck = secondaryMatches.some((m) => m);
  }

  return mainKeyMatch && secondaryKeyCheck;
}

function checkProbability(entry: CharacterBookEntry): boolean {
  if (!entry.useProbability) return true;
  const probability = entry.probability ?? 100;
  return Math.random() * 100 < probability;
}

function getEntryId(entry: CharacterBookEntry): string {
  const parts: string[] = [];
  if (entry.uid !== undefined && entry.uid !== null) parts.push(`uid:${entry.uid}`);
  if (entry.name) parts.push(`name:${entry.name}`);
  parts.push(`content:${entry.content.substring(0, 50)}`);
  return parts.join("|");
}

export function processLorebook(messages: { content: string }[], book: CharacterBook): {
  list: CharacterBookEntry[];
} {
  const list: CharacterBookEntry[] = [];
  const checkedEntries = new Set<string>();

  if (!book.entries || book.entries.length === 0) return { list };

  const bookScanDepth = book.scanDepth ?? book.scan_depth ?? 12;

  for (const entry of book.entries) {
    if (!entry.enabled || entry.disable) continue;

    const entryId = getEntryId(entry);
    if (checkedEntries.has(entryId)) continue;

    const scanDepth = entry.scanDepth !== null && entry.scanDepth !== undefined ? entry.scanDepth : bookScanDepth;
    const messagesToScan = messages.slice(-scanDepth);
    const searchText = messagesToScan.map((msg) => msg.content).join("\n");

    if (entry.constant || checkKeysMatch(entry, searchText)) {
      checkedEntries.add(entryId);
      if (!checkProbability(entry)) continue;
      list.push(entry);
    }
  }

  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { list };
}
