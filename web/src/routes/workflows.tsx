import { useEffect, useRef, useState } from "preact/hooks";
import { Workflow as WorkflowIcon, Plus, Pencil, Trash2, Upload } from "lucide-react";
import { Link } from "wouter";
import {
  workflows,
  workflowsLoading,
  loadWorkflows,
  createWorkflow,
  deleteWorkflow,
} from "../state/workflows";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { LoadingState, EmptyState } from "../components/State";
import { toast } from "../state/toast";
import { tryParseJson } from "../lib/importers";

export function WorkflowsRoute() {
  useEffect(() => {
    void loadWorkflows();
  }, []);

  return (
    <section>
      <div class="list-card">
        <div class="list-header">
          <h2>
            ComfyUI Workflows <span class="count-pill">{workflows.value.length}</span>
          </h2>
          <CreateButtons />
        </div>

        {workflowsLoading.value ? (
          <LoadingState label="Loading workflows..." />
        ) : workflows.value.length === 0 ? (
          <EmptyState
            icon={<WorkflowIcon size={32} />}
            title="No workflows yet"
            subtitle="Upload a ComfyUI workflow JSON. It needs at least one text node containing <PROMPT> - that's where the bot's prompt gets injected."
            action={<CreateButtons />}
          />
        ) : (
          <div>
            {workflows.value.map((w) => (
              <WorkflowRow key={w.id} workflow={w} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CreateButtons() {
  const [nameOpen, setNameOpen] = useState(false);
  const [uploadState, setUploadState] = useState<{
    content: Record<string, unknown>;
    filename: string;
    hasPrompt: boolean;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = tryParseJson(text);
      if (!parsed.ok) throw new Error(`Not valid JSON: ${parsed.error}`);
      const obj = parsed.value as Record<string, unknown>;
      if (!obj || typeof obj !== "object") throw new Error("Expected a JSON object of nodes.");

      const hasPrompt = Object.values(obj).some((n) => {
        const node = n as { inputs?: Record<string, unknown> };
        return node?.inputs && Object.values(node.inputs).some((v) => v === "<PROMPT>");
      });
      if (!hasPrompt) {
        toast.warn("No <PROMPT> placeholder found. You can set one in the editor afterwards.");
      }
      setUploadState({ content: obj, filename: file.name.replace(/\.json$/i, ""), hasPrompt });
    } catch (err) {
      toast.show(`Upload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      input.value = "";
    }
  }

  async function finishUpload(name: string) {
    if (!uploadState) return;
    const id = await createWorkflow({ name, content: uploadState.content });
    if (id) {
      setUploadState(null);
      window.location.assign(`/workflows/${id}`);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => void onUpload(e)}
      />
      <Button variant="subtle" size="sm" onClick={() => fileRef.current?.click()}>
        <Upload size={15} />
        Upload JSON
      </Button>
      <Button size="sm" onClick={() => setNameOpen(true)}>
        <Plus size={15} />
        New workflow
      </Button>
      {nameOpen && <CreateBlankModal onClose={() => setNameOpen(false)} />}
      {uploadState && (
        <NameUploadModal
          defaultName={uploadState.filename}
          hasPrompt={uploadState.hasPrompt}
          onCancel={() => setUploadState(null)}
          onSubmit={finishUpload}
        />
      )}
    </div>
  );
}

function NameUploadModal({
  defaultName,
  hasPrompt,
  onCancel,
  onSubmit,
}: {
  defaultName: string;
  hasPrompt: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open
      size="md"
      title="Name this workflow"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!name.trim()) return;
              setSaving(true);
              await onSubmit(name.trim());
              setSaving(false);
            }}
            loading={saving}
            disabled={saving || !name.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <Field
        label="Name"
        name="name"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        autoFocus
      />
      {!hasPrompt && (
        <p class="field-hint" style={{ color: "var(--warn)" }}>
          No <code>&lt;PROMPT&gt;</code> placeholder found. You can set one in the editor afterwards.
        </p>
      )}
    </Modal>
  );
}

function CreateBlankModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const id = await createWorkflow({
      name: name.trim(),
      description: description.trim(),
      content: {},
    });
    setSaving(false);
    if (id) onClose();
  }

  return (
    <Modal
      open
      size="md"
      title="New workflow"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="wf-create-form" loading={saving} disabled={saving}>Create</Button>
        </>
      }
    >
      <form id="wf-create-form" onSubmit={submit}>
        <Field
          label="Name"
          name="name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Anime landscape"
          autoFocus
        />
        <Field
          label="Description (optional)"
          name="description"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          placeholder="What this workflow is for"
        />
        <p class="field-hint">
          You'll get an empty workflow. Upload a ComfyUI JSON afterwards, or paste nodes into the editor.
        </p>
      </form>
    </Modal>
  );
}

function WorkflowRow({ workflow }: { workflow: (typeof workflows.value)[number] }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div class="list-row-wrap">
      <div class="list-row">
        <div class="list-row-main">
          <div class="list-row-title-line">
            <span class="list-row-title">{workflow.name}</span>
          </div>
          {workflow.description && (
            <div class="entry-preview">{workflow.description}</div>
          )}
        </div>
        <div class="list-row-actions">
          <Link href={`/workflows/${workflow.id}`}>
            <Button variant="subtle" size="sm">
              <Pencil size={14} />
              Edit
            </Button>
          </Link>
          <Button variant="danger" size="sm" onClick={() => setConfirmDel(true)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {confirmDel && (
        <Modal
          open
          title={`Delete "${workflow.name}"?`}
          onClose={() => setConfirmDel(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
              <Button variant="danger" onClick={async () => { if (await deleteWorkflow(workflow.id)) setConfirmDel(false); }}>
                <Trash2 size={15} /> Delete
              </Button>
            </>
          }
        >
          <p>Bots using this workflow will have it unassigned (set to none). The workflow JSON is lost.</p>
        </Modal>
      )}
    </div>
  );
}
