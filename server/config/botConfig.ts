// runtime config that each bot holds in memory after start.
// resolved from a DB bot row + provider rows at boot, then hot-reloaded
// in place by the BotManager / config store.

import type {
  BotStatusConfig,
  ComfyUiConfig,
  ToolcallMode,
  WebSearchConfig,
  SummaryConfig,
  ToolOverrides,
  ComfyResolvedWorkflow,
} from "../../shared/types";

export interface BotRuntimeConfig {
  botId: string;
  name: string;

  // discord connection
  botToken: string;
  channelIds: string[];
  allowedUserIds: string[];
  mentionTriggerAllowedUserIds: string[];
  triggerKeywords: string[];

  // llm (resolved from the linked provider row)
  llmProviderId: string | null;
  llmModel: string;
  llmApiKey: string;
  llmBaseUrl: string;
  temperature: number;

  // vision (resolved from the optional vision provider, falls back to llm)
  enableVision: boolean;
  visionModel: string;
  visionModelApiKey: string;
  visionModelBaseUrl: string;

  // behaviour / context (all hot-reloadable)
  randomResponseRate: number;
  maxHistoryMessages: number;
  maxContextTokens: number;
  ignoreOtherBots: boolean;
  replyToMentions: boolean;
  addTimestamps: boolean;
  addNothink: boolean;
  toolcallMode: ToolcallMode;
  enableUserStatus: boolean;
  minResponseIntervalSeconds: number;
  maxRecursionDepth: number;
  logLevel: string;

  status: BotStatusConfig;
  comfyui: ComfyUiConfig;
  websearch: WebSearchConfig;
  summary: SummaryConfig;

  toolOverrides: ToolOverrides;
  mcpServerIds: string[];

  comfyuiWorkflowIds: string[];
  comfyuiDefaultWorkflowId: string | null;
  comfyuiWorkflows: ComfyResolvedWorkflow[];
  comfyuiDefaultWorkflow: Record<string, unknown> | null;
}

export const DEFAULT_STATUS: BotStatusConfig = {
  generatingText: "images getting created",
  generatingType: "Watching",
  idleText: null,
  idleType: "Playing",
  disabledText: "on hiatus",
  disabledType: "Playing",
  disabledStatus: "idle",
};

export const DEFAULT_COMFYUI: ComfyUiConfig = {
  baseUrl: "",
  timeoutSeconds: 120,
  pollIntervalMs: 2000,
  randomizeSeeds: true,
  stripMetadata: true,
  includePromptInMessage: false,
  resolutions: [
    { name: "square", width: 1280, height: 1280 },
    { name: "portrait", width: 1008, height: 1280 },
    { name: "landscape", width: 1280, height: 1008 },
  ],
};

export const DEFAULT_WEBSEARCH: WebSearchConfig = {
  // The public miyami.tech instance was taken down :sob:
  baseUrl: "",
  language: "auto",
  maxResults: 5,
  autoBypass: true,
};

export const DEFAULT_SUMMARY: SummaryConfig = {
  enabled: true,
  summaryThresholdTokens: 2000,
  maxSummariesPerChat: 10,
  rollingWindowMessages: 30,
  summaryModel: "", // empty = reuse the bot's main llmModel
  minSummaryTokens: 100,
  countFallbackRatio: 0.5, // trigger a summary once the span reaches this fraction of maxHistoryMessages
};
