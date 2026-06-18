import { signal, computed } from "@preact/signals";
import { providersApi } from "../api/providers";
import type { Provider } from "../api/types";
import { toast, type ToastKind } from "./toast";

// All known providers. Refreshed on load + after every mutation.
export const providers = signal<Provider[]>([]);
export const providersLoading = signal(false);

export const providerCount = computed(() => providers.value.length);

//Load providers from the server into the signal. Safe to call repeatedly.
export async function loadProviders(): Promise<void> {
  providersLoading.value = true;
  try {
    providers.value = await providersApi.list();
  } catch (err) {
    toast.show(`Failed to load providers: ${errMsg(err)}`, "error");
  } finally {
    providersLoading.value = false;
  }
}

export async function createProvider(input: {
  name: string;
  baseUrl: string;
  apiKey: string;
}): Promise<Provider | null> {
  try {
    const created = await providersApi.create(input);
    providers.value = [...providers.value, created];
    toast.show(`Provider "${created.name}" created`, "success");
    return created;
  } catch (err) {
    toast.show(`Create failed: ${errMsg(err)}`, "error");
    return null;
  }
}

export async function updateProvider(
  id: string,
  patch: { name?: string; baseUrl?: string; apiKey?: string },
): Promise<Provider | null> {
  try {
    const updated = await providersApi.update(id, patch);
    providers.value = providers.value.map((p) => (p.id === id ? updated : p));
    toast.show(`Provider "${updated.name}" updated`, "success");
    return updated;
  } catch (err) {
    toast.show(`Update failed: ${errMsg(err)}`, "error");
    return null;
  }
}

export async function deleteProvider(id: string): Promise<boolean> {
  try {
    await providersApi.remove(id);
    providers.value = providers.value.filter((p) => p.id !== id);
    toast.show("Provider deleted", "success");
    return true;
  } catch (err) {
    toast.show(`Delete failed: ${errMsg(err)}`, "error");
    return false;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { ToastKind };
