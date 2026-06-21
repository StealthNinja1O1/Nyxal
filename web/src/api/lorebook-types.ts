// entry shape shared by static lorebook + memory tabs + the import parsers.
// mirrors the server EntryWire shape.

export interface LorebookEntryWire {
  id: string;
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  caseSensitive: boolean;
  selective: boolean;
  secondaryKeys: string[];
  selectiveLogic: number;
  constant: boolean;
  priority: number;
  order: number;
  scanDepth: number | null;
  probability: number;
  useProbability: boolean;
  extensions: Record<string, unknown>;
  updatedAt: number;
}

// shape sent to the create / import endpoints (no id, no server-set updatedAt).
export type NewEntry = Omit<LorebookEntryWire, "id" | "updatedAt">;

export type Book = "static" | "memory";

// a fresh entry for the create modal.
export function newEntryDefaults(name = "New entry"): NewEntry {
  return {
    name,
    keys: [name.toLowerCase()],
    content: "",
    enabled: true,
    caseSensitive: false,
    selective: false,
    secondaryKeys: [],
    selectiveLogic: 0,
    constant: false,
    priority: 10,
    order: 0,
    scanDepth: null,
    probability: 100,
    useProbability: false,
    extensions: {},
  };
}
