/**
 * Drizzle schema — source of truth for the Nyxal database.
 *
 * Replaces the old project's:
 *   config.toml              ->  bots + llm_providers
 *   character.json           ->  characters + static_lorebook_entries
 *   chatMemory.json          ->  memory_entries
 *   workflow.json            ->  bots.comfyui (workflow blob lives inside)
 *   command_metadata.json    ->  command_metadata
 *
 * New tables: llm_providers, llm_call_log, logs, settings.
 */
import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import type {
  BotStatusConfig,
  ComfyUiConfig,
  WebSearchConfig,
  ToolOverrides,
} from "../../shared/types";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const llmProviders = sqliteTable("llm_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// comfyui_workflows - shared workflow templates (like llm_providers).
// the workflow JSON lives in `content` (map of node id -> node). text nodes
// containing <PROMPT> get replaced at gen time. bots reference one via FK.
export const comfyuiWorkflows = sqliteTable("comfyui_workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// bots, old config.toml
export const bots = sqliteTable("bots", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  discordToken: text("discord_token").notNull(),
  channelIds: text("channel_ids", { mode: "json" }).$type<string[]>().notNull(),
  allowedUserIds: text("allowed_user_ids", { mode: "json" }).$type<string[]>().notNull(),
  mentionTriggerAllowedUserIds: text("mention_trigger_allowed_user_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  triggerKeywords: text("trigger_keywords", { mode: "json" }).$type<string[]>().notNull(),

  // llm / vision (model ids are free strings; provider resolved via FK)
  llmProviderId: text("llm_provider_id").references(() => llmProviders.id),
  llmModel: text("llm_model").notNull(),
  temperature: real("temperature").notNull().default(0.7),
  visionProviderId: text("vision_provider_id").references(() => llmProviders.id),
  visionModel: text("vision_model"),
  enableVision: integer("enable_vision", { mode: "boolean" }).notNull().default(false),

  // comfyui workflow (shared resource, resolved via FK). nullable = none assigned.
  comfyuiWorkflowId: text("comfyui_workflow_id").references(() => comfyuiWorkflows.id),

  // behavior / context (all hot-reloadable)
  randomResponseRate: integer("random_response_rate").notNull().default(50),
  maxHistoryMessages: integer("max_history_messages").notNull().default(30),
  maxContextTokens: integer("max_context_tokens").notNull().default(20000),
  ignoreOtherBots: integer("ignore_other_bots", { mode: "boolean" }).notNull().default(true),
  replyToMentions: integer("reply_to_mentions", { mode: "boolean" }).notNull().default(true),
  addTimestamps: integer("add_timestamps", { mode: "boolean" }).notNull().default(true),
  addNothink: integer("add_nothink", { mode: "boolean" }).notNull().default(false),
  enableUserStatus: integer("enable_user_status", { mode: "boolean" }).notNull().default(false),
  minResponseIntervalSeconds: integer("min_response_interval_seconds").notNull().default(0),
  maxRecursionDepth: integer("max_recursion_depth").notNull().default(2),
  logLevel: text("log_level").notNull().default("INFO"),

  // nested config blobs (see config/defaults.ts)
  status: text("status", { mode: "json" }).$type<BotStatusConfig>().notNull(),
  comfyui: text("comfyui", { mode: "json" }).$type<ComfyUiConfig>().notNull(),
  websearch: text("websearch", { mode: "json" }).$type<WebSearchConfig>().notNull(),

  toolOverrides: text("tool_overrides", { mode: "json" }).$type<ToolOverrides>().notNull().default({}),
  mcpServerIds: text("mcp_server_ids", { mode: "json" }).$type<string[]>().notNull().default([]),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// MCP servers (HTTP transport only). tools are discovered via listTools
// and cached in mcp_tools
export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  headers: text("headers", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  lastFetchError: text("last_fetch_error"),
});

// MCP tool definitions discovered from a server. composite pk so refetch
// can just delete-all-then-insert without collisions.
export const mcpTools = sqliteTable(
  "mcp_tools",
  {
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    inputSchema: text("input_schema", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serverId, t.name] }),
  }),
);


// characters, only the fields the bot reads, not full V2 standard anymore
export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .unique()
    .references(() => bots.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  mesExample: text("mes_example").notNull().default(""),
  systemPrompt: text("system_prompt"),
  depthPrompt: text("depth_prompt", { mode: "json" }).$type<{
    depth: number;
    prompt: string;
    role?: string;
  } | null>(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// lorebook entry columns shared by static + dynamic books
const lorebookColumns = {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  keys: text("keys", { mode: "json" }).$type<string[]>().notNull(),
  content: text("content").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  caseSensitive: integer("case_sensitive", { mode: "boolean" }).notNull().default(false),
  selective: integer("selective", { mode: "boolean" }).notNull().default(false),
  secondaryKeys: text("secondary_keys", { mode: "json" }).$type<string[]>().notNull(),
  selectiveLogic: integer("selective_logic").notNull().default(0),
  constant: integer("constant", { mode: "boolean" }).notNull().default(false),
  priority: integer("priority").notNull().default(10),
  order: integer("order").notNull().default(0),
  scanDepth: integer("scan_depth"),
  probability: integer("probability").notNull().default(100),
  useProbability: integer("use_probability", { mode: "boolean" }).notNull().default(false),
  extensions: text("extensions", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

// Static lorebook
export const staticLorebookEntries = sqliteTable("static_lorebook_entries", lorebookColumns);

// Dynamic memory (bot-writable via editOrAddToLorebook)
export const memoryEntries = sqliteTable("memory_entries", lorebookColumns);

// command_metadata, bot command history reconstruction (TTL)
export const commandMetadata = sqliteTable("command_metadata", {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  channelId: text("channel_id").notNull(),
  commands: text("commands", { mode: "json" }).$type<unknown[]>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// llm_call_log, powers usage charts (tokens per hour/day/month)
export const llmCallLog = sqliteTable("llm_call_log", {
  id: text("id").primaryKey(),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id, { onDelete: "cascade" }),
  providerId: text("provider_id"),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  ms: integer("ms").notNull().default(0),
  success: integer("success", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// logs, persisted runtime logs (restored to WS clients on connect)
export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botId: text("bot_id"), // null = system/global
  level: text("level").notNull(), // DEBUG | INFO | WARN | ERROR
  scope: text("scope").notNull().default("system"),
  message: text("message").notNull(),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// tool_call_log, every bot function/tool invocation (instant, async, recursive commands)
export const toolCallLog = sqliteTable("tool_call_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botId: text("bot_id")
    .notNull()
    .references(() => bots.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // instant | async | recursive
  args: text("args", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  success: integer("success", { mode: "boolean" }).notNull().default(true),
  errorMessage: text("error_message"), // set when success = false
  ms: integer("ms").notNull().default(0),
  depth: integer("depth").notNull().default(0), // 0 = top-level, > 0 = nested recursion
  channelId: text("channel_id"),
  messageId: text("message_id"), // the discord message that triggered the call (if known)
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
