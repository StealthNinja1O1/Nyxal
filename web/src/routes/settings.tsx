import { useEffect, useState } from "preact/hooks";
import { Save, Github, Info, Download, ArrowUpCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { settingsApi, type Settings } from "../api/settings";
import { toast } from "../state/toast";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { LoadingState } from "../components/State";
import { Callout } from "../components/Callout";
import { versionInfo, versionStatus, loadVersionInfo } from "../state/version";

const GITHUB_URL = "https://github.com/StealthNinja1O1/Nyxal";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsRoute() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retention, setRetention] = useState("30");
  const [history, setHistory] = useState("500");
  const [toolRetention, setToolRetention] = useState("365");
  const [defaultLevel, setDefaultLevel] = useState("INFO");

  useEffect(() => {
    void loadVersionInfo();
    void (async () => {
      try {
        const s = await settingsApi.list();
        setRetention(s.log_retention_days ?? "30");
        setHistory(s.log_history ?? "500");
        setToolRetention(s.tool_log_retention_days ?? "365");
        setDefaultLevel(s.log_level_default ?? "INFO");
      } catch (err) {
        toast.show(`Failed to load settings: ${msg(err)}`, "error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await settingsApi.update({
        log_retention_days: retention,
        log_history: history,
        tool_log_retention_days: toolRetention,
        log_level_default: defaultLevel,
      });
      toast.show("Settings saved", "success");
    } catch (err) {
      toast.show(`Save failed: ${msg(err)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading settings..." />;

  return (
    <div class="overview-stack">
      <section>
        <div class="section-head">
          <h2>Logging</h2>
          <Button onClick={save} loading={saving} disabled={saving}>
            <Save size={15} />
            Save
          </Button>
        </div>

        <div class="setting-group">
          <div class="setting-row-grid">
            <Field
              label="Log retention (days)"
              name="retention"
              type="number"
              min={1}
              max={3650}
              value={retention}
              onInput={(e) => setRetention((e.target as HTMLInputElement).value)}
              hint="Logs older than this are pruned hourly. Range 1-3650."
            />
            <Field
              label="WS log history"
              name="history"
              type="number"
              min={50}
              max={10000}
              value={history}
              onInput={(e) => setHistory((e.target as HTMLInputElement).value)}
              hint="Most recent log rows replayed to a client on connect. Range 50-10000."
            />
          </div>
          <div class="field" style={{ marginBottom: 12 }}>
            <label class="field-label" for="default-level">
              Default log level (new bots)
            </label>
            <select
              id="default-level"
              class="field-input"
              value={defaultLevel}
              onChange={(e) => setDefaultLevel((e.target as HTMLSelectElement).value)}
            >
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
            <p class="field-hint">
              Applied to newly created bots only. Existing bots keep their per-bot level (Behavior tab).
            </p>
          </div>
        </div>

        <Callout icon={<Info size={15} />} title="Hot-reload note">
          <strong>WS log history</strong> applies to the next client connect (no restart).
          <strong> Retention</strong> is enforced by the hourly pruner. Changing the default level only
          affects bots created after the change.
        </Callout>
      </section>

      <section>
        <div class="section-head">
          <h2>Tool calls</h2>
          <Button onClick={save} loading={saving} disabled={saving}>
            <Save size={15} />
            Save
          </Button>
        </div>

        <div class="setting-group">
          <Field
            label="Tool call retention (days)"
            name="tool_retention"
            type="number"
            min={0}
            max={36500}
            value={toolRetention}
            onInput={(e) => setToolRetention((e.target as HTMLInputElement).value)}
            hint="How long to keep tool call history (generateImage args, webSearch, etc). 0 = keep forever. Range 0-36500."
          />
        </div>

        <Callout icon={<Info size={15} />} title="What gets logged">
          Every bot function call (instant / async / recursive commands) is recorded with its arguments
          + outcome. View them on the <strong>Tool calls</strong> page. MCP tools will be logged
          automatically once MCP support lands.
        </Callout>
      </section>

      <section>
        <div class="section-head">
          <h2>About</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadVersionInfo()}
            title="Re-check for updates"
          >
            <RefreshCw size={14} />
            Check for updates
          </Button>
        </div>
        <div class="settings-about">
          <div class="settings-about-row">
            <span class="settings-about-key">Project</span>
            <span class="settings-about-val">Nyxal</span>
          </div>
          <div class="settings-about-row">
            <span class="settings-about-key">Installed version</span>
            <span class="settings-about-val">
              <span class="mono">v{versionInfo.value?.current ?? "..."}</span>
              {versionStatus.value === "ok" && (
                <span class="about-status about-status-ok">
                  <CheckCircle2 size={13} />
                  Up to date
                </span>
              )}
            </span>
          </div>
          <div class="settings-about-row">
            <span class="settings-about-key">Latest release</span>
            <span class="settings-about-val">
              {versionInfo.value?.latest ? (
                <>
                  <span class="mono">v{versionInfo.value.latest}</span>
                  {versionStatus.value === "update" && (
                    <span class="about-status about-status-update">
                      <ArrowUpCircle size={13} />
                      Update available
                    </span>
                  )}
                </>
              ) : (
                <span class="about-status about-status-unknown">Checking...</span>
              )}
            </span>
          </div>
          {versionInfo.value?.releaseUrl && (
            <div class="settings-about-row">
              <span class="settings-about-key">Release notes</span>
              <span class="settings-about-val">
                <a href={versionInfo.value.releaseUrl} target="_blank" rel="noreferrer">
                  <Github size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  {versionInfo.value.latest ? `v${versionInfo.value.latest} changelog` : "latest release"}
                </a>
              </span>
            </div>
          )}
          <div class="settings-about-row">
            <span class="settings-about-key">Source</span>
            <span class="settings-about-val">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Github size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
                StealthNinja1O1/Nyxal
              </a>
            </span>
          </div>
        </div>

        {versionInfo.value && versionInfo.value.assets.length > 0 && (
          <div class="version-downloads">
            <div class="version-downloads-title">
              <Download size={14} />
              Download{versionStatus.value === "update" ? " update" : ""}
              {versionInfo.value.latest && (
                <span class="version-downloads-version">v{versionInfo.value.latest}</span>
              )}
            </div>
            <div class="version-asset-grid">
              {versionInfo.value.assets.map((a) => (
                <a
                  key={a.name}
                  class="version-asset-card"
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span class="version-asset-label">{a.label}</span>
                  <span class="version-asset-size">{formatBytes(a.size)}</span>
                  <Download size={14} class="version-asset-icon" />
                </a>
              ))}
            </div>
            <p class="field-hint">
              Pre-built binaries from the latest GitHub release. Source code is also
              available on the{" "}
              <a href={versionInfo.value.releaseUrl ?? GITHUB_URL} target="_blank" rel="noreferrer">
                releases page
              </a>
              .
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
