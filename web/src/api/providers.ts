import { http } from "./client";
import type { Provider, ProviderInput, ProviderPatch, TestResult, ModelsResult } from "./types";

export const providersApi = {
  list: () => http.get<Provider[]>("/providers"),
  get: (id: string) => http.get<Provider>(`/providers/${id}`),
  create: (input: ProviderInput) => http.post<Provider>("/providers", input),
  update: (id: string, patch: ProviderPatch) => http.patch<Provider>(`/providers/${id}`, patch),
  remove: (id: string) => http.del<{ ok: true }>(`/providers/${id}`),
  models: (id: string) => http.get<ModelsResult>(`/providers/${id}/models`),
  test: (id: string) => http.post<TestResult>(`/providers/${id}/test`),
};
