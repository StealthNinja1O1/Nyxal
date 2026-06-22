// workflow detail. top: name + description editor. bottom: the text-node editor.
// walks every node, finds `inputs.text` fields, and lets you edit them inline.
// also flags which ones contain <PROMPT> (the injection point) and lets you
// mark a node as the prompt node.

import { useEffect, useState } from "preact/hooks";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { workflowsApi } from "../api/workflows";
import type { ComfyWorkflow, ComfyWorkflowNode } from "@shared/types";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { TextArea } from "../components/TextArea";
import { Toggle } from "../components/Toggle";
import { LoadingState } from "../components/State";
import { updateWorkflowMeta, updateWorkflowContent } from "../state/workflows";

interface TextNodeRow {
  nodeId: string;
  title: string;
  classType: string;
  text: string;
  isPrompt: boolean;
}

/** walk the workflow and extract every node with an `inputs.text` field. */
function extractTextNodes(content: Record<string, ComfyWorkflowNode>): TextNodeRow[] {
  const rows: TextNodeRow[] = [];
  for (const [nodeId, node] of Object.entries(content)) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    const text = (inputs as Record<string, unknown>).text;
    if (typeof text !== "string") continue;
    rows.push({
      nodeId,
      title: node?._meta?.title || nodeId,
      classType: node?.class_type || "(unknown)",
      text,
      isPrompt: text.trim() === "<PROMPT>",
    });
  }
  // prompt nodes first, then by title
  rows.sort((a, b) => {
    if (a.isPrompt !== b.isPrompt) return a.isPrompt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return rows;
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

interface PrimitiveRow {
  nodeId: string;
  title: string;
  classType: string;
  kind: "int" | "float" | "boolean";
  value: number | boolean;
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

/**
 * find PrimitiveInt / PrimitiveFloat / PrimitiveBoolean nodes with a scalar
 * `value` input. these are the comfy "quick switches" people wire up for
 * runtime tweaks.
 */
function extractPrimitives(content: Record<string, ComfyWorkflowNode>): PrimitiveRow[] {
  const rows: PrimitiveRow[] = [];
  for (const [nodeId, node] of Object.entries(content)) {
    const ct = node?.class_type;
    const v = (node?.inputs as Record<string, unknown> | undefined)?.value;
    const title = node?._meta?.title || nodeId;
    if (ct === "PrimitiveBoolean" && typeof v === "boolean") {
      rows.push({ nodeId, title, classType: ct, kind: "boolean", value: v });
    } else if (ct === "PrimitiveInt" && typeof v === "number" && Number.isFinite(v)) {
      rows.push({ nodeId, title, classType: ct, kind: "int", value: v });
    } else if (ct === "PrimitiveFloat" && typeof v === "number" && Number.isFinite(v)) {
      rows.push({ nodeId, title, classType: ct, kind: "float", value: v });
    }
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

  const textRows = extractTextNodes(content);
  const loraRows = extractLoraLoaders(content);
  const primitiveRows = extractPrimitives(content);
  const totalEdits = textRows.length + loraRows.length + primitiveRows.length;
  const promptCount = textRows.filter((r) => r.isPrompt).length;

  function setText(nodeId: string, value: string) {
    setContent((c) => {
      const next = structuredClone(c);
      const node = next[nodeId];
      if (node?.inputs) (node.inputs as Record<string, unknown>).text = value;
      return next;
    });
  }

  function setAsPrompt(nodeId: string) {
    setContent((c) => {
      const next = structuredClone(c);
      // clear any other prompt nodes first
      for (const n of Object.values(next)) {
        if (n?.inputs && (n.inputs as Record<string, unknown>).text === "<PROMPT>") {
          (n.inputs as Record<string, unknown>).text = "";
        }
      }
      const node = next[nodeId];
      if (node?.inputs) (node.inputs as Record<string, unknown>).text = "<PROMPT>";
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

  function setPrimitiveValue(nodeId: string, value: number | boolean) {
    setContent((c) => {
      const next = structuredClone(c);
      const node = next[nodeId];
      if (node?.inputs) (node.inputs as Record<string, unknown>).value = value;
      return next;
    });
  }

  async function saveContent() {
    if (!id) return;
    setSavingContent(true);
    await updateWorkflowContent(id, content);
    setSavingContent(false);
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
              Edit text, loras, and primitive values inline. Changes apply on save.
            </p>
          </div>
          <Button onClick={saveContent} loading={savingContent} disabled={savingContent}>
            <Save size={14} /> Save nodes
          </Button>
        </div>

        {totalEdits === 0 ? (
          <div class="empty-text-nodes">
            <p>No editable nodes in this workflow.</p>
            <p class="field-hint">
              Either upload a real ComfyUI workflow JSON, or this workflow has no text inputs, lora loaders, or primitives.
            </p>
          </div>
        ) : (
          <>
            {textRows.length > 0 && (
              <div class="workflow-section">
                <div class="workflow-section-title">
                  Text nodes <span class="section-count">{textRows.length}</span>
                  {promptCount === 1 ? (
                    <span class="section-ok">
                      <CheckCircle2 size={12} /> Prompt node set.
                    </span>
                  ) : promptCount === 0 ? (
                    <span class="section-warn">
                      <AlertCircle size={12} /> No prompt node. Click "Use as prompt" on one.
                    </span>
                  ) : (
                    <span class="section-warn">{promptCount} prompt nodes (only the first is used).</span>
                  )}
                </div>
                <div class="text-node-list">
                  {textRows.map((row) => (
                    <div key={row.nodeId} class={`text-node-row ${row.isPrompt ? "is-prompt" : ""}`}>
                      <div class="text-node-meta">
                        <span class="text-node-id">#{row.nodeId}</span>
                        <span class="text-node-title">{row.title}</span>
                        <span class="text-node-class">{row.classType}</span>
                        {row.isPrompt && <span class="text-node-badge">PROMPT</span>}
                      </div>
                      <TextArea
                        label=""
                        name={`text-${row.nodeId}`}
                        value={row.text}
                        onInput={(e) => setText(row.nodeId, (e.target as HTMLTextAreaElement).value)}
                        rows={row.text.length > 80 ? 3 : 1}
                        mono
                      />
                      {!row.isPrompt && (
                        <Button variant="ghost" size="sm" onClick={() => setAsPrompt(row.nodeId)}>
                          Use as prompt
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loraRows.length > 0 && (
              <div class="workflow-section">
                <div class="workflow-section-title">
                  Lora loaders <span class="section-count">{loraRows.length}</span>
                  <span class="section-hint">Toggle on/off and tune strength per lora.</span>
                </div>
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
              </div>
            )}

            {primitiveRows.length > 0 && (
              <div class="workflow-section">
                <div class="workflow-section-title">
                  Primitive values <span class="section-count">{primitiveRows.length}</span>
                  <span class="section-hint">Quick switches for ints, floats, and booleans.</span>
                </div>
                <div class="text-node-list">
                  {primitiveRows.map((row) => (
                    <div key={row.nodeId} class="text-node-row">
                      <div class="text-node-meta">
                        <span class="text-node-id">#{row.nodeId}</span>
                        <span class="text-node-title">{row.title}</span>
                        <span class="text-node-class">{row.classType}</span>
                      </div>
                      {row.kind === "boolean" ? (
                        <Toggle
                          label="Value"
                          checked={row.value as boolean}
                          onChange={(v) => setPrimitiveValue(row.nodeId, v)}
                        />
                      ) : (
                        <Field
                          label="Value"
                          name={`prim-${row.nodeId}`}
                          type="number"
                          step={row.kind === "int" ? "1" : "0.01"}
                          value={String(row.value)}
                          onInput={(e) => {
                            const n = Number((e.target as HTMLInputElement).value);
                            if (Number.isFinite(n)) setPrimitiveValue(row.nodeId, n);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
