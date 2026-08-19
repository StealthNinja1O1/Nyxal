// Post-turn summarization
//
// TRIGGER LOGIC:
// 1. If spanTokens < minSummaryTokens  -> SKIP (spam/images/attachments)
// 2. Else if spanTokens >= summaryThresholdTokens -> SUMMARIZE (token trigger)
// 3. Else if spanCount >= ceil(maxHistoryMessages * countFallbackRatio)
//      -> SUMMARIZE (count fallback: short msgs never reach the token bar)
// 4. Else -> SKIP (not enough yet)

import type { BotRuntimeConfig } from "../../config/botConfig";
import type { LlmCreds } from "../api/llm";
import { generateResponse } from "../api/llm";
import type { PromptMessage } from "../prompt";
import type { RuntimeCharacter } from "../types";
import type { Logger } from "../utils/logger";
import { buildSummaryPrompt } from "./summaryPrompt";
import { loadSummaries, loadSummaryState, addSummary, snowflakeLte, type SummaryRow } from "../stores/summaryStore";

export interface SummaryCheckResult {
  wrote: boolean;
  reason: string;
  stats: {
    spanCount: number;
    spanTokens: number;
    windowCount: number;
    existingSummaries: number;
  };
}

/**
 * Decide whether the pending span should be summarized
 */
export function shouldSummarize(
  span: PromptMessage[],
  spanTokens: number,
  config: BotRuntimeConfig,
  existingCount: number,
): { summarize: boolean; reason: string } {
  const s = config.summary;
  if (!s.enabled) return { summarize: false, reason: "summaries disabled" };

  const spanCount = span.length;
  if (spanCount === 0) return { summarize: false, reason: "nothing to summarize (empty span)" };

  // (1) absolute floor: too small to bother (spam / images / attachments)
  if (spanTokens < s.minSummaryTokens)
    return {
      summarize: false,
      reason: `below min floor (${spanTokens} < ${s.minSummaryTokens} tokens), likely spam/ignored content`,
    };

  // (2) primary trigger: token budget crossed
  if (spanTokens >= s.summaryThresholdTokens)
    return {
      summarize: true,
      reason: `token threshold reached (${spanTokens} >= ${s.summaryThresholdTokens})`,
    };

  // (3) fallback: short messages never reach the token bar
  const countFallback = Math.ceil(config.maxHistoryMessages * s.countFallbackRatio);
  if (countFallback > 0 && spanCount >= countFallback)
    return {
      summarize: true,
      reason: `count fallback triggered (${spanCount} msgs >= ${countFallback}, only ${spanTokens}/${s.summaryThresholdTokens} tokens)`,
    };

  return {
    summarize: false,
    reason: `not enough yet (${spanTokens}/${s.summaryThresholdTokens} tokens, ${spanCount}/${countFallback} msgs)`,
  };
}

/**
 * Full post-turn summarization step. Splits the fetched window into
 * [span (to summarize)] + [rolling window (kept verbatim)]
 * based on the watermark + rollingWindowMessages
 */
export async function maybeSummarize(args: {
  config: BotRuntimeConfig;
  creds: LlmCreds;
  character: RuntimeCharacter;
  log: Logger;
  tokens: { count: (t: string) => number };
  botId: string;
  channelId: string;
  messages: PromptMessage[];
  userName: string;
}): Promise<SummaryCheckResult> {
  const { config, creds, character, log, tokens, botId, channelId, messages, userName } = args;
  const s = config.summary;

  const state = await loadSummaryState(botId, channelId);
  const watermark = state?.lastSummarizedMessageId ?? null;
  const existing = await loadSummaries(botId, channelId);

  const rolling = Math.max(0, s.rollingWindowMessages);
  const rollingTail = messages.slice(Math.max(0, messages.length - rolling));
  const rollingIds = new Set(rollingTail.map((m) => m.id).filter(Boolean));

  const span: PromptMessage[] = messages.filter((m) => {
    if (m.id && rollingIds.has(m.id)) return false;
    if (watermark && m.id && snowflakeLte(m.id, watermark)) return false;
    return true;
  });

  const spanTokens = span.reduce((sum, m) => sum + tokens.count(m.content) + 4, 0);

  const decision = shouldSummarize(span, spanTokens, config, existing.length);

  const stats: SummaryCheckResult["stats"] = {
    spanCount: span.length,
    spanTokens,
    windowCount: messages.length,
    existingSummaries: existing.length,
  };

  // Always log the numbers so the user can fine-tune thresholds from the logs.
  log.info(
    `[summary] ${channelId}: span=${span.length} msgs/${spanTokens}tok | window=${messages.length} | existing=${existing.length} | decision: ${decision.reason}`,
  );

  if (!decision.summarize) return { wrote: false, reason: decision.reason, stats };

  const charName = character.name || "Character";
  const priorSummaries = existing.map((r) => r.content);
  const summaryMessages = buildSummaryPrompt(character, userName, span, priorSummaries, charName);
  const model = s.summaryModel.trim() || config.llmModel;

  try {
    const summaryText = await generateResponse(creds, log, model, summaryMessages, 0.3, true, [], "summary");
    const trimmed = summaryText.trim();
    if (!trimmed) {
      log.warn(`[summary] ${channelId}: model returned empty summary, skipping persist`);
      return { wrote: false, reason: "model returned empty summary", stats };
    }

    const startId = span[0]?.id ?? null;
    const endId = span[span.length - 1]?.id ?? null;
    const tokenEstimate = tokens.count(trimmed);

    await addSummary(botId, channelId, trimmed, startId, endId, tokenEstimate, s.maxSummariesPerChat);

    log.info(
      `[summary] ${channelId}: wrote summary #${existing.length} (${tokenEstimate} tok, covered ${span.length} msgs/${spanTokens} tok) using ${model}`,
    );
    return {
      wrote: true,
      reason: decision.reason,
      stats,
    };
  } catch (err) {
    log.error(`[summary] ${channelId}: summarization failed:`, err);
    return { wrote: false, reason: `error: ${err instanceof Error ? err.message : String(err)}`, stats };
  }
}

export async function loadSummaryContents(botId: string, channelId: string): Promise<SummaryRow[]> {
  return loadSummaries(botId, channelId);
}
