import { resolve } from "node:path";
import { semaphore } from "../../../shared/run/work.ts";
import { UserError } from "../../command.ts";
import { addTokens, currentOp, peakRssMB, perfFields, timeLoad } from "../../lib/models-perf.ts";
import { findModel } from "../../lib/models-store.ts";
import type { Device, Dtype, EmbedMode, ResolvedModel } from "../../types.ts";
import { instruction } from "../fingerprint.ts";
import {
  type EmbedSpec,
  embedLoaded,
  f32,
  type Kind,
  type Loaded,
  loadModel,
  maxTokensOf,
  type Tensor,
} from "./transformers-engine.ts";
import type { Runtime } from "./types.ts";

export { batches, transformersIo } from "./transformers-engine.ts";

const loading = semaphore(1);
const loaded = new Map<string, Promise<Loaded>>();

export function deviceOf(m: ResolvedModel): Exclude<Device, "gpu"> {
  return m.device === "gpu" ? "dml" : m.device;
}

export function dtypeOf(m: ResolvedModel): Dtype | undefined {
  const by = m.entry.dtypeByDevice ?? {};
  return m.dtype ?? by[deviceOf(m)] ?? by.cpu;
}

export function modelPath(m: ResolvedModel): string {
  if (m.install.path) return resolve(m.install.path);
  const repo = m.entry.source.hf?.repo;
  const hit = repo ? findModel(repo, dtypeOf(m)) : null;
  if (!hit)
    throw new UserError(
      `${m.entry.label} is not on this PC.`,
      `Install it from Settings › Models (testimus models pull ${m.entry.id}).`,
    );
  return resolve(hit.dir);
}

export function embedSpec(m: ResolvedModel): EmbedSpec {
  const dtype = dtypeOf(m);
  return {
    path: modelPath(m),
    ...(dtype ? { dtype } : {}),
    device: deviceOf(m),
    pooling: m.entry.pooling ?? "cls",
    normalize: m.entry.normalize ?? true,
    maxInputTokens: m.entry.maxInputTokens,
  };
}

export function embedInputs(m: ResolvedModel, texts: string[], mode: EmbedMode): string[] {
  const prefix = instruction(mode === "query" ? m.entry.queryInstruction : m.entry.docInstruction, m);
  return texts.map((t) => prefix + t);
}

function load(m: ResolvedModel, kind: Kind): Promise<Loaded> {
  const path = modelPath(m);
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

function maxTokens(m: ResolvedModel, tokenizer: Loaded["tokenizer"]): number {
  return maxTokensOf(m.entry.maxInputTokens, tokenizer);
}

async function embed(m: ResolvedModel, texts: string[], mode: EmbedMode): Promise<Float32Array[]> {
  const l = await load(m, "embedding");
  const { vectors, tokens } = await embedLoaded(l, embedSpec(m), embedInputs(m, texts, mode));
  addTokens(tokens);
  return vectors;
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
    if (!Number.isFinite(s))
      throw new UserError(
        `${m.entry.label} gave no yes/no score.`,
        "Check the model with testimus models verify, or choose another reranker.",
      );
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

// ponytail: transformers.js inside this process — the rerankers (a query's few candidates) and the tests; the
// embeddings of the app go through the embed worker (embed-process.ts), which runs this same computation
export const transformersRuntime: Runtime = { probe, embed, rerank };
