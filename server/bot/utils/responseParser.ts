import type { Logger } from "./logger";

export interface ParsedAIResponse {
  reply: string;
  commands: any[] | null;
  success: boolean;
  raw: string;
}

export function parseAIResponse(log: Logger, rawResponse: string): ParsedAIResponse {
  let reply = rawResponse;
  let commands: any[] | null = null;
  let success = false;

  // strip a leading ``` / ```json and a trailing ```. later code blocks are left alone.
  const startsWithCodeBlock = rawResponse.trim().startsWith("```");
  const endsWithCodeBlock = rawResponse.trim().endsWith("```");
  let cleaned = rawResponse.trim();
  if (startsWithCodeBlock) cleaned = cleaned.replace(/^```(json)?/, "");
  if (endsWithCodeBlock)
    cleaned = cleaned.split("").reverse().join("").replace(/^```/, "").split("").reverse().join("");

  try {
    const json = JSON.parse(cleaned);
    success = true;
    if (json.reply !== undefined) reply = json.reply;
    if (json.commands && Array.isArray(json.commands)) commands = json.commands;
  } catch {
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
        try {
          commands = JSON.parse(commandsMatch[0]);
        } catch (e) {
          log.error(`Failed to parse commands array: ${commandsMatch[0]}`);
          commands = null;
        }
      }
    }
    if (!success) {
      reply = rawResponse;
      log.error(`Failed to parse AI response as JSON. Raw: ${rawResponse}`);
    }
  }

  return { reply, commands, success, raw: rawResponse };
}
