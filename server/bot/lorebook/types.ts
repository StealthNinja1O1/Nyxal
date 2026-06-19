// lorebook processing types. server-internal, kept separate from shared/types.ts

export interface CharacterBookEntry {
  uid?: number;
  keys: string[];
  content: string;
  extensions?: Record<string, any>;
  enabled: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  keysecondary?: string[];
  constant?: boolean;
  position?: number | string;
  order?: number;
  disable?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: boolean;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  selectiveLogic?: number;
  scanDepth?: number | null;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  scanDepth?: number;
  token_budget?: number;
  tokenBudget?: number;
  recursive_scanning?: boolean;
  recursiveScanning?: boolean;
  extensions?: Record<string, any>;
  entries: CharacterBookEntry[] | null;
}

export interface CharacterBookData {
  name?: string;
  description?: string | null;
  scan_depth?: number | null;
  token_budget?: number | null;
  recursive_scanning?: boolean | null;
  extensions?: Record<string, any>;
  entries: CharacterBookEntry[];
}

export interface DepthPrompt {
  depth: number;
  prompt: string;
  role?: string;
}
