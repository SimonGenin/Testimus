import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { bootstrap, compare, compareFiles, mulberry32 } from "../../src/core/rag/compare.ts";
import type { EvalReport } from "../../src/core/rag/eval.ts";
import type { BehaviorScore } from "../../src/core/rag/eval-score.ts";

type B = { id: string; recall: number; roles?: Record<string, [number, number]> };

function score(b: B): BehaviorScore {
  return {
    atK: { 10: { recall: b.recall, complete: b.recall === 1, precision: 0, chars: 0, items: 0 } },
    roles: Object.fromEntries(Object.entries(b.roles ?? {}).map(([r, [n, f]]) => [r, { n, found: { 10: f } }])),
    found: {},
    ndcg10: 0,
    mrr: 0,
    rank: null,
  };
}

function report(name: string, behaviors: B[], over: Partial<EvalReport> = {}): EvalReport {
  return {
    version: 2,
    report: name,
    setting: name,
    provisional: false,
    config: { ks: [10, 20, 50], set: { hash: "s" }, corpus: "c" },
    policies: [
      { name: "search", available: true },
      { name: "search+graph", available: false },
    ],
    behaviors: behaviors.map((b) => ({ id: b.id, policies: { search: score(b) } })),
    ...over,
  } as unknown as EvalReport;
}

describe("bootstrap (SPEC-RAG §10.6)", () => {
  it("is deterministic: a fixed seed gives the same interval", () => {
    const d = [0.5, -0.25, 0, 0.75, 0.1, 0];
    expect(bootstrap(d, 2000)).toEqual(bootstrap(d, 2000));
    const r = mulberry32(1);
    const first = [r(), r(), r()];
    const again = mulberry32(1);
    expect([again(), again(), again()]).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("matches a case worked by hand", () => {
    expect(bootstrap([0.25, 0.25, 0.25], 1000)).toEqual({ low: 0.25, high: 0.25 });
    // P(mean = 0) = 0.75^4 ≈ 0.32 > 2.5 %; P(mean ≥ 0.75) = 0.0039 + 0.0469 ≈ 0.051 > 2.5 % > P(mean = 1)
    expect(bootstrap([1, 0, 0, 0], 10000)).toEqual({ low: 0, high: 0.75 });
    expect(bootstrap([], 100)).toEqual({ low: 0, high: 0 });
  });
});

describe("rag.compare", () => {
  const base = report("base", [
    { id: "a", recall: 0.5, roles: { exception: [2, 1], rule: [2, 1] } },
    { id: "b", recall: 0.5, roles: { rule: [2, 1] } },
    { id: "c", recall: 0.5, roles: { rule: [2, 1] } },
    { id: "d", recall: 0.75, roles: { rule: [4, 3] } },
  ]);
  const up = (exceptions: number) =>
    report("better", [
      { id: "a", recall: 1, roles: { exception: [2, exceptions], rule: [2, 2] } },
      { id: "b", recall: 1, roles: { rule: [2, 2] } },
      { id: "c", recall: 1, roles: { rule: [2, 2] } },
      { id: "d", recall: 1, roles: { rule: [4, 4] } },
      { id: "new", recall: 0 },
    ]);

  it("adopts when the interval is above zero and no role goes down", () => {
    const c = compare(base, [up(2)]);
    expect(c.policy).toBe("search");
    const [row] = c.rows;
    expect(row).toMatchObject({ n: 4, adopt: true, recall: 1, baseline: 0.5625, diff: 0.4375, provisional: false });
    // diffs 0.5, 0.5, 0.5, 0.25: P(mean ≤ 0.3125) ≈ 0.051 > 2.5 % > P(mean = 0.25); P(mean = 0.5) ≈ 0.32
    expect(row.low).toBe(0.3125);
    expect(row.high).toBe(0.5);
    expect(Object.keys(row.byRole)).toEqual(["exception", "rule"]);
    expect(row.byRole.exception).toEqual({ recall: 1, baseline: 0.5, diff: 0.5, n: 2 });
    expect(row.byRole.rule).toEqual({ recall: 1, baseline: 0.6, diff: 0.4, n: 10 });
    expect(row.why).toBe("The interval is above zero and no role goes down.");
  });

  it("refuses when the interval touches zero, or when a role goes down (exceptions first)", () => {
    const same = compare(base, [base]).rows[0];
    expect(same).toMatchObject({ diff: 0, low: 0, high: 0, adopt: false });
    expect(same.why).toMatch(/does not exclude zero/);
    const twice = compare(base, [up(0), up(2)]);
    expect(twice.rows[0].low).toBe(0.3125);
    expect(twice.rows[0]).toMatchObject({ adopt: false });
    expect(twice.rows[0].byRole.exception.diff).toBe(-0.5);
    expect(twice.rows[0].why).toBe("Recall goes down for: exception.");
    expect(twice.rows[1].adopt).toBe(true);
  });

  it("says when a report is provisional, and when the sets or the documents differ", () => {
    const other = report("o", [{ id: "a", recall: 1 }], {
      provisional: true,
      config: { ks: [10], set: { hash: "x" }, corpus: "y" } as EvalReport["config"],
    });
    const c = compare(base, [other]);
    expect(c.provisional).toBe(true);
    expect(c.rows[0].why).toMatch(/Provisional/);
    expect(c.rows[0].warnings).toHaveLength(2);
    expect(c.rows[0].n).toBe(1);
  });

  it("refuses an unknown k, an unavailable policy, a report with no behavior in common", () => {
    expect(() => compare(base, [base], { k: 7 })).toThrow(/no recall at k = 7/);
    expect(() => compare(base, [base], { policy: "search+graph" })).toThrow(/not available/);
    expect(() => compare(base, [report("z", [{ id: "zz", recall: 1 }])])).toThrow(/shares no behavior/);
  });

  describe("files", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "testimus-compare-"));
      mkdirSync(join(dir, ".testimus", "eval"), { recursive: true });
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const save = (name: string, r: EvalReport, at: number) => {
      const f = join(dir, ".testimus", "eval", name);
      writeFileSync(f, JSON.stringify({ ...r, report: f }));
      utimesSync(f, at, at);
      return f;
    };

    it("one name compares it with the latest report; v1 reports are refused", async () => {
      save("1-base.json", base, 1000);
      save("2-better.json", report("better", [{ id: "a", recall: 1 }]), 3000);
      save("3-old.json", report("old", [{ id: "a", recall: 0 }]), 2000);
      writeFileSync(join(dir, ".testimus", "eval", "v1.json"), JSON.stringify({ n: 1, recall5: 1 }));
      const c = compareFiles(dir, { reports: ["1-base.json"] });
      expect(c.baseline).toBe(join(dir, ".testimus", "eval", "1-base.json"));
      expect(c.rows.map((r) => r.setting)).toEqual(["better"]);
      expect(() => compareFiles(dir, { reports: ["v1.json", "1-base"] })).toThrow(/not a v2 benchmark report/);
      expect(() => compareFiles(dir, { reports: ["nope.json"] })).toThrow(/No report nope.json/);
      const viaRegistry = (await invoke(
        "rag.compare",
        { reports: [".testimus/eval/1-base.json", "3-old"], samples: 500 },
        { project: dir },
      )) as { rows: { setting: string; adopt: boolean }[] };
      expect(viaRegistry.rows).toMatchObject([{ setting: "old", adopt: false }]);
    });
  });
});
