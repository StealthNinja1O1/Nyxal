// Just a way to give non vision models vision by transcribing images first then passing it to context.

import type { ImageAttachment } from "../types";
import type { BotRuntimeConfig } from "../../config/botConfig";
import type { Logger } from "../utils/logger";

interface VisionCompletionResponse {
  choices: Array<{ message: { content: string; role: string }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function describeImage(
  image: ImageAttachment,
  config: BotRuntimeConfig,
  log: Logger,
): Promise<string> {
  const apiKey = config.visionModelApiKey;
  const baseUrl = config.visionModelBaseUrl.replace(/\/+$/, "");

  const content = [
    {
      type: "text" as const,
      text: "Describe this image in detail. Include all visible elements, people, actions, expressions, text, colors, and the overall scene. Be thorough and specific.",
    },
    { type: "image_url" as const, image_url: { url: image.base64 } },
  ];

  const start = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.visionModel,
      messages: [{ role: "user", content }],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vision API request failed: ${res.status} ${res.statusText}\n${errText}`);
  }

  const data = (await res.json()) as VisionCompletionResponse;
  if (!data.choices || data.choices.length === 0) throw new Error("No response from vision API");

  const elapsed = (Date.now() - start) / 1000;
  const usage = data.usage;
  if (usage)
    log.info(
      `Vision model: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens (${elapsed.toFixed(1)}s)`,
    );
  else log.info(`Vision model response received in ${elapsed.toFixed(1)}s`);

  return data.choices[0]!.message.content.trim();
}

export async function describeImages(
  images: ImageAttachment[],
  config: BotRuntimeConfig,
  log: Logger,
): Promise<string[]> {
  return Promise.all(
    images.map(async (image, index) => {
      try {
        const description = await describeImage(image, config, log);
        log.debug(`Vision image ${index + 1}/${images.length} described (${description.length} chars)`);
        return description;
      } catch (error) {
        log.warn(`Failed to describe image ${index + 1}/${images.length}, skipping: ${error}`);
        return "[Image description unavailable]";
      }
    }),
  );
}

export function formatImageDescriptions(descriptions: string[]): string {
  if (descriptions.length === 0) return "";
  if (descriptions.length === 1) return `[Attached image: ${descriptions[0]}]`;
  return descriptions.map((desc, i) => `[Attached image ${i + 1}: ${desc}]`).join("\n");
}
