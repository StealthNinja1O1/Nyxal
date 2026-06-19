import { signal, computed } from "@preact/signals";
import { workflowsApi } from "../api/workflows";
import type { WorkflowListItem } from "../api/workflows";
import { toast } from "./toast";

export const workflows = signal<WorkflowListItem[]>([]);
export const workflowsLoading = signal(false);
export const workflowCount = computed(() => workflows.value.length);

export async function loadWorkflows(): Promise<void> {
  workflowsLoading.value = true;
  try {
    workflows.value = await workflowsApi.list();
  } catch (err) {
    toast.show(`Failed to load workflows: ${msg(err)}`, "error");
  } finally {
    workflowsLoading.value = false;
  }
}

function setWorkflow(updated: WorkflowListItem): void {
  workflows.value = workflows.value.map((w) => (w.id === updated.id ? updated : w));
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  content: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const created = await workflowsApi.create(input as any);
    workflows.value = [...workflows.value, { id: created.id, name: created.name, description: created.description, createdAt: created.createdAt, updatedAt: created.updatedAt }];
    toast.show(`Workflow "${created.name}" created`, "success");
    return created.id;
  } catch (err) {
    toast.show(`Create failed: ${msg(err)}`, "error");
    return null;
  }
}

export async function updateWorkflowMeta(
  id: string,
  patch: { name?: string; description?: string },
): Promise<void> {
  try {
    const updated = await workflowsApi.update(id, patch);
    setWorkflow({ id: updated.id, name: updated.name, description: updated.description, createdAt: updated.createdAt, updatedAt: updated.updatedAt });
    toast.show("Saved", "success");
  } catch (err) {
    toast.show(`Save failed: ${msg(err)}`, "error");
  }
}

export async function updateWorkflowContent(
  id: string,
  content: Record<string, unknown>,
): Promise<void> {
  try {
    await workflowsApi.update(id, { content: content as any });
    toast.show("Workflow nodes saved", "success");
  } catch (err) {
    toast.show(`Save failed: ${msg(err)}`, "error");
  }
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  try {
    await workflowsApi.remove(id);
    workflows.value = workflows.value.filter((w) => w.id !== id);
    toast.show("Workflow deleted", "success");
    return true;
  } catch (err) {
    toast.show(`Delete failed: ${msg(err)}`, "error");
    return false;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
