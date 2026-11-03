import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogEntry } from "../../../../src/core/lib/models-catalog.ts";
import { activeModels, setActiveChoice } from "../../../../src/core/rag/activation.ts";
import {
  transformersIo,
  transformersRuntime,
  YES_NO_SYSTEM,
  yesNoPrompt,
  yesProbability,
} from "../../../../src/core/rag/runtimes/transformers.ts";
import type { CatalogEntry, ResolvedModel } from "../../../../src/core/types.ts";

const installed = vi.hoisted(() => new Set<string>());

vi.mock("../../../../src/core/lib/models-resolve.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/models-resolve.ts")>();
  const { catalogEntry } = await import("../../../../src/core/lib/models-catalog.ts");
  const resolveInstalled = (id: string, queryTask = real.DEFAULT_QUERY_TASK) => {
    const entry = catalogEntry(id);
    if (!entry || !installed.has(entry.id)) return null;
    const runtime = entry.runtimes[0];
    return {
      entry,
      install: { model: entry.id, via: "path", runtime, path: `D:/models/${entry.id}`, status: "installed" },
      runtime,
      device: "cpu",
      dtype: entry.dtypeByDevice?.cpu,
      queryTask,
    };
  };
  return {
    ...real,
    resolveInstalled,
    resolveChoice: async (choice: unknown) => ({
      choice,
      variant: null,
      variantIndex: null,
      embedding: null,
      reranker: null,
      skipped: [],
      missing: [],
    }),
  };
});

const savedIo = { ...transformersIo };
const tmp = mkdtempSync(join(tmpdir(), "testimus-yesno-"));
let n = 0;

type Fake = { prompts: string[]; tokenizeOpts: object[]; loads: { kind: string; opts: unknown }[] };

function fake(maxLength = 0, logitsFor = (p: string): [number, number] => (p.includes("ANSWER") ? [1, 6] : [4, 1])) {
  const f: Fake = { prompts: [], tokenizeOpts: [], loads: [] };
  const tokenizer = Object.assign(
    (texts: string[], o: object) => {
      f.tokenizeOpts.push(o);
      return { input_ids: { dims: [texts.length, 3], texts }, attention_mask: { dims: [texts.length, 3] } };
    },
    { encode: (t: string) => t.split(/\s+/), padding_side: "right", model_max_length: maxLength },
  );
  const model = async (inputs: { input_ids: { texts: string[] } }) => {
    f.prompts.push(...inputs.input_ids.texts);
    const [no, yes] = logitsFor(inputs.input_ids.texts[0]);
    return { logits: { type: "float32", dims: [1, 2], data: Float32Array.from([no, yes]) } };
  };
  transformersIo.import = async () =>
    ({
      env: {},
      AutoTokenizer: { from_pretrained: async () => tokenizer },
      AutoModel: {
        from_pretrained: async (_id: string, opts: unknown) => {
          f.loads.push({ kind: "AutoModel", opts });
          return model;
        },
      },
      AutoModelForSequenceClassification: {
        from_pretrained: async (_id: string, opts: unknown) => {
          f.loads.push({ kind: "Seq", opts });
          return model;
        },
      },
      mean_pooling: () => null,
    }) as never;
  return f;
}

function yesNo(entry: Partial<CatalogEntry> = {}): ResolvedModel {
  const base = catalogEntry("qwen3-reranker-0.6b-onnx-q8") as CatalogEntry;
  return {
    entry: { ...base, ...entry },
    install: {
      model: base.id,
      via: "path",
      runtime: "transformers",
      path: join(tmp, "n24q02m", `r${++n}`),
      status: "installed",
    },
    runtime: "transformers",
    device: "cpu",
    queryTask: "Given a question about a railway simulator specification, retrieve the passages that answer it",
  } as ResolvedModel;
}

afterEach(() => {
  Object.assign(transformersIo, savedIo);
});

describe("Qwen3-Reranker yes/no on transformers.js", () => {
  it("builds the Qwen3-Reranker instruction template, the task in Instruct and an empty thinking block", () => {
    expect(yesNoPrompt("Find passages", "Quand ?", "Le DSO s'allume.")).toBe(
      `<|im_start|>system\n${YES_NO_SYSTEM}<|im_end|>\n` +
        "<|im_start|>user\n<Instruct>: Find passages\n<Query>: Quand ?\n<Document>: Le DSO s'allume.<|im_end|>\n" +
        "<|im_start|>assistant\n<think>\n\n</think>\n\n",
    );
    expect(YES_NO_SYSTEM).toBe(
      'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".',
    );
  });

  it("scores P(yes) as the softmax of the [no, yes] logits", () => {
    expect(yesProbability(0, 0)).toBeCloseTo(0.5);
    expect(yesProbability(14.784, 17.875)).toBeCloseTo(0.9565, 3);
    expect(yesProbability(11.838, 0.739)).toBeLessThan(0.0001);
    expect(yesProbability(1000, 0)).toBe(0);
  });

  it("loads the yes/no export, runs each pair alone and keeps the passages' order", async () => {
    const f = fake();
    const m = yesNo();
    const scores = await transformersRuntime.rerank(m, "Quand les DSO s'allument-ils ?", [
      "Le menu du sectionneur.",
      "ANSWER : les DSO s'allument.",
      "Une alerte de disjonction.",
    ]);
    expect(scores).toHaveLength(3);
    expect(scores[1]).toBeCloseTo(yesProbability(1, 6));
    expect(scores[0]).toBeCloseTo(yesProbability(4, 1));
    expect(scores[2]).toBe(scores[0]);
    expect(f.loads).toEqual([
      { kind: "AutoModel", opts: { dtype: "q8", device: "cpu", model_file_name: "model_yesno" } },
    ]);
    expect(f.prompts).toHaveLength(3);
    expect(f.prompts[1]).toBe(
      yesNoPrompt(m.queryTask, "Quand les DSO s'allument-ils ?", "ANSWER : les DSO s'allument."),
    );
    expect(f.tokenizeOpts.every((o) => (o as { padding: boolean }).padding === false)).toBe(true);
  });

  it("cuts a long document, never the end of the template the answer is read after", async () => {
    const f = fake(60);
    const long = Array.from({ length: 200 }, (_, i) => `mot${i}`).join(" ");
    await transformersRuntime.rerank(yesNo(), "Quand ?", [long]);
    const p = f.prompts[0];
    expect(p.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(p.endsWith("<|im_start|>assistant\n<think>\n\n</think>\n\n")).toBe(true);
    expect(p).toContain("<Document>: mot0 mot1");
    expect(p).not.toContain("mot199");
  });

  it("probes with a real score; another reranker kind is still refused", async () => {
    const f = fake(2048);
    expect(await transformersRuntime.probe(yesNo())).toEqual({ dims: 1, maxTokens: 2048 });
    expect(f.prompts).toHaveLength(1);
    await expect(transformersRuntime.rerank(yesNo({ rerankerKind: "http" }), "q", ["a"])).rejects.toThrow(
      /runs cross-encoders and yes\/no rerankers only/,
    );
  });
});

describe("activation keeps a yes-no-lm reranker", () => {
  const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "testimus-yesno-act-"));
    dir = join(root, "Projet");
    cpSync(FIXTURE, dir, { recursive: true });
    installed.clear();
  });

  afterEach(() => {
    setActiveChoice(dir, null);
    rmSync(root, { recursive: true, force: true });
  });

  it("uses the ONNX Qwen3 reranker of transformers.js instead of leaving it out", async () => {
    installed.add("bge-m3-q8");
    installed.add("qwen3-reranker-0.6b-onnx-q8");
    setActiveChoice(dir, { embedding: "bge-m3-q8", reranker: "qwen3-reranker-0.6b-onnx-q8" });
    const a = await activeModels(dir);
    expect(a.embedding?.entry.id).toBe("bge-m3-q8");
    expect(a.reranker?.entry.id).toBe("qwen3-reranker-0.6b-onnx-q8");
    expect(a.reranker?.runtime).toBe("transformers");
    expect(a.missing).toEqual([]);
  });
});
