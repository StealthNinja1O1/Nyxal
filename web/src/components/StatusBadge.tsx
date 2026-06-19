import { Badge } from "./Badge";
import type { BotStatus } from "../api/bots-types";

const TONE: Record<BotStatus, "ok" | "warn" | "err" | "info" | "neutral"> = {
  online: "ok",
  starting: "info",
  error: "err",
  stopped: "neutral",
  disabled: "warn",
};

const LABEL: Record<BotStatus, string> = {
  online: "online",
  starting: "starting",
  error: "error",
  stopped: "stopped",
  disabled: "disabled",
};

export function StatusBadge({ status, detail }: { status: BotStatus; detail?: string }) {
  return (
    <span title={detail}>
      <Badge tone={TONE[status]}>
        <span class={`status-dot status-${status}`} />
        {LABEL[status]}
      </Badge>
    </span>
  );
}
