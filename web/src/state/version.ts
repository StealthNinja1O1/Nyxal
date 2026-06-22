import { signal, computed } from "@preact/signals";
import { versionApi, type VersionInfo } from "../api/version";

export const versionInfo = signal<VersionInfo | null>(null);

export const versionStatus = computed<"ok" | "update" | "unknown">(() => {
  const v = versionInfo.value;
  if (!v || !v.latest) return "unknown";
  return v.updateAvailable ? "update" : "ok";
});

export const currentVersion = computed(() => versionInfo.value?.current ?? "0.0.0");

export async function loadVersionInfo(): Promise<void> {
  try {
    versionInfo.value = await versionApi.get();
  } catch {
  }
}
