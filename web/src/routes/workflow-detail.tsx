// workflow detail. top: name + description editor. bottom: the node editor.
// walks every node, collects all scalar inputs (string / number / boolean),
// and lets you edit them inline. skips array values (those are node link
// references like ["118", 1]). also flags which field contains <PROMPT> (the
// injection point) and lets you mark any string field as the prompt node.

import { useEffect, useRef, useState } from "preact/hooks";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Save, AlertCircle, CheckCircle2, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { workflowsApi } from "../api/workflows";
import type { ComfyWorkflow, ComfyWorkflowNode } from "@shared/types";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { TextArea } from "../components/TextArea";
import { Toggle } from "../components/Toggle";
import { LoadingState } from "../components/State";
import { updateWorkflowMeta, updateWorkflowContent } from "../state/workflows";
import { toast } from "../state/toast";

interface ScalarInput {
  nodeId: string;
  nodeTitle: string;
  classType: string;
  key: string;
  type: "string" | "int" | "float" | "boolean";
  value: string | number | boolean;
  isPrompt: boolean;
}

interface ScalarNodeRow {
  nodeId: string;
  nodeTitle: string;
  classType: string;
  inputs: ScalarInput[];
  hasPrompt: boolean;
}

interface ScalarClassGroup {
  classType: string;
  nodes: ScalarNodeRow[];
  hasPrompt: boolean;
  inputCount: number;
}

/**
 * walk the workflow and collect every primitive scalar input (string /
 * number / boolean). skips arrays and objects
 */
function extractScalarInputs(content: Record<string, ComfyWorkflowNode>): ScalarNodeRow[] {
  const nodeMap = new Map<string, ScalarInput[]>();
  const meta = new Map<string, { title: string; classType: string }>();

  for (const [nodeId, node] of Object.entries(content)) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    const classType = node?.class_type || "(unknown)";
    const nodeTitle = node?._meta?.title || nodeId;
    meta.set(nodeId, { title: nodeTitle, classType });

    for (const [key, val] of Object.entries(inputs)) {
      // arrays = node link references (e.g. ["118", 1]). never editable.
      if (Array.isArray(val)) continue;
      // objects = complex widgets (lora entries etc.). handled elsewhere.
      if (val !== null && typeof val === "object") continue;

      let type: ScalarInput["type"];
      let value: string | number | boolean;
      if (typeof val === "string") {
        type = "string";
        value = val;
      } else if (typeof val === "boolean") {
        type = "boolean";
        value = val;
      } else if (typeof val === "number" && Number.isFinite(val)) {
        type = Number.isInteger(val) ? "int" : "float";
        value = val;
      } else {
        continue; // null / undefined / NaN
      }

      if (!nodeMap.has(nodeId)) nodeMap.set(nodeId, []);
      nodeMap.get(nodeId)!.push({
        nodeId,
        nodeTitle,
        classType,
        key,
        type,
        value,
        isPrompt: type === "string" && val === "<PROMPT>",
      });
    }
  }

  const rows: ScalarNodeRow[] = [];
  for (const [nodeId, inputs] of nodeMap) {
    const m = meta.get(nodeId)!;
    rows.push({
      nodeId,
      nodeTitle: m.title,
      classType: m.classType,
      inputs,
      hasPrompt: inputs.some((i) => i.isPrompt),
    });
  }
  // prompt node first, then by title
  rows.sort((a, b) => {
    if (a.hasPrompt !== b.hasPrompt) return a.hasPrompt ? -1 : 1;
    return a.nodeTitle.localeCompare(b.nodeTitle);
  });
  return rows;
}

function groupScalarByClass(rows: ScalarNodeRow[]): ScalarClassGroup[] {
  const byClass = new Map<string, ScalarNodeRow[]>();
  for (const row of rows) {
    if (!byClass.has(row.classType)) byClass.set(row.classType, []);
    byClass.get(row.classType)!.push(row);
  }
  const groups: ScalarClassGroup[] = [];
  for (const [classType, nodes] of byClass) {
    groups.push({
      classType,
      nodes,
      hasPrompt: nodes.some((n) => n.hasPrompt),
      inputCount: nodes.reduce((acc, n) => acc + n.inputs.length, 0),
    });
  }
  groups.sort((a, b) => {
    if (a.hasPrompt !== b.hasPrompt) return a.hasPrompt ? -1 : 1;
    return a.classType.localeCompare(b.classType);
  });
  return groups;
}

interface LoraEntry {
  key: string; // "lora_1"
  name: string; // lora filename
  on: boolean;
  strength: number;
}

interface LoraLoaderRow {
  nodeId: string;
  title: string;
  classType: string;
  loras: LoraEntry[];
}

/**
 * find Power Lora Loader (rgthree) nodes and collect each lora_N entry.
 * skips the header widget + "Add Lora" placeholder + connection arrays.
 */
function extractLoraLoaders(content: Record<string, ComfyWorkflowNode>): LoraLoaderRow[] {
  const rows: LoraLoaderRow[] = [];
  for (const [nodeId, node] of Object.entries(content)) {
    if (node?.class_type !== "Power Lora Loader (rgthree)") continue;
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    const loras: LoraEntry[] = [];
    for (const [key, val] of Object.entries(inputs)) {
      if (!/^lora_\d+$/.test(key)) continue;
      if (!val || typeof val !== "object") continue;
      const v = val as Record<string, unknown>;
      if (typeof v.lora !== "string") continue;
      loras.push({
        key,
        name: v.lora,
        on: v.on === true,
        strength: typeof v.strength === "number" ? v.strength : 1,
      });
    }
    if (loras.length === 0) continue;
    rows.push({
      nodeId,
      title: node?._meta?.title || nodeId,
      classType: node?.class_type || "(unknown)",
      loras,
    });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title));
  return rows;
}

export function WorkflowDetailRoute() {
  const [match, params] = useRoute("/workflows/:id");
  const id = params?.id;
  const [workflow, setWorkflow] = useState<ComfyWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingContent, setSavingContent] = useState(false);

  // mutable copy of content (so edits don't re-render the whole tree)
  const [content, setContent] = useState<Record<string, ComfyWorkflowNode>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [sectionToggles, setSectionToggles] = useState<Map<string, boolean>>(new Map());
  function sectionOpen(key: string, defaultOpen: boolean): boolean {
    const t = sectionToggles.get(key);
    return t ?? defaultOpen;
  }
  function toggleSection(key: string, defaultOpen: boolean) {
    const current = sectionOpen(key, defaultOpen);
    const next = new Map(sectionToggles);
    next.set(key, !current);
    setSectionToggles(next);
  }

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const w = await workflowsApi.get(id);
        setWorkflow(w);
        setContent(structuredClone(w.content));
        setName(w.name);
        setDescription(w.description);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (!match || !id) return <p>Invalid route.</p>;
  if (loading) return <LoadingState label="Loading workflow..." />;
  if (!workflow)
    return (
      <div>
        <p>Workflow not found.</p>
        <Link href="/workflows">
          <Button variant="ghost" size="sm">
            <ArrowLeft size={14} /> Back
          </Button>
        </Link>
      </div>
    );

  const scalarRows = extractScalarInputs(content);
  const scalarGroups = groupScalarByClass(scalarRows);
  const loraRows = extractLoraLoaders(content);
  const totalEdits = scalarRows.length + loraRows.length;
  const promptCount = scalarRows.flatMap((r) => r.inputs).filter((r) => r.isPrompt).length;

  function setInputValue(nodeId: string, key: string, value: string | number | boolean) {
    setContent((c) => {
      const next = structuredClone(c);
      const node = next[nodeId];
      if (node?.inputs) (node.inputs as Record<string, unknown>)[key] = value;
      return next;
    });
  }

  function setAsPrompt(nodeId: string, key: string) {
    setContent((c) => {
      const next = structuredClone(c);
      // clear every other <PROMPT> first so only one injection point exists
      for (const n of Object.values(next)) {
        if (!n?.inputs || typeof n.inputs !== "object") continue;
        for (const [k, v] of Object.entries(n.inputs)) {
          if (v === "<PROMPT>") (n.inputs as Record<string, unknown>)[k] = "";
        }
      }
      const node = next[nodeId];
      if (node?.inputs) (node.inputs as Record<string, unknown>)[key] = "<PROMPT>";
      return next;
    });
  }

  function setLoraField(nodeId: string, key: string, field: "on" | "strength", value: boolean | number) {
    setContent((c) => {
      const next = structuredClone(c);
      const entry = (next[nodeId]?.inputs as Record<string, unknown> | undefined)?.[key];
      if (entry && typeof entry === "object") {
        (entry as Record<string, unknown>)[field] = value;
      }
      return next;
    });
  }

  async function saveContent() {
    if (!id) return;
    setSavingContent(true);
    await updateWorkflowContent(id, content);
    setSavingContent(false);
  }

  const uploadRef = useRef<HTMLInputElement>(null);
  async function onUploadJson(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Expected a JSON object of ComfyUI nodes.");
      setContent(parsed as Record<string, ComfyWorkflowNode>);
      const hasPrompt = Object.values(parsed as Record<string, unknown>).some((n) => {
        const node = n as { inputs?: Record<string, unknown> };
        return node?.inputs && Object.values(node.inputs).some((v) => v === "<PROMPT>");
      });
      if (hasPrompt) toast.show("Workflow JSON loaded. Click Save nodes to apply.", "success");
      else toast.warn("Loaded. No <PROMPT> placeholder found — set one before saving.");
    } catch (err) {
      toast.show(`Upload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      input.value = "";
    }
  }

  async function saveMeta() {
    if (!workflow || !id) return;
    await updateWorkflowMeta(id, { name, description });
    setWorkflow({ ...workflow, name, description });
  }

  return (
    <section>
      <div style={{ marginBottom: 8 }}>
        <Link href="/workflows">
          <Button variant="ghost" size="sm">
            <ArrowLeft size={14} /> Workflows
          </Button>
        </Link>
      </div>

      <div class="detail-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Field
            label="Name"
            name="name"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="Workflow name"
          />
        </div>
        <Button onClick={saveMeta} disabled={!name.trim()}>
          <Save size={14} /> Save name
        </Button>
      </div>
      <Field
        label="Description"
        name="description"
        value={description}
        onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
        placeholder="What this workflow is for"
      />

      <div class="workflow-editor">
        <div class="workflow-editor-header">
          <div>
            <h3 style={{ margin: 0 }}>Nodes</h3>
            <p class="field-hint" style={{ margin: "4px 0 0" }}>
              Edit any string, number, or boolean input inline. Arrays are node links and stay read-only. Changes apply on save.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={uploadRef}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => void onUploadJson(e)}
            />
            <Button variant="subtle" size="sm" onClick={() => uploadRef.current?.click()}>
              <Upload size={14} /> Upload JSON
            </Button>
            <Button onClick={saveContent} loading={savingContent} disabled={savingContent}>
              <Save size={14} /> Save nodes
            </Button>
          </div>
        </div>

        {totalEdits === 0 ? (
          <div class="empty-text-nodes">
            <p>No editable nodes in this workflow.</p>
            <p class="field-hint">
              Upload a ComfyUI workflow JSON to populate this workflow.
            </p>
          </div>
        ) : (
          <>
            {scalarGroups.length > 0 && (
              <>
                {/* prompt-status banner once for the whole scalar block */}
                <div class="workflow-prompt-banner">
                  {promptCount === 1 ? (
                    <span class="section-ok">
                      <CheckCircle2 size={12} /> Prompt node set.
                    </span>
                  ) : promptCount === 0 ? (
                    <span class="section-warn">
                      <AlertCircle size={12} /> No prompt node. Click "Use as prompt" on a text field.
                    </span>
                  ) : (
                    <span class="section-warn">{promptCount} prompt nodes (only the first is used).</span>
                  )}
                </div>
                {scalarGroups.map((group) => {
                  const secKey = `s:${group.classType}`;
                  const defOpen = group.hasPrompt;
                  const open = sectionOpen(secKey, defOpen);
                  return (
                    <div key={group.classType} class="workflow-section">
                      <button
                        type="button"
                        class="workflow-section-title collapsible"
                        onClick={() => toggleSection(secKey, defOpen)}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span class="scalar-class-name">{group.classType}</span>
                        <span class="section-count">{group.nodes.length} node{group.nodes.length === 1 ? "" : "s"}</span>
                        <span class="section-hint">{group.inputCount} input{group.inputCount === 1 ? "" : "s"}</span>
                        {group.hasPrompt && (
                          <span class="text-node-badge">PROMPT</span>
                        )}
                      </button>
                      {open && (
                        <div class="text-node-list">
                      {group.nodes.map((row) => (
                        <div key={row.nodeId} class={`text-node-row ${row.hasPrompt ? "is-prompt" : ""}`}>
                          <div class="text-node-meta">
                            <span class="text-node-id">#{row.nodeId}</span>
                            <span class="text-node-title">{row.nodeTitle}</span>
                            {row.hasPrompt && <span class="text-node-badge-muted">prompt</span>}
                          </div>
                          <div class="scalar-input-list">
                            {row.inputs.map((inp) => {
                              if (inp.type === "string") {
                                return (
                                  <div key={inp.key} class="scalar-input-row">
                                    <div class="scalar-input-head">
                                    <span class="scalar-input-key">{inp.key}</span>
                                      {!inp.isPrompt && (
                                        <Button variant="ghost" size="sm" onClick={() => setAsPrompt(row.nodeId, inp.key)}>
                                          Use as prompt
                                        </Button>
                                      )}
                                    </div>
                                    <TextArea
                                      label=""
                                      name={`${row.nodeId}-${inp.key}`}
                                      value={inp.value as string}
                                      onInput={(e) => setInputValue(row.nodeId, inp.key, (e.target as HTMLTextAreaElement).value)}
                                      rows={(inp.value as string).length > 80 ? 3 : 1}
                                      mono
                                    />
                                  </div>
                                );
                              }
                              if (inp.type === "boolean") {
                                return (
                                  <Toggle
                                    key={inp.key}
                                    label={inp.key}
                                    checked={inp.value as boolean}
                                    onChange={(v) => setInputValue(row.nodeId, inp.key, v)}
                                  />
                                );
                              }
                              return (
                                <Field
                                  key={inp.key}
                                  label={inp.key}
                                  name={`${row.nodeId}-${inp.key}`}
                                  type="number"
                                  step={inp.type === "int" ? "1" : "0.01"}
                                  value={String(inp.value)}
                                  onInput={(e) => {
                                    const n = Number((e.target as HTMLInputElement).value);
                                    if (Number.isFinite(n)) setInputValue(row.nodeId, inp.key, n);
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
              </>
            )}

            {loraRows.length > 0 && (() => {
              const secKey = "lora";
              const defOpen = true;
              const open = sectionOpen(secKey, defOpen);
              return (
              <div class="workflow-section">
                <button
                  type="button"
                  class="workflow-section-title collapsible"
                  onClick={() => toggleSection(secKey, defOpen)}
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Lora loaders <span class="section-count">{loraRows.length}</span>
                  <span class="section-hint">Toggle on/off and tune strength per lora.</span>
                </button>
                {open && (
                <div class="text-node-list">
                  {loraRows.map((row) => (
                    <div key={row.nodeId} class="text-node-row">
                      <div class="text-node-meta">
                        <span class="text-node-id">#{row.nodeId}</span>
                        <span class="text-node-title">{row.title}</span>
                        <span class="text-node-class">{row.classType}</span>
                        <span class="text-node-badge-muted">
                          {row.loras.length} lora{row.loras.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div class="lora-entry-list">
                        {row.loras.map((lora) => (
                          <div key={lora.key} class={`lora-entry ${lora.on ? "" : "is-off"}`}>
                            <Toggle
                              bare
                              checked={lora.on}
                              onChange={(v) => setLoraField(row.nodeId, lora.key, "on", v)}
                            />
                            <span class="lora-name" title={lora.name}>{lora.name}</span>
                            <input
                              type="range"
                              class="lora-slider"
                              min={-1}
                              max={2}
                              step={0.05}
                              value={lora.strength}
                              onInput={(e) =>
                                setLoraField(
                                  row.nodeId,
                                  lora.key,
                                  "strength",
                                  Number((e.target as HTMLInputElement).value),
                                )
                              }
                            />
                            <input
                              type="number"
                              class="field-input lora-strength-input"
                              step={0.05}
                              value={lora.strength}
                              onInput={(e) => {
                                const n = Number((e.target as HTMLInputElement).value);
                                if (Number.isFinite(n)) setLoraField(row.nodeId, lora.key, "strength", n);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
              );
            })()}
          </>
        )}
      </div>
    </section>
  );
}
