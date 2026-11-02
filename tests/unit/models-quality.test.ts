import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adviceQuality,
  diffText,
  evalReports,
  measuredRecall,
  NOT_MEASURED,
  packQuality,
  points,
  qualityDiff,
} from "../../src/core/lib/models-quality.ts";
import { bootstrap } from "../../src/core/rag/compare.ts";

const Q4 = "qwen3-embedding-8b-q4";
const R4 = "qwen3-reranker-4b-q8";
const B4 = "qwen3-embedding-4b-q8";
const R06 = "qwen3-reranker-0.6b-q8";

type Fake = {
  name: string;
  embedding: string;
  reranker: string | null;
  recalls: number[];
  space?: string;
  mode?: string;
  setting?: string;
  provisional?: boolean;
  graph?: boolean;
  set?: string;
  corpus?: string;
  age?: number;
};

let project: string;

function fakeReport(f: Fake): object {
  const mean = f.recalls.reduce((a, x) => a + x, 0) / f.recalls.length;
  const totals = { n: f.recalls.length, atK: { "10": { recall: mean, complete: 0, precision: 0, chars: 0 } } };
  const score = (r: number) => ({ atK: { "10": { recall: r } }, roles: {} });
  return {
    version: 2,
    setting: f.setting ?? `${f.embedding}${f.reranker ? `+${f.reranker}` : ""}-${f.mode ?? "hybrid"}`,
    provisional: f.provisional ?? false,
    config: {
      embedding: f.embedding,
      reranker: f.reranker,
      mode: f.mode ?? "hybrid",
      space: f.space ? { id: f.space, model: f.embedding, complete: true, fingerprint: {} } : null,
      ks: [10, 20, 50],
      set: { hash: f.set ?? "set-a" },
      corpus: f.corpus ?? "corpus-a",
    },
    policies: [
      { name: "search", available: true, totals },
      { name: "search+graph", available: !!f.graph, totals: f.graph ? totals : null },
    ],
    behaviors: f.recalls.map((r, i) => ({
      id: `b${i}`,
      policies: { search: score(r), ...(f.graph ? { "search+graph": score(r) } : {}) },
    })),
    report: f.name,
  };
}

function writeReports(dir: string, fakes: Fake[]): void {
  const evalDir = join(dir, ".testimus", "eval");
  mkdirSync(evalDir, { recursive: true });
  const now = Date.now() / 1000;
  for (const f of fakes) {
    const file = join(evalDir, f.name);
    writeFileSync(file, JSON.stringify(fakeReport(f)));
    utimesSync(file, now - (f.age ?? 0), now - (f.age ?? 0));
  }
}

const ten = (x: number) => Array.from({ length: 10 }, () => x);
const minus3 = [...ten(1).slice(0, 7), 0.9, 0.9, 0.9];

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "testimus-quality-"));
});

describe("benchmark reports read for the quality side (§7.10, §10.6)", () => {
  it("lists v2 reports newest first, without lexical-only runs, overridden settings or other files", () => {
    writeReports(project, [
      { name: "a-old.json", embedding: Q4, reranker: R4, recalls: ten(0.5), age: 300 },
      { name: "b-new.json", embedding: Q4, reranker: R4, recalls: ten(0.6), age: 10 },
      { name: "c-bm25.json", embedding: "none", reranker: null, mode: "bm25", recalls: ten(0.4) },
      { name: "d-tuned.json", embedding: Q4, reranker: R4, recalls: ten(0.9), setting: `${Q4}+${R4}-hybrid-r1a2b3c` },
    ]);
    writeFileSync(join(project, ".testimus", "eval", "x-bench.json"), JSON.stringify({ version: 1, runs: [] }));
    expect(evalReports(project).map((m) => m.report.report)).toEqual(["b-new.json", "a-old.json"]);
    expect(evalReports(join(project, "nowhere"))).toEqual([]);
  });

  it("measured recall of a pair: the latest report for those catalog ids, or for that vector space", () => {
    writeReports(project, [
      { name: "q4-old.json", embedding: Q4, reranker: R4, recalls: ten(0.5), age: 300, space: "aaaaaaaaaaaa" },
      { name: "q4-new.json", embedding: Q4, reranker: R4, recalls: ten(0.7), age: 10, space: "bbbbbbbbbbbb" },
      { name: "q4-norr.json", embedding: Q4, reranker: null, recalls: ten(0.2) },
    ]);
    const reports = evalReports(project);
    expect(measuredRecall({ embedding: Q4, reranker: R4 }, reports)).toMatchObject({
      recall: expect.closeTo(0.7, 10),
      n: 10,
      k: 10,
      policy: "search",
      provisional: false,
    });
    expect(measuredRecall({ embedding: Q4, reranker: R4, space: "aaaaaaaaaaaa" }, reports)?.recall).toBeCloseTo(
      0.5,
      10,
    );
    expect(measuredRecall({ embedding: Q4, reranker: null }, reports)?.recall).toBeCloseTo(0.2, 10);
    expect(measuredRecall({ embedding: B4, reranker: R06 }, reports)).toBeNull();
  });

  it("the difference between two fingerprints: paired bootstrap of compare, in points with its interval", () => {
    writeReports(project, [
      { name: "cur.json", embedding: Q4, reranker: R4, recalls: ten(1), space: "aaaaaaaaaaaa" },
      { name: "cand.json", embedding: B4, reranker: R06, recalls: minus3, space: "cccccccccccc" },
    ]);
    const reports = evalReports(project);
    const d = qualityDiff(
      { embedding: Q4, reranker: R4, space: "aaaaaaaaaaaa" },
      { embedding: B4, reranker: R06, space: "cccccccccccc" },
      reports,
    );
    const want = bootstrap(
      minus3.map((x) => x - 1),
      10000,
    );
    expect(d).toMatchObject({ n: 10, k: 10, provisional: false, low: want.low, high: want.high });
    expect(d?.diff).toBeCloseTo(-0.03, 10);
    expect(points(d?.diff ?? 0)).toBe("−3");
    expect(adviceQuality({ embedding: Q4, reranker: R4 }, { embedding: B4, reranker: R06 }, reports)).toBe(
      `−3 points of evidence recall, interval ${points(want.low)}…${points(want.high)} (recall@10, 10 behaviors)`,
    );
  });

  it("prefers a current-model report on the same behavior set and corpus as the candidate's", () => {
    writeReports(project, [
      { name: "cur-other-set.json", embedding: Q4, reranker: R4, recalls: ten(0.1), set: "set-b", age: 1 },
      { name: "cur-same-set.json", embedding: Q4, reranker: R4, recalls: ten(1), age: 100 },
      { name: "cand.json", embedding: B4, reranker: R06, recalls: ten(0.9), age: 50 },
    ]);
    const d = qualityDiff({ embedding: Q4, reranker: R4 }, { embedding: B4, reranker: R06 }, evalReports(project));
    expect(d?.from).toMatch(/cur-same-set\.json$/);
    expect(d?.diff).toBeCloseTo(-0.1, 10);
  });

  it("not measured: says which rag.eval to run", () => {
    writeReports(project, [{ name: "cur.json", embedding: Q4, reranker: R4, recalls: ten(1) }]);
    const reports = evalReports(project);
    expect(adviceQuality({ embedding: Q4, reranker: R4 }, { embedding: B4, reranker: R06 }, reports)).toBe(
      `quality difference not measured — run rag.eval --embedding ${B4} --reranker ${R06} on the candidate before switching`,
    );
    expect(adviceQuality({ embedding: B4, reranker: null }, { embedding: Q4, reranker: R4 }, reports)).toBe(
      "quality difference not measured — run rag.eval on the current models before switching",
    );
    expect(adviceQuality({ embedding: Q4, reranker: R4 }, { embedding: B4, reranker: null }, [])).toMatch(
      /run rag\.eval --embedding qwen3-embedding-4b-q8 on the candidate/,
    );
  });

  it("provisional when the behavior set is not validated; search+graph when both reports have it", () => {
    writeReports(project, [
      { name: "cur.json", embedding: Q4, reranker: R4, recalls: ten(0.8), graph: true },
      { name: "cand.json", embedding: B4, reranker: R06, recalls: ten(0.85), graph: true, provisional: true },
    ]);
    const reports = evalReports(project);
    const d = qualityDiff({ embedding: Q4, reranker: R4 }, { embedding: B4, reranker: R06 }, reports);
    expect(d).toMatchObject({ policy: "search+graph", provisional: true });
    expect(diffText(d as NonNullable<typeof d>)).toMatch(
      /^\+5 points of evidence recall, interval 5…5 \(recall@10, 10 behaviors; provisional: the behavior set is not validated\)$/,
    );
    expect(packQuality({ embedding: B4, reranker: R06 }, reports)).toBe(
      "evidence recall 85 % on this project (recall@10, 10 behaviors, provisional)",
    );
    expect(packQuality({ embedding: Q4, reranker: R4 }, reports)).toBe(
      "evidence recall 80 % on this project (recall@10, 10 behaviors)",
    );
    expect(packQuality({ embedding: Q4, reranker: null }, reports)).toBe(NOT_MEASURED);
  });
});
