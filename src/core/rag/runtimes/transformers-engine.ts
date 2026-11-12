import { basename, dirname } from "node:path";
import type { Device, Dtype } from "../../types.ts";
import "./ort.ts";

export type Tensor = {
  type: string;
  dims: number[];
  data: ArrayLike<number>;
  to(type: string): Tensor;
  slice(...s: (number | null)[]): Tensor;
  normalize(p: number, dim: number): Tensor;
};
type Inputs = { input_ids: Tensor; attention_mask: Tensor };
export type Tokenizer = {
  (texts: string[], opts: object): Inputs;
  encode(text: string, opts?: object): number[];
  padding_side: string;
  model_max_length: number;
};
export type Model = (inputs: Inputs) => Promise<{ last_hidden_state?: Tensor; logits?: Tensor }>;
export type Loaded = {
  tokenizer: Tokenizer;
  model: Model;
  meanPooling(h: Tensor, mask: Tensor): Tensor;
  dispose(): Promise<void>;
};
export type Kind = "embedding" | "cross-encoder" | "yes-no-lm";
export type Threads = { intra: number; inter: number };

/** what an embedding needs to know of its model, as plain data: the core sends it to the embed worker */
export type EmbedSpec = {
  path: string;
  dtype?: Dtype;
  device: Exclude<Device, "gpu">;
  pooling: "cls" | "mean" | "last";
  normalize: boolean;
  maxInputTokens: number;
};

export const transformersIo = {
  import: () => import("@huggingface/transformers"),
};

export async function loadModel(
  path: string,
  kind: Kind,
  dtype: Dtype | undefined,
  device: Exclude<Device, "gpu">,
  threads?: Threads,
): Promise<Loaded> {
  const t = await transformersIo.import();
  // ponytail: transformers.js reads <localModelPath>/<org>/<name>; the folder is the installation, wherever it is
  const id = `${basename(dirname(path))}/${basename(path)}`;
  t.env.allowLocalModels = true;
  t.env.allowRemoteModels = false;
  t.env.localModelPath = dirname(dirname(path));
  t.env.cacheDir = dirname(dirname(path));
  const options = {
    dtype,
    device,
    ...(threads ? { session_options: { intraOpNumThreads: threads.intra, interOpNumThreads: threads.inter } } : {}),
  } as { dtype: "fp32"; device: "cpu" };
  const tokenizer = (await t.AutoTokenizer.from_pretrained(id)) as unknown as Tokenizer;
  // ponytail: the yes/no export of Qwen3-Reranker (onnx/model_yesno_*.onnx) returns the last position's [no, yes]
  // logits only, [batch, 2], instead of the whole vocabulary
  const model = (kind === "cross-encoder"
    ? await t.AutoModelForSequenceClassification.from_pretrained(id, options)
    : await t.AutoModel.from_pretrained(
        id,
        kind === "yes-no-lm" ? { ...options, model_file_name: "model_yesno" } : options,
      )) as unknown as Model & { dispose?: () => Promise<unknown> };
  return {
    tokenizer,
    model,
    meanPooling: t.mean_pooling as unknown as Loaded["meanPooling"],
    dispose: async () => {
      await model.dispose?.();
    },
  };
}

export function maxTokensOf(maxInputTokens: number, tokenizer: Tokenizer): number {
  return Math.min(maxInputTokens || Infinity, tokenizer.model_max_length || Infinity);
}

export function f32(t: Tensor): Tensor {
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

export class EmbedStopped extends Error {
  override name = "CancelledError";
}

// ponytail: the one embedding computation, in the core and in the embed worker alike — the same vectors either way;
// `stop` is asked between two batches, a run already given to onnxruntime goes to its end
export async function embedLoaded(
  loaded: Loaded,
  spec: EmbedSpec,
  inputs: string[],
  stop: () => boolean = () => false,
): Promise<{ vectors: Float32Array[]; tokens: number; maxTokens: number }> {
  const { tokenizer, model, meanPooling } = loaded;
  // ponytail: last-token pooling reads the last position; left padding puts every text's last token there
  if (spec.pooling === "last") tokenizer.padding_side = "left";
  const max = maxTokensOf(spec.maxInputTokens, tokenizer);
  const lengths = inputs.map((t) => Math.min(tokenizer.encode(t).length, max));
  const out: Float32Array[] = new Array(inputs.length);
  // ponytail: q8 models quantize activations per call, padding included, so a text's vector would depend on its
  // batch-mates (cos 0.93 measured on Qwen3 q8): dynamically quantized models embed one text per call
  const dynamic = ["q8", "int8", "uint8"].includes(spec.dtype ?? "");
  for (const idx of batches(lengths, dynamic ? 1 : BATCH_MAX)) {
    if (stop()) throw new EmbedStopped("Embedding cancelled.");
    const enc = tokenizer(
      idx.map((i) => inputs[i]),
      { padding: true, truncation: true, max_length: max },
    );
    const res = await model(enc);
    const hidden = f32(res.last_hidden_state ?? (res.logits as Tensor));
    let pooled =
      spec.pooling === "mean"
        ? meanPooling(hidden, enc.attention_mask)
        : spec.pooling === "last"
          ? hidden.slice(null, -1)
          : hidden.slice(null, 0);
    if (spec.normalize) pooled = pooled.normalize(2, -1);
    const d = pooled.dims[pooled.dims.length - 1];
    const data = pooled.data as Float32Array;
    idx.forEach((i, j) => {
      out[i] = Float32Array.from(data.subarray(j * d, (j + 1) * d));
    });
  }
  return { vectors: out, tokens: lengths.reduce((a, n) => a + n, 0), maxTokens: max };
}
