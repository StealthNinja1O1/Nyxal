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
            <h3 style={{ margin: 0 }}>Text nodes</h3>
            <p class="field-hint" style={{ margin: "4px 0 0" }}>
              {textRows.length} text node{textRows.length === 1 ? "" : "s"} found.
              {" "}
              {promptCount === 1 ? (
                <span style={{ color: "var(--ok)" }}>
                  <CheckCircle2 size={12} style={{ verticalAlign: "middle" }} /> Prompt node set.
                </span>
              ) : promptCount === 0 ? (
                <span style={{ color: "var(--warn)" }}>
                  <AlertCircle size={12} style={{ verticalAlign: "middle" }} /> No prompt node. Click "Use as prompt" on one.
                </span>
              ) : (
                <span style={{ color: "var(--warn)" }}>{promptCount} prompt nodes (only the first is used).</span>
              )}
            </p>
          </div>
          <Button onClick={saveContent} loading={savingContent} disabled={savingContent}>
            <Save size={14} /> Save nodes
          </Button>
        </div>

        {textRows.length === 0 ? (
          <div class="empty-text-nodes">
            <p>No text nodes in this workflow.</p>
            <p class="field-hint">
              Either upload a real ComfyUI workflow JSON, or this workflow has no `text` inputs to edit.
            </p>
          </div>
        ) : (
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
        )}
      </div>
    </section>
  );
}
