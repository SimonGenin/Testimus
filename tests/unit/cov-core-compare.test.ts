import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compare, compareFiles, evalDir, latestReport, readReport } from "../../src/core/rag/compare.ts";
import type { BehaviorScore, EvalReport } from "../../src/core/rag/eval.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-cmp-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function score(recall: number | undefined, roles: Record<string, { n: number; found: Record<string, number> }>) {
  return {
    atK: recall === undefined ? { 10: {} } : { 10: { recall, complete: false, precision: 0, chars: 0, items: 0 } },
    roles,
    found: {},
    ndcg10: 0,
    mrr: 0,
    rank: null,
  } as unknown as BehaviorScore;
}

function report(name: string, behaviors: { id: string; s: BehaviorScore }[]): EvalReport {
  return {
    version: 2,
    report: name,
    setting: name,
    provisional: false,
    config: { ks: [10], set: { hash: "s" }, corpus: "c" },
    policies: [
      { name: "search", available: true },
      { name: "search+graph", available: false },
    ],
    behaviors: behaviors.map((b) => ({ id: b.id, policies: { search: b.s } })),
  } as unknown as EvalReport;
}

describe("compare corners", () => {
  it("a missing recall counts as 0; a role with no item or no count at k is skipped or 0", () => {
    const base = report("base", [
      { id: "a", s: score(undefined, { rule: { n: 0, found: {} }, exception: { n: 2, found: {} } }) },
    ]);
    const now = report("now", [{ id: "a", s: score(0.5, { exception: { n: 2, found: { 10: 1 } } }) }]);
    const c = compare(base, [now], { samples: 100 });
    const [row] = c.rows;
    expect(row.baseline).toBe(0);
    expect(row.recall).toBe(0.5);
    expect(row.byRole.rule).toBeUndefined();
    expect(row.byRole.exception).toEqual({ recall: 0.5, baseline: 0, diff: 0.5, n: 2 });
    const flip = compare(now, [base], { samples: 100 });
    expect(flip.rows[0].recall).toBe(0);
    expect(flip.rows[0].byRole.exception.recall).toBe(0);
  });
});

describe("compare policy", () => {
  it("picks search + graph when every report has it; no role, no role diff", () => {
    const withGraph = (name: string, recall: number) => {
      const r = report(name, []);
      const s = score(recall, {});
      return {
        ...r,
        policies: [
          { name: "search", available: true },
          { name: "search+graph", available: true },
        ],
        behaviors: [{ id: "a", policies: { search: s, "search+graph": s } }],
      } as unknown as EvalReport;
    };
    const c = compare(withGraph("base", 0.2), [withGraph("now", 0.4)], { samples: 50 });
    expect(c.policy).toBe("search+graph");
    expect(c.rows[0].byRole).toEqual({});
  });
});

describe("report files", () => {
  const write = (name: string, body: string) => {
    mkdirSync(evalDir(dir), { recursive: true });
    const f = join(evalDir(dir), name);
    writeFileSync(f, body);
    return f;
  };
  const good = (name: string) => JSON.stringify(report(name, [{ id: "a", s: score(0.5, {}) }]));

  it("refuses what is not JSON or not v2", () => {
    expect(() => readReport(write("bad.json", "{"))).toThrow(/is not a report/);
    expect(() => readReport(write("v1.json", "{}"))).toThrow(/not a v2 benchmark report/);
  });

  it("latestReport: none without the folder; ties on mtime are broken by name", () => {
    expect(latestReport(dir, "x")).toBeNull();
    const a = write("a.json", good("a"));
    const b = write("b.json", good("b"));
    const c = write("c.json", good("c"));
    write("junk.json", "{");
    const t = new Date("2026-01-01T00:00:00Z");
    for (const f of [a, b, c]) utimesSync(f, t, t);
    expect(latestReport(dir, a)).toBe(c);
  });

  it("one report alone needs another; an absolute path is read as is", () => {
    const only = write("only.json", good("only"));
    expect(() => compareFiles(dir, { reports: [only] })).toThrow(/no other report/);
    const other = write("other.json", good("other"));
    const c = compareFiles(dir, { reports: [only, "other"], samples: 50 });
    expect(c.baseline).toBe(only);
    expect(c.rows[0].report).toBe(other);
  });
});
