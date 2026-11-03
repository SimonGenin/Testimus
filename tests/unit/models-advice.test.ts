import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AdviceInput, adviceId, advise, changed, NOT_MEASURED } from "../../src/core/lib/models-advice.ts";
import type { PerfRecord } from "../../src/core/lib/models-perf.ts";
import type { Measured } from "../../src/core/lib/models-quality.ts";
import type { EvalReport } from "../../src/core/rag/eval.ts";
import type { MachineProfile, PerfLine } from "../../src/core/types.ts";

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
const budgets = { queryMs: 1000, indexPassagesPerSec: 5, headroom: 0.15 };

function ops(op: PerfLine["op"], model: string, n: number, ms: number, extra: Partial<PerfLine> = {}): PerfLine[] {
  return Array.from({ length: n }, () => ({
    at: "2026-11-02T10:00:00Z",
    op,
    model,
    device: "gpu",
    items: 1,
    ms,
    ...extra,
  }));
}

const input = (over: Partial<AdviceInput>): AdviceInput => ({
  choice: { pack: "quality" },
  variant: { embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" },
  machine: devPc,
  lines: [],
  budgets,
  ...over,
});

describe("advice (§7.10)", () => {
  it("no timings, no advice", () => {
    expect(advise(input({}))).toEqual([]);
  });

  it("downgrade inside the pack first: the next variant that fits", () => {
    const lines = [
      ...ops("embed.query", "qwen3-embedding-8b-q4", 50, 2000),
      ...ops("rerank", "qwen3-reranker-4b-q8", 50, 400),
    ];
    const [a] = advise(input({ lines }));
    expect(a.direction).toBe("downgrade");
    expect(a.to).toEqual({ embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-4b-q8" });
    expect(a.reason).toMatch(/Quality's lighter variant .*queries take 2\.4 s at p95 here \(budget 1\.0 s\)/);
    expect(a.quality).toMatch(/quality difference not measured/);
    expect(a.id).toBe(adviceId("downgrade", { pack: "quality" }, a.to));
  });

  it("then the next lighter pack (Quality → Balanced …)", () => {
    const variant = { embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-0.6b-q8" };
    const lines = ops("embed.query", variant.embedding, 50, 1500);
    const [a] = advise(input({ variant, lines }));
    expect(a.to).toEqual({ pack: "balanced" });
    expect(a.reason).toMatch(/^Move to Balanced/);
  });

  it("hand-picked models walk the lighter chain, first one that fits", () => {
    const variant = { embedding: "qwen3-embedding-8b-q8", reranker: null };
    const lines = ops("embed.index", variant.embedding, 10, 1000, { items: 2 });
    const [a] = advise(input({ choice: { embedding: variant.embedding, reranker: null }, variant, lines }));
    expect(a.to).toEqual({ embedding: "qwen3-embedding-8b-q4", reranker: null });
    expect(a.reason).toMatch(/indexing runs at 2 passages\/s here \(budget 5 passages\/s\)/);
  });

  it("a model partly on the processor is a reason to go lighter", () => {
    const variant = { embedding: "qwen3-embedding-8b-q8", reranker: null };
    const lines = ops("embed.query", variant.embedding, 3, 300, { partialOffload: true });
    const [a] = advise(input({ choice: { embedding: variant.embedding, reranker: null }, variant, lines }));
    expect(a.direction).toBe("downgrade");
    expect(a.reason).toMatch(/ran partly on the processor/);
  });

  it("upgrade when p95 stays under 20 % of the budget over 50 operations and the heavier one fits", () => {
    const light = { choice: { pack: "light" }, variant: { embedding: "bge-m3-q8", reranker: null } };
    expect(advise(input({ ...light, lines: ops("embed.query", "bge-m3-q8", 49, 50) }))).toEqual([]);
    const [a] = advise(input({ ...light, lines: ops("embed.query", "bge-m3-q8", 50, 50) }));
    expect(a.direction).toBe("upgrade");
    expect(a.to).toEqual({ pack: "performance" });
    expect(a.reason).toMatch(/under 20 % of the 1\.0 s budget/);
    const custom = {
      choice: { embedding: "qwen3-embedding-4b-q4", reranker: null },
      variant: { embedding: "qwen3-embedding-4b-q4", reranker: null },
    };
    const [b] = advise(input({ ...custom, lines: ops("embed.query", "qwen3-embedding-4b-q4", 60, 30) }));
    expect(b.to).toEqual({ embedding: "qwen3-embedding-4b-q8", reranker: null });
  });

  it("nothing heavier fits: no upgrade", () => {
    const small: MachineProfile = { ...devPc, gpus: [{ ...devPc.gpus[0], vramTotalMB: 6000, vramUsedMB: 500 }] };
    const custom = {
      choice: { embedding: "qwen3-embedding-4b-q8", reranker: null },
      variant: { embedding: "qwen3-embedding-4b-q8", reranker: null },
    };
    expect(
      advise(input({ ...custom, machine: small, lines: ops("embed.query", "qwen3-embedding-4b-q8", 60, 30) })),
    ).toEqual([]);
  });

  it("a dismissed advice comes back only when the numbers move by more than 25 %", () => {
    const lines = [
      ...ops("embed.query", "qwen3-embedding-8b-q4", 50, 2000),
      ...ops("rerank", "qwen3-reranker-4b-q8", 50, 400),
    ];
    const [a] = advise(input({ lines }));
    expect(a.metric).toBe(2400);
    expect(advise(input({ lines, dismissed: { [a.id]: "2400" } }))).toEqual([]);
    const slower = [
      ...ops("embed.query", "qwen3-embedding-8b-q4", 50, 2800),
      ...ops("rerank", "qwen3-reranker-4b-q8", 50, 400),
    ];
    expect(advise(input({ lines: slower, dismissed: { [a.id]: "2400" } }))).toHaveLength(1);
    expect(changed("2400", 2900)).toBe(false);
    expect(changed("2400", 3100)).toBe(true);
    expect(changed("2400", 1700)).toBe(true);
    expect(changed(undefined, 1)).toBe(true);
  });
});

const ten = (x: number) => Array.from({ length: 10 }, () => x);

function measured(name: string, embedding: string, reranker: string | null, recalls: number[], provisional = false) {
  const mean = recalls.reduce((a, x) => a + x, 0) / recalls.length;
  const totals = { n: recalls.length, atK: { "10": { recall: mean, complete: 0, precision: 0, chars: 0 } } };
  const report = {
    version: 2,
    setting: `${embedding}-hybrid`,
    provisional,
    config: { embedding, reranker, mode: "hybrid", space: null, ks: [10], set: { hash: "s" }, corpus: "c" },
    policies: [{ name: "search", available: true, totals }],
    behaviors: recalls.map((r, i) => ({
      id: `b${i}`,
      policies: { search: { atK: { "10": { recall: r } }, roles: {} } },
    })),
    report: name,
  } as unknown as EvalReport;
  return { file: name, report, mtime: 0 } satisfies Measured;
}

describe("advice: memory failures and the quality side (N-perf)", () => {
  const slow = [
    ...ops("embed.query", "qwen3-embedding-8b-q4", 50, 2000),
    ...ops("rerank", "qwen3-reranker-4b-q8", 50, 400),
  ];

  it("a load that failed for lack of memory is a reason to go lighter", () => {
    const lines: PerfRecord[] = [
      { at: "2026-11-02T10:00:00Z", op: "model.load", model: "qwen3-reranker-4b-q8", items: 0, ms: 3100, oom: true },
    ];
    const [a] = advise(input({ lines }));
    expect(a.direction).toBe("downgrade");
    expect(a.to).toEqual({ embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-4b-q8" });
    expect(a.reason).toMatch(/Qwen3 Reranker 4B .* ran out of memory on this PC \(once in its last 50 operations\)/);
    expect(a.metric).toBe(1);
    expect(advise(input({ lines: lines.map((l) => ({ ...l, oom: false })) }))).toEqual([]);
  });

  it("a load the timings journal reports partly on the processor is a reason to go lighter", () => {
    const variant = { embedding: "qwen3-embedding-8b-q8", reranker: null };
    const lines: PerfRecord[] = [
      {
        at: "2026-11-02T10:00:00Z",
        op: "model.load",
        model: variant.embedding,
        items: 1,
        ms: 9000,
        partialOffload: true,
      },
    ];
    const [a] = advise(input({ choice: { embedding: variant.embedding, reranker: null }, variant, lines }));
    expect(a.reason).toMatch(/ran partly on the processor/);
  });

  it("quotes the measured difference when both fingerprints have a report", () => {
    const reports = [
      measured("cur.json", "qwen3-embedding-8b-q4", "qwen3-reranker-4b-q8", ten(0.9)),
      measured("cand.json", "qwen3-embedding-4b-q4", "qwen3-reranker-4b-q8", [...ten(0.9).slice(0, 7), 0.8, 0.8, 0.8]),
    ];
    const [a] = advise(input({ lines: slow, reports }));
    expect(a.quality).toMatch(
      /^−3 points of evidence recall, interval −\d+(\.\d)?…−?\d+(\.\d)? \(recall@10, 10 behaviors\)$/,
    );
    const prov = [reports[0], measured("cand.json", "qwen3-embedding-4b-q4", "qwen3-reranker-4b-q8", ten(0.9), true)];
    expect(advise(input({ lines: slow, reports: prov }))[0].quality).toMatch(/^0 points .*provisional/);
  });

  it("without reports: not measured, and the rag.eval to run on the candidate", () => {
    const [a] = advise(input({ lines: slow, reports: [] }));
    expect(a.quality).toBe(
      "quality difference not measured — run rag.eval --embedding qwen3-embedding-4b-q4 --reranker qwen3-reranker-4b-q8 on the candidate before switching",
    );
    const dir = mkdtempSync(join(tmpdir(), "testimus-advice-"));
    expect(advise(input({ lines: slow, project: dir }))[0].quality).toBe(a.quality);
    expect(advise(input({ lines: slow }))[0].quality).toBe(NOT_MEASURED);
  });
});
