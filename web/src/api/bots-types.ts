// frontend api types for bots + characters. mirrors server response shapes.

import type {
  BotStatusConfig,
  ComfyUiConfig,
  WebSearchConfig,
  DepthPrompt,
  ToolOverrides,
} from "@shared/types";

export type BotStatus = "stopped" | "starting" | "online" | "error" | "disabled";

export interface Bot {
  id: string;
  name: string;
  enabled: boolean;
  status: BotStatus;
  detail?: string;
  discordId: string | null;
  discordTokenMasked: string;
  hasToken: boolean;
  channelIds: string[];
  allowedUserIds: string[];
  mentionTriggerAllowedUserIds: string[];
  triggerKeywords: string[];
  llmProviderId: string | null;
  llmModel: string;
  temperature: number;
  visionProviderId: string | null;
  visionModel: string | null;
  enableVision: boolean;
  randomResponseRate: number;
  maxHistoryMessages: number;
  maxContextTokens: number;
  ignoreOtherBots: boolean;
  replyToMentions: boolean;
  addTimestamps: boolean;
  addNothink: boolean;
  enableUserStatus: boolean;
  minResponseIntervalSeconds: number;
  maxRecursionDepth: number;
  logLevel: string;
  statusCfg: BotStatusConfig;
  comfyui: ComfyUiConfig;
  websearch: WebSearchConfig;
  comfyuiWorkflowIds: string[];
  comfyuiDefaultWorkflowId: string | null;
  toolOverrides: ToolOverrides;
  mcpServerIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BotCreateInput {
  name: string;
  discordToken: string;
  llmProviderId?: string;
  llmModel?: string;
  enabled?: boolean;
  characterName?: string;
}

export type BotPatch = Partial<{
  name: string;
  enabled: boolean;
  discordToken: string;
  channelIds: string[];
  allowedUserIds: string[];
  mentionTriggerAllowedUserIds: string[];
  triggerKeywords: string[];
  llmProviderId: string;
  llmModel: string;
  temperature: number;
  visionProviderId: string;
  visionModel: string;
  enableVision: boolean;
  randomResponseRate: number;
  maxHistoryMessages: number;
  maxContextTokens: number;
  ignoreOtherBots: boolean;
  replyToMentions: boolean;
  addTimestamps: boolean;
  addNothink: boolean;
  enableUserStatus: boolean;
  minResponseIntervalSeconds: number;
  maxRecursionDepth: number;
  logLevel: string;
  status: BotStatusConfig;
  comfyui: ComfyUiConfig;
  websearch: WebSearchConfig;
  comfyuiWorkflowIds: string[];
  comfyuiDefaultWorkflowId: string | null;
  toolOverrides: ToolOverrides;
  mcpServerIds: string[];
}>;

export interface PatchResult {
  ok: boolean;
  restartRequired: boolean;
  reasons: string[];
  applied: boolean;
}

export interface Character {
  id: string;
  botId: string;
  name: string;
  description: string;
  mesExample: string;
  systemPrompt: string | null;
  depthPrompt: DepthPrompt | null;
  updatedAt: number;
}

export type CharacterPatch = Partial<{
  name: string;
  description: string;
  mesExample: string;
  systemPrompt: string | null;
  depthPrompt: DepthPrompt | null;
}>;
