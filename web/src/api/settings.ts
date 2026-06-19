import { http } from "./client";

// the settings kv. only the editable subset is returned by the server.
export type Settings = {
  log_retention_days?: string;
  log_history?: string;
  log_level_default?: string;
  tool_log_retention_days?: string;
};

export const settingsApi = {
  list: () => http.get<Settings>("/settings"),
  update: (patch: Settings) => http.patch<{ ok: true; applied: Settings; settings: Settings }>("/settings", patch),
};
