// summaries viewer/editor api. mirrors the server wire shapes from
// server/http/routes/summaries.ts.

import { http } from "./client";

export interface SummaryWire {
  id: string;
  seq: number;
  content: string;
  tokenEstimate: number;
  startMessageId: string | null;
  endMessageId: string | null;
  createdAt: number;
}

export interface SummaryChannelGroup {
  channelId: string;
  watermark: string | null;
  summaries: SummaryWire[];
}

export const summariesApi = {
  list: (botId: string) => http.get<{ channels: SummaryChannelGroup[] }>(`/bots/${botId}/summaries`),
  update: (botId: string, summaryId: string, content: string) =>
    http.patch<{ ok: true }>(`/bots/${botId}/summaries/${summaryId}`, { content }),
  remove: (botId: string, summaryId: string) =>
    http.del<{ ok: true; channelId: string }>(`/bots/${botId}/summaries/${summaryId}`),
  clearChannel: (botId: string, channelId: string) =>
    http.del<{ ok: true }>(`/bots/${botId}/summaries?channelId=${encodeURIComponent(channelId)}`),
};
