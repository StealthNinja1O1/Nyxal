// ws client. one persistent connection to /ws, pushes events into signals.
// auto-reconnects on drop with exponential backoff. sends the user's chosen
// log level filter so the server only pushes those live.

import { signal, batch } from "@preact/signals";
import type { BotStatus } from "../api/bots-types";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogRow {
  id?: number;
  botId: string | null;
  level: LogLevel;
  scope: string;
  message: string;
  createdAt: number;
}

export interface LlmCallEvent {
  botId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ms: number;
  success: boolean;
  at: number;
}

export interface BotStatusEvent {
  botId: string;
  status: BotStatus;
  name?: string;
  detail?: string;
}

export const wsConnected = signal(false);
export const recentLogs = signal<LogRow[]>([]);
export const liveLlmCalls = signal<LlmCallEvent[]>([]);
export const botStatusEvents = signal<BotStatusEvent[]>([]);
export const logLevels = signal<LogLevel[]>(["DEBUG", "INFO", "WARN", "ERROR"]);

const MAX_LOGS_IN_MEMORY = 500;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 500;

/** open (or reopen) the ws connection. */
export function connectWs(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${window.location.host}/ws`);

  ws.addEventListener("open", () => {
    wsConnected.value = true;
    reconnectDelay = 500;
    sendLevelFilter();
  });

  ws.addEventListener("close", () => {
    wsConnected.value = false;
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    ws?.close();
  });

  ws.addEventListener("message", (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as { type: string } & Record<string, unknown>;
    handleMessage(ev);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    connectWs();
  }, reconnectDelay);
}

function handleMessage(ev: { type: string } & Record<string, unknown>): void {
  switch (ev.type) {
    case "log.history": {
      const rows = (ev as unknown as { logs: LogRow[] }).logs;
      recentLogs.value = rows.slice(-MAX_LOGS_IN_MEMORY);
      break;
    }
    case "log": {
      const row = (ev as unknown as { log: LogRow }).log;
      batch(() => {
        const next = [...recentLogs.value, row];
        if (next.length > MAX_LOGS_IN_MEMORY) next.splice(0, next.length - MAX_LOGS_IN_MEMORY);
        recentLogs.value = next;
      });
      break;
    }
    case "llm.call": {
      const call = ev as unknown as LlmCallEvent;
      batch(() => {
        const next = [...liveLlmCalls.value, call];
        // keep the last 200 in memory
        if (next.length > 200) next.splice(0, next.length - 200);
        liveLlmCalls.value = next;
      });
      break;
    }
    case "bot.status": {
      const ev2 = ev as unknown as BotStatusEvent;
      batch(() => {
        // replace any prior entry for the same bot
        const next = botStatusEvents.value.filter((b) => b.botId !== ev2.botId);
        next.push(ev2);
        botStatusEvents.value = next;
      });
      break;
    }
    case "hello":
      // server greeting, nothing to do
      break;
  }
}

/** update the user's log level filter; tells the server too. */
export function setLogLevels(levels: LogLevel[]): void {
  logLevels.value = levels;
  sendLevelFilter();
}

function sendLevelFilter(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "log.levels", levels: logLevels.value }));
}
