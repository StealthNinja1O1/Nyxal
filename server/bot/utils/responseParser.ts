import type { Logger } from "./logger";

export interface ParsedAIResponse {
  reply: string;
  commands: any[] | null;
  success: boolean;
  raw: string;
}

// strip a leading ``` / ```json and a trailing ```. leaves inner code blocks alone.
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  let out = trimmed;
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "");
  }
  if (out.endsWith("```")) {
    out = out.replace(/\s*```$/, "");
  }
  return out;
}

// find the outermost { ... } in the text and return it. useful when the LLM
// wraps the JSON in prose or trails extra commentary after it.
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  // walk forward matching brace depth, respecting strings so braces inside
  // strings don't confuse the counter.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAIResponse(log: Logger, rawResponse: string): ParsedAIResponse {
  let reply = rawResponse;
  let commands: any[] | null = null;
  let success = false;

  const cleaned = stripCodeFences(rawResponse);

  // strategy 1: strict parse of the whole thing.
  try {
    const json = JSON.parse(cleaned);
    success = true;
    if (json.reply !== undefined) reply = json.reply;
    if (json.commands && Array.isArray(json.commands)) commands = json.commands;
  } catch {
    // fall through
  }

  // strategy 2: extract the outermost { ... } (LLM may have added prose or
  // trailing commentary / extra closing braces).
  if (!success) {
    const extracted = extractJsonObject(cleaned);
    if (extracted) {
      try {
        const json = JSON.parse(extracted);
        success = true;
        if (json.reply !== undefined) reply = json.reply;
        if (json.commands && Array.isArray(json.commands)) commands = json.commands;
      } catch {
        // fall through to strategy 3
      }
    }
  }

  // strategy 3: last-ditch regex extraction of reply + commands separately.
  // handles cases where the JSON is malformed (unescaped newlines in reply,
  // trailing commas, etc) but the fields are still findable.
  if (!success) {
    const hasReply = cleaned.includes('"reply"') || cleaned.includes("'reply'");
    const hasCommands = cleaned.includes('"commands"') || cleaned.includes("'commands'");
    if (hasReply && hasCommands) {
      const replyMatch = cleaned.match(/["']reply["']\s*:\s*["']([\s\S]*?)["'][\s,]*\n*["']commands["']/i);
      const commandsMatch = cleaned.match(/["']commands["']\s*:\s*(\[([\s\S]*?)\])/i);
      if (replyMatch && replyMatch[1]) {
        reply = replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
        success = true;
      }
      if (commandsMatch) {
        // [1] is the captured array (without the "commands": prefix).
        // [0] would include the key which isn't valid JSON on its own.
        try {
          commands = JSON.parse(commandsMatch[1]!);
        } catch (e) {
          log.error(`Failed to parse commands array: ${commandsMatch[1]}`);
          commands = null;
        }
      }
    }
  }

  if (!success) {
    reply = rawResponse;
    log.error(`Failed to parse AI response as JSON. Raw: ${rawResponse}`);
  }

  return { reply, commands, success, raw: rawResponse };
}
