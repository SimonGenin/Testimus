import { describe, expect, it } from "vitest";
import { type AdviceInput, advise, changed, packVariantThatFits } from "../../../../src/core/lib/models-advice.ts";
import { catalog } from "../../../../src/core/lib/models-catalog.ts";
import type { MachineProfile, Pack, PerfLine } from "../../../../src/core/types.ts";

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB: 16303, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
};
const tiny: MachineProfile = { ...devPc, gpus: [], ramTotalMB: 900, ramFreeMB: 500 };
const budgets = { queryMs: 1000, indexPassagesPerSec: 5, headroom: 0.15 };

const ops = (op: PerfLine["op"], model: string, n: number, ms: number, extra: Partial<PerfLine> = {}): PerfLine[] =>
  Array.from({ length: n }, () => ({ at: "2026-11-02T10:00:00Z", op, model, device: "gpu", items: 1, ms, ...extra }));

const input = (over: Partial<AdviceInput>): AdviceInput => ({
  choice: { pack: "quality" },
  variant: { embedding: "qwen3-embedding-8b-q8", reranker: "qwen3-reranker-4b-q8" },
  machine: devPc,
  lines: [],
  budgets,
  ...over,
});
const packOf = (id: string) => catalog().packs.find((p) => p.id === id) as Pack;

describe("changed", () => {
  it("compares exactly when the dismissed number is not usable", () => {
    expect(changed("abc", 0)).toBe(true);
    expect(changed("0", 0)).toBe(false);
    expect(changed("0", 2)).toBe(true);
  });
});

describe("packVariantThatFits", () => {
  it("is null when no variant fits", () => {
    expect(packVariantThatFits(packOf("quality"), input({ machine: tiny }))).toBeNull();
  });
});

describe("advise — when nothing lighter fits", () => {
  const slow = ops("embed.query", "qwen3-embedding-8b-q8", 50, 3000);

  it("inside a pack: neither the lighter variants nor the lighter packs fit, so no advice", () => {
    expect(advise(input({ machine: tiny, lines: slow }))).toEqual([]);
  });

  it("a pack missing from the list is skipped", () => {
    expect(advise(input({ machine: tiny, lines: slow, packs: [packOf("quality")] }))).toEqual([]);
  });

  it("hand-picked models: no lighter one fits", () => {
    const variant = { embedding: "qwen3-embedding-8b-q8", reranker: null };
    expect(advise(input({ choice: { ...variant }, variant, machine: tiny, lines: slow }))).toEqual([]);
  });

  it("a model run out of memory several times is said with a count", () => {
    const lines: PerfLine[] = [1, 2].map(() => ({
      at: "2026-11-02T10:00:00Z",
      op: "model.load",
      model: "qwen3-reranker-4b-q8",
      items: 0,
      ms: 100,
      oom: true,
    }));
    const [a] = advise(input({ lines }));
    expect(a.reason).toMatch(/ran out of memory on this PC \(2 times in its last 50 operations\)/);
    expect(a.metric).toBe(2);
  });

  it("a lighter variant of a custom pack is named by its id when the catalog does not know it", () => {
    const packs: Pack[] = [
      {
        ...packOf("quality"),
        variants: [
          { embedding: "qwen3-embedding-8b-q8", reranker: "qwen3-reranker-4b-q8" },
          { embedding: "own-embedding", reranker: "own-reranker" },
        ],
      },
    ];
    const [a] = advise(input({ lines: slow, packs }));
    expect(a.reason).toMatch(/lighter variant \(own-embedding \+ own-reranker\)/);
  });
});

describe("advise — upgrades", () => {
  const fast = (model: string) => ops("embed.query", model, 50, 20);

  it("inside a pack: the heavier variant that fits", () => {
    const variant = { embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-0.6b-q8" };
    const [a] = advise(input({ variant, lines: fast(variant.embedding) }));
    expect(a.direction).toBe("upgrade");
    expect(a.reason).toMatch(/^Quality's heavier variant fits/);
  });

  it("no heavier variant nor pack fits, or the heavier pack is not listed: no upgrade", () => {
    const variant = { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null };
    const choice = { pack: "performance" };
    expect(advise(input({ choice, variant, machine: tiny, lines: fast(variant.embedding) }))).toEqual([]);
    expect(
      advise(input({ choice, variant, machine: tiny, lines: fast(variant.embedding), packs: [packOf("performance")] })),
    ).toEqual([]);
  });

  it("the busiest device of a model is the one judged", () => {
    const variant = { embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-0.6b-q8" };
    const lines = [...fast(variant.embedding), ...ops("embed.query", variant.embedding, 3, 5000, { device: "cpu" })];
    expect(advise(input({ variant, lines }))[0].direction).toBe("upgrade");
  });

  it("hand-picked models without a heavier one: no upgrade", () => {
    const variant = { embedding: "qwen3-embedding-8b-q8", reranker: null };
    expect(advise(input({ choice: { ...variant }, variant, lines: fast(variant.embedding) }))).toEqual([]);
  });
});
