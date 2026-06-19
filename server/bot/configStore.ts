// hot-reload classifier + live-apply helpers.
//
// the flow on a config write is always:
//   persist via drizzle -> mutate the running bot's in-memory config ->
//   emit a ws event. but some fields can't be applied live, they
//   need the discord client to reconnect. this file decides which.
//
// live (no restart): all behaviour fields, temperature, log_level, allow_*,
//   timestamps/nothink, vision toggle, comfyui/websearch, provider/model/api_key/
//   base_url swaps, character + memory + lorebook edits.
// needs reconnect: discord_token, intent changes (the Presence intent that
//   enable_user_status flips).

import type { BotRuntimeConfig } from "../config/botConfig";
import type { DiscordBot } from "./DiscordBot";
import type { Logger } from "./utils/logger";

export interface NeedsRestartResult {
  restartRequired: boolean;
  reasons: string[];
}

export function needsRestart(prev: BotRuntimeConfig, next: BotRuntimeConfig): NeedsRestartResult {
  const reasons: string[] = [];

  if (prev.botToken !== next.botToken) reasons.push("Discord token changed");
  if (prev.enableUserStatus !== next.enableUserStatus)
    reasons.push(
      `Presence intent changed (${prev.enableUserStatus ? "on" : "off"} -> ${next.enableUserStatus ? "on" : "off"})`,
    );

  return { restartRequired: reasons.length > 0, reasons };
}

/**
 * Apply a new resolved config to a running bot. live fields are swapped in place;
 * reconnect-only fields are left as-is and flagged via the return value so the
 * caller can show a "Restart required" badge.
 *
 * Also refreshes the bot's character from the db so character edits land live.
 */
export async function applyConfigUpdate(
  bot: DiscordBot,
  nextConfig: BotRuntimeConfig,
  log: Logger,
): Promise<NeedsRestartResult> {
  const prevConfig = bot.getConfig();
  const result = needsRestart(prevConfig, nextConfig);
  bot.applyConfigUpdate(nextConfig);
  log.info(
    result.restartRequired
      ? `Config updated, restart required: ${result.reasons.join("; ")}`
      : "Config hot-reloaded (no restart needed)",
  );
  return result;
}
