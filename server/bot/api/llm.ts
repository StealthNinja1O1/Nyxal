import { db } from "../../db";
import { llmCallLog, llmRequestCapture } from "../../db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import type { CapturedLlmMessage } from "../../../shared/types";
import type { ImageAttachment } from "../types";
import type { Logger } from "../utils/logger";
import { broadcast } from "../ws/hub";

/** a message as sent on the wire. superset of the legacy {role, content}
 *  shape: assistant turns may carry tool_calls, and tool results are
 *  role:"tool" with a tool_call_id referencing the call they answer. */
export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
  tool_calls?: ToolCallWire[];
  tool_call_id?: string;
}

/** openai wire format for one tool call on an assistant message */
export interface ToolCallWire {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** openai wire format for the request `tools` field */
export interface NativeToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/** a tool call parsed off an assistant response. `arguments` stays raw (the
 *  exact string the model produced), `args` is the best-effort parse. */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
  args: Record<string, unknown>;
}

export interface ToolResponseResult {
  content: string;
  toolCalls: ParsedToolCall[];
  finishReason: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface LlmCreds {
  baseUrl: string;
  apiKey: string;
  botId: string;
  providerId: string | null;
}

export type LlmCallSource = "chat" | "followup" | "summary";

// how many submitted request bodies to keep per bot before deleting old stuff
const MAX_CAPTURED_REQUESTS = 25;

/** merge image attachments into the last user message (native vision). */
function injectImages(messages: WireMessage[], images: ImageAttachment[], log: Logger): WireMessage[] {
  if (images.length === 0) return messages;
  return messages.map((msg) => {
    if (msg.role !== "user") return msg;
    const userMsgs = messages.filter((m) => m.role === "user");
    const isLastUserMessage = userMsgs.length > 0 && msg === userMsgs[userMsgs.length - 1];
    if (!isLastUserMessage) return msg;

    const content: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [];
    const textContent =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content.find((c) => c.type === "text")?.text ?? "")
          : "";
    if (textContent) content.push({ type: "text", text: textContent });
    for (const image of images) {
      log.debug(`Vision image: ${image.contentType} (${(image.base64.length / 1024).toFixed(0)}KB)`);
      content.push({ type: "image_url", image_url: { url: image.base64 } });
    }
    return { role: msg.role, content };
  });
}

/** POST /chat/completions + basic response validation. throws on http/api errors. */
async function chatFetch(creds: LlmCreds, body: Record<string, unknown>): Promise<ChatCompletionResponse> {
  const res = await fetch(`${creds.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API request failed: ${res.status} ${res.statusText}\n${errText}`);
  }
  const data = (await res.json()) as ChatCompletionResponse;
  if (!data.choices || data.choices.length === 0) throw new Error("No response from LLM API");
  return data;
}

function logUsage(log: Logger, usage: ChatCompletionResponse["usage"], elapsedSec: number): void {
  if (usage) {
    const tps = elapsedSec > 0 ? (usage.completion_tokens / elapsedSec).toFixed(1) : "?";
    log.info(
      `LLM response: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens (${tps} tok/s, ${elapsedSec.toFixed(1)}s)`,
    );
  } else log.info(`LLM response received in ${elapsedSec.toFixed(1)}s (no usage data)`);
}

/** record to llm_call_log + llm_request_capture. fire-and-forget. */
async function finalizeCall(
  creds: LlmCreds,
  source: LlmCallSource,
  model: string,
  temperature: number,
  messages: WireMessage[],
  usage: ChatCompletionResponse["usage"],
  success: boolean,
  start: number,
): Promise<void> {
  void recordCall(creds, model, usage, Date.now() - start, success).catch(() => {});
  void captureRequest(creds, source, model, temperature, messages, usage?.prompt_tokens ?? 0, success).catch(
    () => {},
  );
}

/** parse a tool call arguments json string. null = not valid json / not an object. */
export function parseToolArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  return null;
}

export async function generateResponse(
  creds: LlmCreds,
  log: Logger,
  model: string,
  messages: WireMessage[],
  temperature: number,
  noThink = false,
  images: ImageAttachment[] = [],
  source: LlmCallSource = "chat",
): Promise<string> {
  const finalMessages = injectImages(messages, images, log);
  const body: Record<string, unknown> = { model, messages: finalMessages, temperature };
  if (noThink) body.thinking = { type: "disabled" };

  const start = Date.now();
  let success = true;
  let usage: ChatCompletionResponse["usage"] | undefined;

  try {
    const data = await chatFetch(creds, body);
    usage = data.usage;
    logUsage(log, usage, (Date.now() - start) / 1000);
    return data.choices[0]!.message.content ?? "";
  } catch (err) {
    success = false;
    log.error("LLM API request failed:", err);
    throw err;
  } finally {
    void finalizeCall(creds, source, model, temperature, finalMessages, usage, success, start);
  }
}

/** native tool calling variant: sends the `tools` field and parses
 *  `tool_calls` off the response. cost shape is identical to generateResponse:
 *  ONE api call here; whether more happen is decided by the caller's
 *  recursion loop, not by this function. */
export async function generateToolResponse(
  creds: LlmCreds,
  log: Logger,
  model: string,
  messages: WireMessage[],
  temperature: number,
  noThink: boolean,
  tools: NativeToolDef[],
  source: LlmCallSource = "chat",
  images: ImageAttachment[] = [],
): Promise<ToolResponseResult> {
  const finalMessages = injectImages(messages, images, log);
  const body: Record<string, unknown> = { model, messages: finalMessages, temperature };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (noThink) body.thinking = { type: "disabled" };

  const start = Date.now();
  let success = true;
  let usage: ChatCompletionResponse["usage"] | undefined;

  try {
    const data = await chatFetch(creds, body);
    usage = data.usage;
    logUsage(log, usage, (Date.now() - start) / 1000);
    const choice = data.choices[0]!;
    const rawCalls = choice.message.tool_calls ?? [];
    const toolCalls: ParsedToolCall[] = rawCalls.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
      args: parseToolArguments(c.function.arguments) ?? {},
    }));
    if (toolCalls.length > 0)
      log.info(`LLM requested ${toolCalls.length} tool call(s): ${toolCalls.map((t) => t.name).join(", ")}`);
    return { content: choice.message.content ?? "", toolCalls, finishReason: choice.finish_reason ?? "stop" };
  } catch (err) {
    success = false;
    log.error("LLM API request failed:", err);
    throw err;
  } finally {
    void finalizeCall(creds, source, model, temperature, finalMessages, usage, success, start);
  }
}

async function recordCall(
  creds: LlmCreds,
  model: string,
  usage: ChatCompletionResponse["usage"],
  ms: number,
  success: boolean,
): Promise<void> {
  const at = Date.now();
  await db.insert(llmCallLog).values({
    id: crypto.randomUUID(),
    botId: creds.botId,
    providerId: creds.providerId,
    model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    ms,
    success,
    createdAt: new Date(at),
  });

  broadcast({
    type: "llm.call",
    botId: creds.botId,
    model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    ms,
    success,
    at,
  });
}

/**
 * Strip anything huge from the submitted messages.
 * base64 image data URLs become a size note, "[image omitted: ~123KB]"
 */
function sanitizeForCapture(messages: WireMessage[]): CapturedLlmMessage[] {
  return messages.map((m) => {
    const base: CapturedLlmMessage = { role: m.role, content: m.content };
    if (m.tool_calls) base.tool_calls = m.tool_calls;
    if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
    if (typeof m.content === "string" || m.content === null) return base;
    return {
      ...base,
      content: m.content.map((part) => {
        if (part.type === "text") return { type: "text" as const, text: part.text ?? "" };
        const url = part.image_url?.url ?? "";
        const kb = Math.max(1, Math.round(url.length / 1.37 / 1024));
        return { type: "image_url" as const, note: `[image omitted: ~${kb}KB]` };
      }),
    };
  });
}

// Persist the submitted request body, trimmed to the newest n rows per bot
async function captureRequest(
  creds: LlmCreds,
  source: LlmCallSource,
  model: string,
  temperature: number,
  messages: WireMessage[],
  promptTokens: number,
  success: boolean,
): Promise<void> {
  await db.insert(llmRequestCapture).values({
    botId: creds.botId,
    source,
    model,
    temperature,
    messages: sanitizeForCapture(messages),
    promptTokens,
    success,
    createdAt: new Date(),
  });

  const rows = await db
    .select({ id: llmRequestCapture.id })
    .from(llmRequestCapture)
    .where(eq(llmRequestCapture.botId, creds.botId))
    .orderBy(desc(llmRequestCapture.id));
  const overflow = rows.slice(MAX_CAPTURED_REQUESTS).map((r) => r.id);
  if (overflow.length > 0) await db.delete(llmRequestCapture).where(inArray(llmRequestCapture.id, overflow));
}
