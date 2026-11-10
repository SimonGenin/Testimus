import { describe, expect, it } from "vitest";
import { BOTH_ON_PROCESSOR, oneByOne } from "../../../../src/core/lib/models-advised.ts";
import { catalogEntry } from "../../../../src/core/lib/models-catalog.ts";
import { suggestedVariant, suggestPack } from "../../../../src/core/lib/models-packs.ts";
import type { CatalogEntry, MachineProfile } from "../../../../src/core/types.ts";

const e = (id: string) => catalogEntry(id) as CatalogEntry;

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "Intel Core Ultra 9 285K", threads: 24 },
  gpus: [
    {
      name: "NVIDIA GeForce RTX 5080",
      vendor: "nvidia",
      driver: "591.44",
      vramTotalMB: 16303,
      vramUsedMB: 2490,
      source: "nvidia-smi",
    },
  ],
  drives: [],
  loaded: [],
};
const cpuLaptop: MachineProfile = { ...devPc, gpus: [], ramTotalMB: 16000, ramFreeMB: 8000 };
const smallCard: MachineProfile = {
  ...devPc,
  gpus: [{ ...devPc.gpus[0], name: "NVIDIA GeForce RTX 3050", vramTotalMB: 6144, vramUsedMB: 300 }],
};

describe("the search models one by one (Settings › Models)", () => {
  it("the variant behind the pack proposed is the one its models are advised from; Light when nothing is known", () => {
    expect(suggestedVariant(devPc)).toEqual({
      pack: "quality",
      variant: { embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" },
    });
    expect(suggestedVariant(devPc).pack).toBe(suggestPack(devPc));
    expect(suggestedVariant(null)).toEqual({ pack: "light", variant: { embedding: "bge-m3-q8", reranker: null } });
    expect(suggestedVariant(cpuLaptop).variant).toEqual({ embedding: "bge-m3-q8", reranker: null });
  });

  it("the embedding and the reranker of that variant are advised, each with why in numbers; the others are not", () => {
    const judge = oneByOne(devPc, null);
    const emb = judge(e("qwen3-embedding-8b-q4"));
    expect(emb).toMatchObject({ advised: true, pair: null, aside: null });
    expect(emb.reason).toMatch(/^Fits: Qwen3 Embedding 8B \(4-bit\) needs about [\d.]+ GB; the GPU has/);
    const rr = judge(e("qwen3-reranker-4b-q8"));
    expect(rr.advised).toBe(true);
    expect(rr.reason).toMatch(/Qwen3 Embedding 8B \(4-bit\) \+ Qwen3 Reranker 4B \(8-bit, GGUF\) need about/);
    expect(judge(e("bge-m3-q8"))).toEqual({ advised: false, reason: null, pair: null, aside: null });
    expect(judge(e("qwen3-reranker-0.6b-q8"))).toEqual({ advised: false, reason: null, pair: null, aside: null });
    expect(judge(e("whisper-small-q8"))).toEqual({ advised: false, reason: null, pair: null, aside: null });
  });

  it("no reranker is advised beside an embedding on the processor", () => {
    const judge = oneByOne(cpuLaptop, null);
    expect(judge(e("bge-m3-q8")).advised).toBe(true);
    expect(judge(e("bge-m3-q8")).reason).toMatch(/^Fits on the processor/);
    for (const id of ["bge-reranker-v2-m3-q8", "qwen3-reranker-0.6b-onnx-q8", "qwen3-reranker-0.6b-q8"])
      expect(judge(e(id)).advised).toBe(false);
  });

  it("each reranker is judged beside the embedding in use: they share the card", () => {
    const judge = oneByOne(smallCard, "qwen3-embedding-0.6b-q8");
    const small = judge(e("qwen3-reranker-0.6b-q8")).pair;
    expect(small?.message).toMatch(/Qwen3 Embedding 0\.6B \(8-bit, GGUF\) \+ Qwen3 Reranker 0\.6B \(8-bit, GGUF\)/);
    expect(small?.verdict).toBe("fits");
    const big = judge(e("qwen3-reranker-8b-q8")).pair;
    expect(big?.verdict).toBe("gpu-too-small");
    expect(judge(e("qwen3-reranker-8b-q8")).aside).toBeNull();
    expect(judge(e("qwen3-embedding-4b-q4")).pair).toBeNull();
  });

  it("a reranker on the processor is not offered while the embedding runs on the processor", () => {
    const onCpu = oneByOne(devPc, "bge-m3-q8");
    expect(onCpu(e("bge-reranker-v2-m3-q8")).aside).toBe(BOTH_ON_PROCESSOR);
    expect(onCpu(e("qwen3-reranker-0.6b-q8")).aside).toBeNull();
    expect(oneByOne(devPc, "qwen3-embedding-4b-q4")(e("bge-reranker-v2-m3-q8")).aside).toBeNull();
    const laptop = oneByOne(cpuLaptop, "bge-m3-q8");
    for (const id of ["bge-reranker-v2-m3-q8", "qwen3-reranker-0.6b-q8", "qwen3-reranker-8b-q8"])
      expect(laptop(e(id)).aside).toBe(BOTH_ON_PROCESSOR);
  });
});
