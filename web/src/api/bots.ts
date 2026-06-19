import { http } from "./client";
import type {
  Bot,
  BotCreateInput,
  BotPatch,
  PatchResult,
  Character,
  CharacterPatch,
} from "./bots-types";

export const botsApi = {
  list: () => http.get<Bot[]>("/bots"),
  get: (id: string) => http.get<Bot>(`/bots/${id}`),
  create: (input: BotCreateInput) => http.post<Bot>("/bots", input),
  update: (id: string, patch: BotPatch) => http.patch<PatchResult>(`/bots/${id}`, patch),
  remove: (id: string) => http.del<{ ok: true }>(`/bots/${id}`),
  start: (id: string) => http.post<{ ok: boolean; status: string }>(`/bots/${id}/start`),
  stop: (id: string) => http.post<{ ok: boolean; status: string }>(`/bots/${id}/stop`),
  restart: (id: string) => http.post<{ ok: boolean; status: string }>(`/bots/${id}/restart`),
  getCharacter: (id: string) => http.get<Character>(`/bots/${id}/character`),
  updateCharacter: (id: string, patch: CharacterPatch) =>
    http.put<Character>(`/bots/${id}/character`, patch),
  getTools: (id: string) =>
    http.get<{
      builtin: Array<{
        name: string;
        kind: "instant" | "async" | "recursive";
        category: "builtin" | "websearch" | "comfyui" | "mcp";
        args: Record<string, unknown>;
        description: string;
        defaultEnabled: boolean;
        effectiveEnabled: boolean;
        override?: { enabled?: boolean; description?: string };
      }>;
      mcpServers: Array<{
        id: string;
        name: string;
        url: string;
        enabled: boolean;
        lastFetchedAt: number | null;
        lastFetchError: string | null;
        toolCount: number;
      }>;
      mcpToolsByServer: Record<
        string,
        Array<{
          name: string;
          description: string;
          defaultEnabled: boolean;
          effectiveEnabled: boolean;
          override?: { enabled?: boolean; description?: string };
        }>
      >;
    }>(`/bots/${id}/tools`),
};
