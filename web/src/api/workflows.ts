import { http } from "./client";
import type { ComfyWorkflow, ComfyWorkflowNode } from "@shared/types";

export type WorkflowListItem = Omit<ComfyWorkflow, "content">;

export interface WorkflowInput {
  name: string;
  description?: string;
  content: Record<string, ComfyWorkflowNode>;
}

export type WorkflowPatch = Partial<WorkflowInput>;

export const workflowsApi = {
  list: () => http.get<WorkflowListItem[]>("/workflows"),
  get: (id: string) => http.get<ComfyWorkflow>(`/workflows/${id}`),
  create: (input: WorkflowInput) => http.post<ComfyWorkflow>("/workflows", input),
  update: (id: string, patch: WorkflowPatch) => http.patch<ComfyWorkflow>(`/workflows/${id}`, patch),
  remove: (id: string) => http.del<{ ok: true }>(`/workflows/${id}`),
};
