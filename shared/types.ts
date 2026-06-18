export interface DepthPrompt {
  depth: number;
  prompt: string;
  role?: string;
}

export interface LorebookEntry {
  id?: string;
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
}

export interface Character {
  id?: string;
  botId?: string;
  name: string;
  description: string;
  mesExample: string;
  depthPrompt: DepthPrompt | null;
}

export interface BotStatusConfig {
  generatingText: string;
  generatingType: string;
  idleText: string | null;
  idleType: string;
  disabledText: string;
  disabledType: string;
  disabledStatus: string;
}

export interface ComfyUiConfig {
  enabled: boolean;
  baseUrl: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
  randomizeSeeds: boolean;
  stripMetadata: boolean;
  includePromptInMessage: boolean;
  resolutions: {
    square: [number, number];
    portrait: [number, number];
    landscape: [number, number];
  };
  workflow: Record<string, unknown> | null;
}

/** Web search (Miyami/searxng) */
export interface WebSearchConfig {
  enabled: boolean;
  baseUrl: string;
  language: string;
  maxResults: number;
  autoBypass: boolean;
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export interface LogEntry {
  id?: number;
  botId: string | null;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: number;
}

/** Live event envelope pushed to dashboard clients over websocket. */
export type WsEvent =
  | { type: "hello"; ts: number }
  | { type: "bot.status"; botId: string; status: BotRuntimeStatus; detail?: string }
  | { type: "bot.chat"; botId: string; channel: string; author: string; preview: string }
  | { type: "memory.updated"; botId: string; entry: LorebookEntry }
  | { type: "llm.call"; botId: string; model: string; promptTokens: number; completionTokens: number; ms: number }
  | { type: "config.changed"; botId: string; restartRequired: boolean }
  | { type: "log"; log: LogEntry }
  | { type: "log.history"; logs: LogEntry[] };

/** Client ->  server WS control messages. */
export type WsClientMessage =
  | { type: "log.levels"; levels: LogLevel[] }
  | { type: "subscribe"; botId: string };

export type BotRuntimeStatus =
  | "stopped"
  | "starting"
  | "online"
  | "error"
  | "disabled";
