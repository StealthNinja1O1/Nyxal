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

export interface ComfyResolution {
  /** Lowercase identifier the LLM passes back, e.g. "square", "wide". */
  name: string;
  width: number;
  height: number;
}

export interface ComfyUiConfig {
  baseUrl: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
  randomizeSeeds: boolean;
  stripMetadata: boolean;
  includePromptInMessage: boolean;
  /** Ordered list of resolutions the LLM can pick from. Order = display + default-first. */
  resolutions: ComfyResolution[];
}

/** Minimal workflow shape the runtime needs (resolved from comfyui_workflows rows). */
export interface ComfyResolvedWorkflow {
  id: string;
  name: string;
  description: string;
  content: Record<string, unknown>;
}

/** A ComfyUI workflow node (minimal shape for the text editor). */
export interface ComfyWorkflowNode {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
  [key: string]: unknown;
}

/** The shared comfyui_workflows row. */
export interface ComfyWorkflow {
  id: string;
  name: string;
  description: string;
  content: Record<string, ComfyWorkflowNode>;
  createdAt: number;
  updatedAt: number;
}

/** Web search (Miyami/searxng). enabled is implicit: commands are on by default if baseUrl is set. */
export interface WebSearchConfig {
  baseUrl: string;
  language: string;
  maxResults: number;
  autoBypass: boolean;
}

/** Per-tool override stored on bots.tool_overrides. keyed by command name. */
export interface ToolOverride {
  enabled?: boolean;
  description?: string;
}
export type ToolOverrides = Record<string, ToolOverride>;

/** Stored MCP server row shape (mirrors server/db/schema.ts). */
export interface McpServer {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  lastFetchedAt: number | null;
  lastFetchError: string | null;
  toolCount?: number;
}

/** Stored MCP tool row shape. */
export interface McpTool {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  updatedAt: number;
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
