// version + update-check endpoint.
//
// GET /api/version   ->  { current, latest?, updateAvailable, checkedAt?, releaseUrl?, assets[] }
//
// - `current` always reflects package.json (single source of truth, no drift).
// - `latest` is fetched from the GitHub releases API with a 1h in-memory cache.

import { Elysia } from "elysia";
import pkg from "../../../package.json";

const RELEASES_URL = "https://api.github.com/repos/StealthNinja1O1/Nyxal/releases";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ReleaseAsset {
  name: string;
  label: string;
  url: string;
  size: number;
}

interface CachedRelease {
  tagName: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
  fetchedAt: number;
}

let cached: CachedRelease | null = null;
let inFlight: Promise<void> | null = null;

const ASSET_LABELS: { match: RegExp; label: string }[] = [
  { match: /^nyxal-darwin-arm64/, label: "macOS Apple Silicon" },
  { match: /^nyxal-darwin-x64/, label: "macOS Intel" },
  { match: /^nyxal-linux-arm64/, label: "Linux ARM64" },
  { match: /^nyxal-linux-x64/, label: "Linux x64" },
  { match: /^nyxal-windows-x64/, label: "Windows x64" },
];

function labelFor(name: string): string {
  for (const { match, label } of ASSET_LABELS) if (match.test(name)) return label;
  return name;
}

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: { name: string; browser_download_url: string; size: number }[];
}

async function refreshLatest(): Promise<void> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        "User-Agent": `Nyxal/${pkg.version}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`github releases http ${res.status}`);
    const data = (await res.json()) as GithubRelease | GithubRelease[];
    const list = Array.isArray(data) ? data : [data];
    const picked =
      list.find((r) => r && !r.draft && !r.prerelease) ?? list[0] ?? null;
    if (!picked || !picked.tag_name) throw new Error("no usable release in payload");

    cached = {
      tagName: picked.tag_name,
      htmlUrl: picked.html_url ?? "",
      assets: (picked.assets ?? []).map((a) => ({
        name: a.name,
        label: labelFor(a.name),
        url: a.browser_download_url,
        size: a.size,
      })),
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn("[version] github releases fetch failed:", err instanceof Error ? err.message : err);
  }
}

function maybeRefresh(): void {
  const stale = !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS;
  if (stale && !inFlight) {
    inFlight = refreshLatest().finally(() => {
      inFlight = null;
    });
  }
}

export function compareVersions(a: string, b: string): number {
  const na = a.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const nb = b.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i++) {
    const da = na[i] ?? 0;
    const db = nb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export const versionRoutes = new Elysia({ prefix: "/api" }).get("/version", () => {
  maybeRefresh();
  const latest = cached?.tagName.replace(/^v/, "") ?? null;
  const updateAvailable = latest ? compareVersions(latest, pkg.version) > 0 : false;
  return {
    current: pkg.version,
    latest,
    updateAvailable,
    checkedAt: cached?.fetchedAt ?? null,
    releaseUrl: cached?.htmlUrl ?? null,
    assets: cached?.assets ?? [],
  };
});

void refreshLatest();
