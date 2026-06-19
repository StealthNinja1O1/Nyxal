import type { ComfyUiConfig } from "../../../shared/types";
import type { Logger } from "../utils/logger";

type Orientation = "portrait" | "square" | "landscape";

interface WorkflowNode {
  inputs: Record<string, any>;
  class_type?: string;
  _meta?: { title?: string };
  [key: string]: any;
}

export interface GenerateImageResult {
  buffer: Buffer;
  filename: string;
}

export async function generateImage(
  config: ComfyUiConfig,
  log: Logger,
  prompt: string,
  orientation: Orientation = "square",
  workflowTemplate: Record<string, unknown> | null = null,
): Promise<GenerateImageResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const { workflow, seed } = loadAndPrepareWorkflow(config, log, prompt, orientation, workflowTemplate);
  const promptId = await submitPrompt(baseUrl, workflow);
  log.info(`ComfyUI: Job ${promptId} submitted, waiting for completion...`);
  const output = await pollForCompletion(config, log, baseUrl, promptId);
  let buffer = await downloadImage(baseUrl, output);
  if (config.stripMetadata) buffer = stripPngTextChunks(buffer);
  if (seed != null) buffer = embedPngTextChunk(buffer, "seed", String(seed));
  log.info(`ComfyUI: Image ready (${(buffer.length / 1024).toFixed(0)}KB)`);
  return { buffer, filename: output.filename };
}

/** append a tEXt chunk (keyword + null + text, latin-1) right before IEND. used
 *  to re-embed the random seed after stripping the comfyui prompt/workflow. */
function embedPngTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 8 || !png.subarray(0, 8).equals(signature)) return png;

  // build the chunk data: "keyword\0text"
  const data = Buffer.alloc(keyword.length + 1 + text.length, 0);
  data.write(keyword, 0, "latin1");
  data.write(text, keyword.length + 1, "latin1");

  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); // length
  chunk.write("tEXt", 4, "ascii"); // type
  data.copy(chunk, 8); // data
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from("tEXt", "ascii"), data])), 8 + data.length); // crc

  // split at IEND (last 12 bytes: length=0, "IEND", crc) and insert before it
  const iend = png.subarray(png.length - 12);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, iend]);
}

// crc32 for png chunks. standard polynomial, table-driven.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function stripPngTextChunks(png: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 8 || !png.subarray(0, 8).equals(signature)) return png;

  const chunks: Buffer[] = [signature];
  let offset = 8;
  while (offset < png.length) {
    if (offset + 8 > png.length) break;
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 12 + length;
    if (type !== "tEXt") chunks.push(png.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }
  return Buffer.concat(chunks);
}

function loadAndPrepareWorkflow(
  config: ComfyUiConfig,
  log: Logger,
  prompt: string,
  orientation: Orientation,
  workflowTemplate: Record<string, unknown> | null,
): { workflow: Record<string, WorkflowNode>; seed: number | null } {
  if (!workflowTemplate || typeof workflowTemplate !== "object") {
    throw new Error("No comfyui workflow assigned to this bot. Assign one in the ComfyUI tab.");
  }
  const cloned = structuredClone(workflowTemplate) as Record<string, WorkflowNode>;

  const resolution = config.resolutions[orientation] ?? config.resolutions.square;
  let promptReplaced = false;
  let resolutionReplaced = false;
  const randomSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  let seedsReplaced = 0;

  for (const node of Object.values(cloned)) {
    if (!node.inputs || typeof node.inputs !== "object") continue;

    if (config.randomizeSeeds && "seed" in node.inputs) {
      node.inputs.seed = randomSeed;
      seedsReplaced++;
    }
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === "string" && value === "<PROMPT>") {
        node.inputs[key] = prompt;
        promptReplaced = true;
      }
    }
    if ("width" in node.inputs && "height" in node.inputs) {
      node.inputs.width = resolution[0];
      node.inputs.height = resolution[1];
      resolutionReplaced = true;
    }
  }

  if (!promptReplaced)
    throw new Error('No <PROMPT> placeholder found in workflow. Add a node with an input value of exactly "<PROMPT>".');
  if (seedsReplaced > 0) log.debug(`ComfyUI: Randomized ${seedsReplaced} seed(s) to ${randomSeed}`);
  if (!resolutionReplaced) log.warn("ComfyUI: No node with width/height inputs found, resolution not overridden");
  // only return the seed when we actually randomized or null so the caller knows there's nothing to embed.
  return { workflow: cloned, seed: seedsReplaced > 0 ? randomSeed : null };
}

async function submitPrompt(baseUrl: string, workflow: Record<string, WorkflowNode>): Promise<string> {
  const res = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ComfyUI submit failed: ${res.status} ${res.statusText}\n${errText}`);
  }
  const data = (await res.json()) as { prompt_id?: string; node_errors?: Record<string, any> };
  if (data.node_errors && Object.keys(data.node_errors).length > 0)
    throw new Error(`ComfyUI node errors: ${JSON.stringify(data.node_errors)}`);
  if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id");
  return data.prompt_id;
}

interface ImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

async function pollForCompletion(
  config: ComfyUiConfig,
  log: Logger,
  baseUrl: string,
  promptId: string,
): Promise<ImageOutput> {
  const timeoutMs = config.timeoutSeconds * 1000;
  const intervalMs = config.pollIntervalMs;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/history?max_items=64`);
    if (!res.ok) {
      log.warn(`ComfyUI: History poll failed (${res.status}), retrying...`);
      await Bun.sleep(intervalMs);
      continue;
    }
    const history = (await res.json()) as Record<string, any>;
    const entry = history[promptId];
    if (entry) {
      const status = entry.status;
      if (status?.status_str === "success" && status.completed) {
        const outputs: Record<string, any> = entry.outputs ?? {};
        for (const nodeOutput of Object.values(outputs)) {
          if (nodeOutput.images && Array.isArray(nodeOutput.images) && nodeOutput.images.length > 0)
            return nodeOutput.images[0] as ImageOutput;
        }
        throw new Error("ComfyUI job completed but no images found in output");
      }
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`ComfyUI timed out after ${config.timeoutSeconds}s waiting for job ${promptId}`);
}

async function downloadImage(baseUrl: string, output: ImageOutput): Promise<Buffer> {
  const params = new URLSearchParams({
    filename: output.filename,
    type: output.type,
    subfolder: output.subfolder,
    t: String(Date.now()),
  });
  const res = await fetch(`${baseUrl}/view?${params}`);
  if (!res.ok) throw new Error(`ComfyUI image download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}
