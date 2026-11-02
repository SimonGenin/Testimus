import { basename, dirname, resolve } from "node:path";
import { UserError } from "../../command.ts";
import { gate } from "../../env.ts";
import { addTokens, currentOp, peakRssMB, perfFields, timeLoad } from "../../lib/models-perf.ts";
import { findModel } from "../../lib/models-store.ts";
import type { Device, Dtype, EmbedMode, ResolvedModel } from "../../types.ts";
import { instruction } from "../fingerprint.ts";
import type { Runtime } from "./types.ts";

type Tensor = {
  type: string;
  dims: number[];
  data: ArrayLike<number>;
  to(type: string): Tensor;
  slice(...s: (number | null)[]): Tensor;
  normalize(p: number, dim: number): Tensor;
};
type Inputs = { input_ids: Tensor; attention_mask: Tensor };
type Tokenizer = {
  (texts: string[], opts: object): Inputs;
  encode(text: string, opts?: object): number[];
  padding_side: string;
  model_max_length: number;
};
type Model = (inputs: Inputs) => Promise<{ last_hidden_state?: Tensor; logits?: Tensor }>;
type Loaded = { tokenizer: Tokenizer; model: Model; meanPooling(h: Tensor, mask: Tensor): Tensor };
type Kind = "embedding" | "cross-encoder" | "yes-no-lm";

const loading = gate(1);
const loaded = new Map<string, Promise<Loaded>>();

export function deviceOf(m: ResolvedModel): Exclude<Device, "gpu"> {
  return m.device === "gpu" ? "dml" : m.device;
}

export function dtypeOf(m: ResolvedModel): Dtype | undefined {
  const by = m.entry.dtypeByDevice ?? {};
  return m.dtype ?? by[deviceOf(m)] ?? by.cpu;
}

function modelPath(m: ResolvedModel): string {
  if (m.install.path) return m.install.path;
  const repo = m.entry.source.hf?.repo;
  const hit = repo ? findModel(repo, dtypeOf(m)) : null;
  if (!hit)
    throw new UserError(
      `${m.entry.label} is not on this PC.`,
      `Install it from Settings › Models (testimus models pull ${m.entry.id}).`,
    );
  return hit.dir;
}

function load(m: ResolvedModel, kind: Kind): Promise<Loaded> {
  const path = resolve(modelPath(m));
  const device = deviceOf(m);
  const dtype = dtypeOf(m);
  const key = [m.entry.id, path, device, dtype].join("|");
  let p = loaded.get(key);
  if (!p) {
    const target = currentOp();
    p = loading(() =>
      timeLoad(
        perfFields(m),
        () => loadModel(path, kind, dtype, device),
        () => ({ peakRssMB: peakRssMB() }),
        target,
      ),
    );
    p.catch(() => loaded.delete(key));
    loaded.set(key, p);
  }
  return p;
}

export const transformersIo = {
  import: () => import("@huggingface/transformers"),
};

async function loadModel(
  path: string,
  kind: Kind,
  dtype: Dtype | undefined,
  device: Exclude<Device, "gpu">,
): Promise<Loaded> {
  const t = await transformersIo.import();
  // ponytail: transformers.js reads <localModelPath>/<org>/<name>; the folder is the installation, wherever it is
  const id = `${basename(dirname(path))}/${basename(path)}`;
  t.env.allowLocalModels = true;
  t.env.allowRemoteModels = false;
  t.env.localModelPath = dirname(dirname(path));
  t.env.cacheDir = dirname(dirname(path));
  const options = { dtype, device } as { dtype: "fp32"; device: "cpu" };
  const tokenizer = (await t.AutoTokenizer.from_pretrained(id)) as unknown as Tokenizer;
  // ponytail: the yes/no export of Qwen3-Reranker (onnx/model_yesno_*.onnx) returns the last position's [no, yes]
  // logits only, [batch, 2], instead of the whole vocabulary
  const model = (kind === "cross-encoder"
    ? await t.AutoModelForSequenceClassification.from_pretrained(id, options)
    : await t.AutoModel.from_pretrained(
        id,
        kind === "yes-no-lm" ? { ...options, model_file_name: "model_yesno" } : options,
      )) as unknown as Model;
  return { tokenizer, model, meanPooling: t.mean_pooling as unknown as Loaded["meanPooling"] };
}

function maxTokens(m: ResolvedModel, tokenizer: Tokenizer): number {
  return Math.min(m.entry.maxInputTokens || Infinity, tokenizer.model_max_length || Infinity);
}

function f32(t: Tensor): Tensor {
  return t.type === "float32" ? t : t.to("float32");
}

// ponytail: a batch is padded to its longest text and attention grows with its square; texts are sorted by token
// length and grouped under a token budget, so a long section is embedded alone
const BATCH_TOKENS = 4096;
const BATCH_MAX = 8;

export function batches(lengths: number[], most = BATCH_MAX): number[][] {
  const order = lengths.map((_, i) => i).sort((a, b) => lengths[a] - lengths[b]);
  const out: number[][] = [];
  let cur: number[] = [];
  for (const i of order) {
    if (cur.length && (cur.length >= most || (cur.length + 1) * lengths[i] > BATCH_TOKENS)) {
      out.push(cur);
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length) out.push(cur);
  return out;
}

async function embed(m: ResolvedModel, texts: string[], mode: EmbedMode): Promise<Float32Array[]> {
  const { tokenizer, model, meanPooling } = await load(m, "embedding");
  const pooling = m.entry.pooling ?? "cls";
  // ponytail: last-token pooling reads the last position; left padding puts every text's last token there
  if (pooling === "last") tokenizer.padding_side = "left";
  const prefix = instruction(mode === "query" ? m.entry.queryInstruction : m.entry.docInstruction, m);
  const inputs = texts.map((t) => prefix + t);
  const max = maxTokens(m, tokenizer);
  const lengths = inputs.map((t) => Math.min(tokenizer.encode(t).length, max));
  addTokens(lengths.reduce((a, n) => a + n, 0));
  const out: Float32Array[] = new Array(inputs.length);
  // ponytail: q8 models quantize activations per call, padding included, so a text's vector would depend on its
  // batch-mates (cos 0.93 measured on Qwen3 q8): dynamically quantized models embed one text per call
  const dynamic = ["q8", "int8", "uint8"].includes(dtypeOf(m) ?? "");
  for (const idx of batches(lengths, dynamic ? 1 : BATCH_MAX)) {
    const enc = tokenizer(
      idx.map((i) => inputs[i]),
      { padding: true, truncation: true, max_length: max },
    );
    const res = await model(enc);
    const hidden = f32(res.last_hidden_state ?? (res.logits as Tensor));
    let pooled =
      pooling === "mean"
        ? meanPooling(hidden, enc.attention_mask)
        : pooling === "last"
          ? hidden.slice(null, -1)
          : hidden.slice(null, 0);
    if (m.entry.normalize ?? true) pooled = pooled.normalize(2, -1);
    const d = pooled.dims[pooled.dims.length - 1];
    const data = pooled.data as Float32Array;
    idx.forEach((i, j) => {
      out[i] = Float32Array.from(data.subarray(j * d, (j + 1) * d));
    });
  }
  return out;
}

export const YES_NO_SYSTEM =
  'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".';

export function yesNoPrompt(task: string, query: string, doc: string): string {
  return [
    `<|im_start|>system\n${YES_NO_SYSTEM}<|im_end|>\n`,
    `<|im_start|>user\n<Instruct>: ${task}\n<Query>: ${query}\n<Document>: ${doc}<|im_end|>\n`,
    "<|im_start|>assistant\n<think>\n\n</think>\n\n",
  ].join("");
}

export function yesProbability(no: number, yes: number): number {
  return 1 / (1 + Math.exp(no - yes));
}

// ponytail: the answer is read at the last position, so the document is cut, never the template's end; the yes/no
// export takes no position ids (left padding would shift them) and is q8 (activations quantized per call), so
// each pair runs alone
async function rerankYesNo(m: ResolvedModel, query: string, texts: string[]): Promise<number[]> {
  const { tokenizer, model } = await load(m, "yes-no-lm");
  const max = maxTokens(m, tokenizer);
  const count = (t: string) => tokenizer.encode(t, { add_special_tokens: false }).length;
  const scores: number[] = [];
  for (const text of texts) {
    let doc = text;
    let prompt = yesNoPrompt(m.queryTask, query, doc);
    let n = count(prompt);
    while (n > max && doc) {
      const fixed = count(yesNoPrompt(m.queryTask, query, ""));
      doc = doc.slice(0, Math.max(0, Math.floor((doc.length * (max - fixed)) / Math.max(1, n - fixed)) - 1));
      prompt = yesNoPrompt(m.queryTask, query, doc);
      n = count(prompt);
    }
    addTokens(n);
    const { logits } = await model(tokenizer([prompt], { padding: false, add_special_tokens: false }));
    const [no, yes] = Array.from(f32(logits as Tensor).data);
    scores.push(yesProbability(no, yes));
  }
  return scores;
}

async function rerank(m: ResolvedModel, query: string, texts: string[]): Promise<number[]> {
  if (m.entry.rerankerKind === "yes-no-lm") return rerankYesNo(m, query, texts);
  if (m.entry.rerankerKind && m.entry.rerankerKind !== "cross-encoder")
    throw new UserError(
      `${m.entry.label} is a ${m.entry.rerankerKind} reranker; transformers.js runs cross-encoders and yes/no rerankers only.`,
      "Choose another reranker in Settings › Models.",
    );
  const { tokenizer, model } = await load(m, "cross-encoder");
  const max = maxTokens(m, tokenizer);
  const scores: number[] = [];
  for (let i = 0; i < texts.length; i += 8) {
    const batch = texts.slice(i, i + 8);
    const enc = tokenizer(
      batch.map(() => query),
      { text_pair: batch, padding: true, truncation: true, max_length: max },
    );
    addTokens(
      Array.from(enc.attention_mask.data as ArrayLike<number | bigint>).reduce<number>((a, x) => a + Number(x), 0),
    );
    const { logits } = await model(enc);
    for (const v of Array.from(f32(logits as Tensor).data)) scores.push(1 / (1 + Math.exp(-v)));
  }
  return scores;
}

async function probe(m: ResolvedModel): Promise<{ dims: number; maxTokens: number }> {
  if (m.entry.kind === "reranker" && m.entry.rerankerKind === "yes-no-lm") {
    const [s] = await rerankYesNo(m, "probe", ["Testimus probe sentence."]);
    if (!Number.isFinite(s)) throw new UserError(`${m.entry.label} gave no yes/no score.`);
    const { tokenizer } = await load(m, "yes-no-lm");
    return { dims: 1, maxTokens: maxTokens(m, tokenizer) };
  }
  if (m.entry.kind === "reranker") {
    const { tokenizer } = await load(m, "cross-encoder");
    return { dims: 1, maxTokens: maxTokens(m, tokenizer) };
  }
  const [v] = await embed(m, ["probe"], "doc");
  const { tokenizer } = await load(m, "embedding");
  return { dims: v.length, maxTokens: maxTokens(m, tokenizer) };
}

export const transformersRuntime: Runtime = { probe, embed, rerank };
