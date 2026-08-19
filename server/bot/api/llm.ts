import { db } from "../../db";
import { llmCallLog, llmRequestCapture } from "../../db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import type { CapturedLlmMessage } from "../../../shared/types";
import type { ImageAttachment } from "../types";
import type { Logger } from "../utils/logger";
import { broadcast } from "../ws/hub";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string; role: string }; finish_reason: string }>;
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

export async function generateResponse(
  creds: LlmCreds,
  log: Logger,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  noThink = false,
  images: ImageAttachment[] = [],
  source: LlmCallSource = "chat",
): Promise<string> {
  let finalMessages = messages;

  if (images.length > 0) {
    finalMessages = messages.map((msg) => {
      if (msg.role !== "user") return msg;
      const userMsgs = messages.filter((m) => m.role === "user");
      const isLastUserMessage = userMsgs.length > 0 && msg === userMsgs[userMsgs.length - 1];
      if (!isLastUserMessage) return msg;

      const content: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [];
      const textContent =
        typeof msg.content === "string" ? msg.content : msg.content.find((c) => c.type === "text")?.text || "";
      if (textContent) content.push({ type: "text", text: textContent });
      for (const image of images) {
        log.debug(`Vision image: ${image.contentType} (${(image.base64.length / 1024).toFixed(0)}KB)`);
        content.push({ type: "image_url", image_url: { url: image.base64 } });
      }
      return { role: msg.role, content };
    });
  }

  const body: Record<string, unknown> = { model, messages: finalMessages, temperature };
  if (noThink) body.thinking = { type: "disabled" };

  const start = Date.now();
  let success = true;
  let usage: ChatCompletionResponse["usage"] | undefined;

  try {
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

    usage = data.usage;
    const elapsed = (Date.now() - start) / 1000;
    if (usage) {
      const tps = elapsed > 0 ? (usage.completion_tokens / elapsed).toFixed(1) : "?";
      log.info(
        `LLM response: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens (${tps} tok/s, ${elapsed.toFixed(1)}s)`,
      );
    } else log.info(`LLM response received in ${elapsed.toFixed(1)}s (no usage data)`);

    return data.choices[0]!.message.content;
  } catch (err) {
    success = false;
    log.error("LLM API request failed:", err);
    throw err;
  } finally {
    // record to llm_call_log regardless of success
    void recordCall(creds, model, usage, Date.now() - start, success).catch(() => {});
    void captureRequest(creds, source, model, temperature, finalMessages, usage?.prompt_tokens ?? 0, success).catch(
      () => {},
    );
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
function sanitizeForCapture(messages: ChatMessage[]): CapturedLlmMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    return {
      role: m.role,
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
  messages: ChatMessage[],
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
