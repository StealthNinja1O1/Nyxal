import { http } from "./client";

export interface ReleaseAsset {
  name: string;
  label: string;
  url: string;
  size: number;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: number | null;
  releaseUrl: string | null;
  assets: ReleaseAsset[];
}

export const versionApi = {
  get: () => http.get<VersionInfo>("/version"),
};
