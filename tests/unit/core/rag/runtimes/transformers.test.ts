import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogEntry } from "../../../../../src/core/lib/models-catalog.ts";
import { userModelsDir } from "../../../../../src/core/lib/models-store.ts";
import {
  batches,
  deviceOf,
  dtypeOf,
  transformersIo,
  transformersRuntime,
} from "../../../../../src/core/rag/runtimes/transformers.ts";
import type { CatalogEntry, ResolvedModel } from "../../../../../src/core/types.ts";

const savedIo = { ...transformersIo };
const tmp = mkdtempSync(join(tmpdir(), "testimus-cov-tf-"));
let n = 0;

afterEach(() => {
  Object.assign(transformersIo, savedIo);
});

type T = {
  type: string;
  dims: number[];
  data: Float32Array;
  to(t: string): T;
  slice(...s: (number | null)[]): T;
  normalize(): T;
};

const log: string[] = [];

function tensor(dims: number[], type = "float32", fill = 1): T {
  const t: T = {
    type,
    dims,
    data: new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(fill),
    to: (to) => {
      log.push(`to:${to}`);
      return tensor(dims, to, fill);
    },
    slice: (...s) => {
      log.push(`slice:${s.join(",")}`);
      return tensor([dims[0], dims[dims.length - 1]], type, fill);
    },
    normalize: () => {
      log.push("normalize");
      return t;
    },
  };
  return t;
}

type Fake = { hidden?: "logits" | "fp16"; maxLength?: number; calls: { kind: string; opts?: unknown }[] };

function fake(opts: Omit<Fake, "calls"> = {}): Fake {
  const f: Fake = { ...opts, calls: [] };
  const tokenizer = Object.assign(
    (texts: string[], o: object) => {
      f.calls.push({ kind: "tokenize", opts: { n: texts.length, ...o } });
      return {
        input_ids: tensor([texts.length, 4]),
        attention_mask: {
          ...tensor([texts.length, 4]),
          data: BigInt64Array.from(texts.flatMap(() => [1n, 1n, 1n, 0n])),
        },
      };
    },
    { encode: (t: string) => t.split(" "), padding_side: "right", model_max_length: opts.maxLength ?? 0 },
  );
  const embedModel = async (inputs: { input_ids: T }) => {
    const b = inputs.input_ids.dims[0];
    if (opts.hidden === "logits") return { logits: tensor([b, 4, 6]) };
    return { last_hidden_state: tensor([b, 4, 6], opts.hidden === "fp16" ? "float16" : "float32") };
  };
  const rerankModel = async (inputs: { input_ids: T }) => ({
    logits: tensor([inputs.input_ids.dims[0], 1], opts.hidden === "fp16" ? "float16" : "float32", 0),
  });
  transformersIo.import = async () =>
    ({
      env: {},
      AutoTokenizer: { from_pretrained: async () => tokenizer },
      AutoModel: {
        from_pretrained: async (_id: string, o: unknown) => {
          f.calls.push({ kind: "AutoModel", opts: o });
          return embedModel;
        },
      },
      AutoModelForSequenceClassification: {
        from_pretrained: async (_id: string, o: unknown) => {
          f.calls.push({ kind: "Seq", opts: o });
          return rerankModel;
        },
      },
      mean_pooling: (h: T) => {
        log.push("mean");
        return tensor([h.dims[0], h.dims[h.dims.length - 1]]);
      },
    }) as never;
  return f;
}

function model(id: string, entry: Partial<CatalogEntry> = {}, patch: Partial<ResolvedModel> = {}): ResolvedModel {
  const base = catalogEntry(id) as CatalogEntry;
  return {
    entry: { ...base, ...entry },
    install: {
      model: id,
      via: "path",
      runtime: "transformers",
      path: join(tmp, "org", `m${++n}`),
      status: "installed",
    },
    runtime: "transformers",
    device: "cpu",
    queryTask: "Find passages",
    ...patch,
  } as ResolvedModel;
}

describe("transformers.js runtime (fake pipeline)", () => {
  it("devices and dtypes: gpu runs on DirectML, the dtype falls back to the CPU one", () => {
    const m = model("bge-m3-q8");
    expect(deviceOf({ ...m, device: "gpu" })).toBe("dml");
    expect(deviceOf(m)).toBe("cpu");
    expect(dtypeOf({ ...m, dtype: "fp32" })).toBe("fp32");
    expect(dtypeOf({ ...m, entry: { ...m.entry, dtypeByDevice: { cpu: "q8" } }, device: "gpu" })).toBe("q8");
    expect(dtypeOf({ ...m, entry: { ...m.entry, dtypeByDevice: undefined } })).toBeUndefined();
  });

  it("mean pooling without normalisation, logits as hidden state, a float16 output converted", async () => {
    fake({ hidden: "logits", maxLength: 512 });
    log.length = 0;
    const m = model("bge-m3-q8", { pooling: "mean", normalize: false, dtypeByDevice: { cpu: "fp32" } });
    const out = await transformersRuntime.embed(m, ["a b", "c d e", "f"], "doc");
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(6);
    expect(log).toContain("mean");
    expect(log).not.toContain("normalize");
    fake({ hidden: "fp16" });
    log.length = 0;
    const cls = model("bge-m3-q8", { pooling: undefined, maxInputTokens: 0 });
    await transformersRuntime.embed(cls, ["x"], "query");
    expect(log).toEqual(["to:float32", "slice:,0", "normalize"]);
  });

  it("last-token pooling pads on the left", async () => {
    fake();
    log.length = 0;
    const m = model("qwen3-embedding-0.6b-onnx-q8", { normalize: undefined, dtypeByDevice: undefined });
    await transformersRuntime.embed(m, ["x y"], "query");
    expect(log).toEqual(["slice:,-1", "normalize"]);
  });

  it("reranks a cross-encoder in batches of 8 with sigmoid scores", async () => {
    const f = fake({ hidden: "fp16", maxLength: 4096 });
    const m = model("bge-reranker-v2-m3-q8", {}, { device: "gpu" });
    const scores = await transformersRuntime.rerank(
      m,
      "q",
      Array.from({ length: 10 }, (_, i) => `t${i}`),
    );
    expect(scores).toHaveLength(10);
    expect(scores[0]).toBeCloseTo(0.5);
    expect(f.calls.filter((c) => c.kind === "tokenize").map((c) => (c.opts as { n: number }).n)).toEqual([8, 2]);
    expect(f.calls.find((c) => c.kind === "Seq")?.opts).toEqual({ dtype: "q8", device: "dml" });
  });

  it("refuses a reranker it cannot run (neither a cross-encoder nor a yes/no model)", async () => {
    fake();
    const m = model("bge-reranker-v2-m3-q8", { rerankerKind: "http" });
    await expect(transformersRuntime.rerank(m, "q", ["a"])).rejects.toThrow(
      /runs cross-encoders and yes\/no rerankers only/,
    );
  });

  it("probes an embedding and a reranker", async () => {
    fake({ maxLength: 2048 });
    expect(await transformersRuntime.probe(model("bge-m3-q8"))).toEqual({ dims: 6, maxTokens: 2048 });
    expect(await transformersRuntime.probe(model("bge-reranker-v2-m3-q8"))).toEqual({ dims: 1, maxTokens: 1024 });
  });

  it("a load that fails is forgotten, so the next call loads again", async () => {
    let fail = true;
    const f = fake();
    const real = transformersIo.import;
    transformersIo.import = async () => {
      if (fail) throw new Error("broken");
      return real();
    };
    const m = model("bge-m3-q8");
    await expect(transformersRuntime.embed(m, ["x"], "doc")).rejects.toThrow(/broken/);
    fail = false;
    await new Promise((r) => setTimeout(r, 1));
    expect(await transformersRuntime.embed(m, ["x"], "doc")).toHaveLength(1);
    expect(f.calls.some((c) => c.kind === "AutoModel")).toBe(true);
  });

  it("finds an installed model by its repository when the installation has no path", async () => {
    fake();
    const repo = `acme/fake-emb-${Date.now()}`;
    const dir = join(userModelsDir(), ...repo.split("/"));
    mkdirSync(join(dir, "onnx"), { recursive: true });
    for (const f of ["config.json", "tokenizer.json", join("onnx", "model_quantized.onnx")])
      writeFileSync(join(dir, f), "{}");
    const base = model("bge-m3-q8");
    const m = {
      ...base,
      entry: { ...base.entry, source: { ...base.entry.source, hf: { ...base.entry.source.hf, repo } } },
      install: { ...base.install, path: undefined },
    } as ResolvedModel;
    expect(await transformersRuntime.embed(m, ["x"], "doc")).toHaveLength(1);
    const missing = {
      ...m,
      entry: { ...m.entry, source: { ...m.entry.source, hf: { ...m.entry.source.hf, repo: "nobody/nothing" } } },
    } as ResolvedModel;
    await expect(transformersRuntime.embed(missing, ["x"], "doc")).rejects.toThrow(/is not on this PC/);
    const noRepo = { ...m, entry: { ...m.entry, source: {} } } as ResolvedModel;
    await expect(transformersRuntime.embed(noRepo, ["x"], "doc")).rejects.toThrow(/is not on this PC/);
  });

  it("groups texts under a token budget", () => {
    expect(batches([10, 3000, 20, 5000])).toEqual([[0, 2], [1], [3]]);
    expect(batches([1, 1, 1], 1)).toEqual([[0], [1], [2]]);
  });

  it("the real import loads transformers.js without downloading anything", async () => {
    const t = (await savedIo.import()) as unknown as { AutoTokenizer: unknown };
    expect(t.AutoTokenizer).toBeDefined();
  }, 60000);
});
