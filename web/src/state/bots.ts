import { signal, batch } from "@preact/signals";
import { botsApi } from "../api/bots";
import type { Bot, BotCreateInput, BotPatch } from "../api/bots-types";
import { toast } from "./toast";

export const bots = signal<Bot[]>([]);
export const botsLoading = signal(false);

export async function loadBots(): Promise<void> {
  botsLoading.value = true;
  try {
    bots.value = await botsApi.list();
  } catch (err) {
    toast.show(`Failed to load bots: ${msg(err)}`, "error");
  } finally {
    botsLoading.value = false;
  }
}

function setBot(updated: Bot): void {
  bots.value = bots.value.map((b) => (b.id === updated.id ? updated : b));
}

export async function createBot(input: BotCreateInput): Promise<Bot | null> {
  try {
    const created = await botsApi.create(input);
    bots.value = [...bots.value, created];
    toast.show(`Bot "${created.name}" created`, "success");
    return created;
  } catch (err) {
    toast.show(`Create failed: ${msg(err)}`, "error");
    return null;
  }
}

/**
 * Update a bot field. returns whether a reconnect is required so the caller
 * can show a Restart badge. optimistic for the running-status merge.
 */
export async function updateBot(
  id: string,
  patch: BotPatch,
  options: { silent?: boolean } = {},
): Promise<{ restartRequired: boolean; reasons: string[] } | null> {
  try {
    const result = await botsApi.update(id, patch);
    // refresh the single bot row so live status + detail reflect the new state
    const fresh = await botsApi.get(id);
    setBot(fresh);
    if (result.restartRequired) {
      toast.warn(
        `Saved, but restart required: ${result.reasons.join("; ")}`,
      );
    } else if (!options.silent) {
      toast.show("Saved", "success");
    }
    return { restartRequired: result.restartRequired, reasons: result.reasons };
  } catch (err) {
    toast.show(`Save failed: ${msg(err)}`, "error");
    return null;
  }
}

export async function deleteBot(id: string): Promise<boolean> {
  try {
    await botsApi.remove(id);
    bots.value = bots.value.filter((b) => b.id !== id);
    toast.show("Bot deleted", "success");
    return true;
  } catch (err) {
    toast.show(`Delete failed: ${msg(err)}`, "error");
    return false;
  }
}

export async function startBot(id: string): Promise<boolean> {
  try {
    await botsApi.start(id);
    const fresh = await botsApi.get(id);
    setBot(fresh);
    if (fresh.status === "online") toast.show(`Bot "${fresh.name}" is online`, "success");
    else if (fresh.status === "error") toast.error(`Bot failed to start: ${fresh.detail ?? "unknown error"}`);
    return fresh.status === "online";
  } catch (err) {
    toast.show(`Start failed: ${msg(err)}`, "error");
    return false;
  }
}

export async function stopBot(id: string): Promise<void> {
  try {
    await botsApi.stop(id);
    const fresh = await botsApi.get(id);
    setBot(fresh);
    toast.show(`Bot stopped`, "info");
  } catch (err) {
    toast.show(`Stop failed: ${msg(err)}`, "error");
  }
}

export async function restartBot(id: string): Promise<boolean> {
  try {
    await botsApi.restart(id);
    const fresh = await botsApi.get(id);
    setBot(fresh);
    toast.show("Bot restarted", "success");
    return fresh.status === "online";
  } catch (err) {
    toast.show(`Restart failed: ${msg(err)}`, "error");
    return false;
  }
}

export function refreshBot(id: string): Promise<void> {
  return botsApi.get(id).then(setBot).catch(() => {});
}

// poll a single bot's status briefly after start/restart so the UI catches the
// transition (online / error). discards after
export function pollStatus(id: string, rounds = 4, intervalMs = 1500): void {
  let count = 0;
  const timer = setInterval(async () => {
    count++;
    try {
      const fresh = await botsApi.get(id);
      batch(() => setBot(fresh));
      if (fresh.status === "online" || fresh.status === "error" || count >= rounds) {
        clearInterval(timer);
      }
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
