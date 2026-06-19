// websocket hub. the single broadcast point for live dashboard events.
//
// clients connect to /ws, send {type:"log.levels", levels:[...]} to set which
// log levels they want pushed live (default: all). on connect, the hub replays
// the last N log rows from the db so the user can scroll back through history.
//
// bot status, llm calls, memory updates etc. are pushed via `broadcast()` from
// wherever they may happen

import { db } from "../../db";
import { logs } from "../../db/schema";
import { asc, desc, inArray, sql } from "drizzle-orm";
import type { LogLevel } from "../utils/logger";
import { getSettingNumber } from "../../http/routes/settingsCache";

export interface LogEvent {
  type: "log";
  log: {
    id?: number;
    botId: string | null;
    level: LogLevel;
    scope: string;
    message: string;
    createdAt: number;
  };
}

export type WsEvent =
  | { type: "hello"; ts: number }
  | { type: "log.history"; logs: LogEvent["log"][] }
  | LogEvent
  | { type: "bot.status"; botId: string; status: string; detail?: string; name?: string }
  | {
      type: "llm.call";
      botId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      ms: number;
      success: boolean;
      at: number;
    }
  | { type: "memory.updated"; botId: string; entryName: string }
  | { type: "bot.chat"; botId: string; channel: string; author: string; preview: string; at: number };

export interface WsServerLike {
  publish(topic: string, data: unknown): void;
  send(data: unknown): void;
  id: string;
  subscribe(topic: string): void;
  data: unknown;
}

// per-connection state: which log levels this client wants live
const clientLevels = new Map<string, Set<LogLevel>>();

export function registerWsClient(ws: WsServerLike): void {
  clientLevels.set(ws.id, new Set<LogLevel>(["DEBUG", "INFO", "WARN", "ERROR"]));
}

export function unregisterWsClient(ws: WsServerLike): void {
  clientLevels.delete(ws.id);
}

export async function handleWsMessage(ws: WsServerLike, raw: unknown): Promise<void> {
  // bun delivers ws messages as already-parsed objects (see ui-component-pitfalls.md)
  const msg = (typeof raw === "string" ? JSON.parse(raw) : raw) as { type?: string; levels?: string[] };
  if (msg?.type === "log.levels" && Array.isArray(msg.levels)) {
    const set = new Set<LogLevel>();
    for (const l of msg.levels) {
      if (l === "DEBUG" || l === "INFO" || l === "WARN" || l === "ERROR") set.add(l);
    }
    clientLevels.set(ws.id, set);
  }
}

// client asked for history on connect
export async function sendLogHistory(ws: WsServerLike, levels?: LogLevel[]): Promise<void> {
  // history limit is read live from settings so a settings change takes effect for the next client connect without a restart.
  const historyLimit = getSettingNumber("log_history", 500);
  const rows = await db
    .select()
    .from(logs)
    .orderBy(desc(logs.id))
    .limit(historyLimit);
  const events = rows
    .reverse()
    .filter((r) => (levels ? levels.includes(r.level as LogLevel) : true))
    .map((r) => ({
      id: r.id,
      botId: r.botId,
      level: r.level as LogLevel,
      scope: r.scope,
      message: r.message,
      createdAt: r.createdAt.getTime(),
    }));
  ws.send({ type: "log.history", logs: events } satisfies WsEvent);
}

/**
 * Push a single log line live to all clients whose level filter includes it.
 * Called by the bot logger on every line.
 */
export function pushLogLive(log: LogEvent["log"]): void {
  // elysia ws wsServer instance has its own send. we don't have direct
  // access to all of them from here, so we go through the bot's stored refs.
  for (const [clientId, levels] of clientLevels) {
    if (!levels.has(log.level)) continue;
    const ws = connectedSockets.get(clientId);
    if (ws) ws.send({ type: "log", log } satisfies WsEvent);
  }
}

const connectedSockets = new Map<string, WsServerLike>();

export function trackSocket(ws: WsServerLike): void {
  connectedSockets.set(ws.id, ws);
}
export function untrackSocket(ws: WsServerLike): void {
  connectedSockets.delete(ws.id);
}

export function broadcast(event: WsEvent): void {
  for (const ws of connectedSockets.values()) ws.send(event);
}

export { sql, asc, inArray };
