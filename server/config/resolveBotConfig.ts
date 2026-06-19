// turn a DB bot row into the in-memory runtime config.

import { db } from "../db";
import { bots, llmProviders, characters, comfyuiWorkflows } from "../db/schema";
import { eq } from "drizzle-orm";
import type { BotRuntimeConfig } from "./botConfig";
import { DEFAULT_STATUS, DEFAULT_COMFYUI, DEFAULT_WEBSEARCH } from "./botConfig";
import type { BotStatusConfig, ComfyUiConfig, WebSearchConfig } from "../../shared/types";

async function resolveProvider(providerId: string | null) {
  if (!providerId) return null;
  const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, providerId));
  return row ?? null;
}

async function resolveWorkflow(workflowId: string | null) {
  if (!workflowId) return null;
  const [row] = await db.select().from(comfyuiWorkflows).where(eq(comfyuiWorkflows.id, workflowId));
  return row ?? null;
}

export async function resolveBotConfig(botRow: typeof bots.$inferSelect): Promise<BotRuntimeConfig> {
  const llmProvider = await resolveProvider(botRow.llmProviderId);
  const visionProvider = await resolveProvider(botRow.visionProviderId);
  const workflow = await resolveWorkflow(botRow.comfyuiWorkflowId);

  // vision creds fall back to the main llm provider
  const visionApiKey =
    visionProvider?.apiKey || llmProvider?.apiKey || "";
  const visionBaseUrl =
    visionProvider?.baseUrl || llmProvider?.baseUrl || "";

  return {
    botId: botRow.id,
    name: botRow.name,

    botToken: botRow.discordToken,
    channelIds: botRow.channelIds ?? [],
    allowedUserIds: botRow.allowedUserIds ?? [],
    mentionTriggerAllowedUserIds: botRow.mentionTriggerAllowedUserIds ?? [],
    triggerKeywords: botRow.triggerKeywords ?? [],

    llmProviderId: botRow.llmProviderId,
    llmModel: botRow.llmModel,
    llmApiKey: llmProvider?.apiKey ?? "",
    llmBaseUrl: llmProvider?.baseUrl ?? "",
    temperature: botRow.temperature,

    enableVision: botRow.enableVision,
    visionModel: botRow.visionModel ?? "",
    visionModelApiKey: visionApiKey,
    visionModelBaseUrl: visionBaseUrl,

    randomResponseRate: botRow.randomResponseRate,
    maxHistoryMessages: botRow.maxHistoryMessages,
    maxContextTokens: botRow.maxContextTokens,
    ignoreOtherBots: botRow.ignoreOtherBots,
    replyToMentions: botRow.replyToMentions,
    addTimestamps: botRow.addTimestamps,
    addNothink: botRow.addNothink,
    enableUserStatus: botRow.enableUserStatus,
    allowRenaming: botRow.allowRenaming,
    allowLorebookEditing: botRow.allowLorebookEditing,
    minResponseIntervalSeconds: botRow.minResponseIntervalSeconds,
    maxRecursionDepth: botRow.maxRecursionDepth,
    logLevel: botRow.logLevel,

    status: botRow.status ?? DEFAULT_STATUS,
    comfyui: (botRow.comfyui ?? DEFAULT_COMFYUI) as ComfyUiConfig,
    comfyuiWorkflowId: botRow.comfyuiWorkflowId,
    comfyuiWorkflow: workflow?.content ?? null,
    websearch: (botRow.websearch ?? DEFAULT_WEBSEARCH) as WebSearchConfig,
  };
}

// load the runtime config for a bot id, or null if the bot row is gone.
export async function loadBotConfig(botId: string): Promise<BotRuntimeConfig | null> {
  const [row] = await db.select().from(bots).where(eq(bots.id, botId));
  if (!row) return null;
  return resolveBotConfig(row);
}

export function newBotDefaults() {
  return {
    channelIds: [],
    allowedUserIds: [],
    mentionTriggerAllowedUserIds: [],
    triggerKeywords: [],
    temperature: 0.7,
    randomResponseRate: 50,
    maxHistoryMessages: 30,
    maxContextTokens: 20000,
    ignoreOtherBots: true,
    replyToMentions: true,
    addTimestamps: true,
    addNothink: false,
    enableUserStatus: false,
    allowRenaming: false,
    allowLorebookEditing: false,
    minResponseIntervalSeconds: 0,
    maxRecursionDepth: 2,
    logLevel: "INFO",
    status: DEFAULT_STATUS,
    comfyui: DEFAULT_COMFYUI,
    websearch: DEFAULT_WEBSEARCH,
  };
}

// make sure a bot has a character row
export async function ensureCharacter(botId: string): Promise<void> {
  const [existing] = await db.select().from(characters).where(eq(characters.botId, botId));
  if (existing) return;
  await db.insert(characters).values({
    id: crypto.randomUUID(),
    botId,
    name: "New Character",
    description: "",
    mesExample: "",
    depthPrompt: null,
    updatedAt: new Date(),
  });
}
