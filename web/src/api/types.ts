/**
 * Frontend API types. Mirrors server response shapes. these are NOT in
 * shared/types.ts because they're HTTP transport shapes, not domain types
 */
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string | null; // masked except for first few chars
  hasKey: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface TestResult {
  ok: boolean;
  ms?: number;
  modelCount?: number;
  sample?: string[];
  error?: string;
}

export interface ModelsResult {
  models: string[];
  error?: string;
}

export interface ApiError {
  error: string;
}
