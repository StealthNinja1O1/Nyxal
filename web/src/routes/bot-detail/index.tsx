import { useEffect, useState } from "preact/hooks";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Play, Square, RotateCw } from "lucide-react";
import { bots, loadBots, startBot, stopBot, restartBot, pollStatus } from "../../state/bots";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import { LoadingState } from "../../components/State";
import { CharacterTab } from "./CharacterTab";
import { BehaviorTab } from "./BehaviorTab";
import { LorebookTab } from "./LorebookTab";
import { ExtensionsTab } from "./ExtensionsTab";

type Tab = "character" | "behavior" | "lorebook" | "memory" | "extensions";

export function BotDetailRoute() {
  const [match, params] = useRoute("/bots/:id");
  const botId = params?.id;
  const [tab, setTab] = useState<Tab>("character");

  useEffect(() => {
    if (bots.value.length === 0) void loadBots();
  }, []);

  if (!match || !botId) return <p>Invalid route.</p>;

  const bot = bots.value.find((b) => b.id === botId);

  if (!bot) {
    if (botsLoadingFallback()) return <LoadingState label="Loading bot..." />;
    return (
      <div>
        <p>Bot not found.</p>
        <Link href="/bots">
          <Button variant="ghost" size="sm">
            <ArrowLeft size={14} />
            Back to bots
          </Button>
        </Link>
      </div>
    );
  }

  const running = bot.status === "online" || bot.status === "starting";

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Link href="/bots">
          <Button variant="ghost" size="sm">
            <ArrowLeft size={14} />
            Bots
          </Button>
        </Link>
      </div>

      <div class="detail-header">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{bot.name}</h1>
          <div class="bot-card-meta">
            {bot.llmModel || "no model"} - {bot.discordTokenMasked || "no token"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status={bot.status} detail={bot.detail} />
          {running ? (
            <Button variant="subtle" size="sm" onClick={() => void stopBot(bot.id)}>
              <Square size={14} />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                if (await startBot(bot.id)) pollStatus(bot.id);
              }}
            >
              <Play size={14} />
              Start
            </Button>
          )}
          <Button
            variant="subtle"
            size="sm"
            onClick={async () => {
              if (await restartBot(bot.id)) pollStatus(bot.id);
            }}
            disabled={!running}
          >
            <RotateCw size={14} />
            Restart
          </Button>
        </div>
      </div>

      <div class="tabs">
        <button class={`tab ${tab === "character" ? "active" : ""}`} onClick={() => setTab("character")}>
          Character
        </button>
        <button class={`tab ${tab === "behavior" ? "active" : ""}`} onClick={() => setTab("behavior")}>
          Behavior
        </button>
        <button class={`tab ${tab === "lorebook" ? "active" : ""}`} onClick={() => setTab("lorebook")}>
          Lorebook
        </button>
        <button class={`tab ${tab === "memory" ? "active" : ""}`} onClick={() => setTab("memory")}>
          Memory
        </button>
        <button class={`tab ${tab === "extensions" ? "active" : ""}`} onClick={() => setTab("extensions")}>
          Extensions
        </button>
      </div>

      {tab === "character" && <CharacterTab botId={botId} />}
      {tab === "behavior" && <BehaviorTab bot={bot} />}
      {tab === "lorebook" && <LorebookTab botId={botId} book="static" />}
      {tab === "memory" && <LorebookTab botId={botId} book="memory" />}
      {tab === "extensions" && <ExtensionsTab bot={bot} />}
    </section>
  );
}

// tiny helper: signal check without importing the loading flag (keeps the file lean)
function botsLoadingFallback(): boolean {
  // if we haven't loaded yet, show loading. this is a quick heuristic - the
  // real load happens in the effect above.
  return bots.value.length === 0;
}
