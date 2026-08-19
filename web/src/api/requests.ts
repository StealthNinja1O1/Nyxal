// LLM request capture api. mirrors server/http/routes/requests.ts.

import { http } from "./client";
import type { LlmRequestCapture } from "@shared/types";

export const requestsApi = {
  list: (botId: string) => http.get<{ captures: LlmRequestCapture[] }>(`/bots/${botId}/requests`),
};
