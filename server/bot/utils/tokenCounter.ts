import { encode } from "gpt-tokenizer";
import type { Logger } from "./logger";

export function makeTokenCounter(_log: Logger) {
  return {
    count: (text: string): number => {
      try {
        return encode(text).length;
      } catch (error) {
        _log.error("Error counting tokens:", error);
        return Math.ceil(text.length / 4);
      }
    },
    countMessages: (messages: Array<{ role: string; content: string }>): number => {
      return messages.reduce((total, msg) => {
        return total + _count(msg.role) + _count(msg.content) + 4;
      }, 0);
    },
  };
}

function _count(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
