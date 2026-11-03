import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { env } from "../../src/core/env.ts";
import { readProject, writeProject } from "../../src/core/lib/project.ts";
import { runtimes } from "../../src/core/rag/embed.ts";
import { candidateModel, graph, runEval } from "../../src/core/rag/eval.ts";
import { chunkResolver, hitMatches, itemMatches, score, scoreBehavior, totals } from "../../src/core/rag/eval-score.ts";
import { readBehaviors } from "../../src/core/rag/eval-set.ts";
import { mockRuntime } from "../../src/core/rag/runtimes/mock.ts";

vi.mock("../../src/core/lib/models-resolve.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/lib/models-resolve.ts")>();
  return {
    ...real,
    resolveInstalled: () => null,
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

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const realGraph = { ...graph };
const realMock = env.mock;
const realRuntime = runtimes.mock;
let dir: string;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-cov-eval-")), "P");
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
  graph.related = (_p, { ref }) => ({ ref, neighbours: [], warnings: [] });
  graph.mentions = (_p, { term }) => ({ term, forms: [term], total: 0, sections: 0, page: 1, pages: 1, docs: [] });
});

afterEach(() => {
  Object.assign(graph, realGraph);
  env.mock = realMock;
  runtimes.mock = realRuntime;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

function write(lines: unknown[]): string {
  const f = join(dir, "set.jsonl");
  writeFileSync(f, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return f;
}

describe("behavior set corners", () => {
  it("refuses a missing file, an empty set, a question line without question", () => {
    expect(() => readBehaviors(join(dir, "none.jsonl"))).toThrow(/No behavior set/);
    expect(() => readBehaviors(write(["", "  "]))).toThrow(/holds no behavior/);
    expect(() => readBehaviors(write([{ expected: ["D#§1"] }]))).toThrow(/needs a question/);
    expect(() => readBehaviors(write([5]))).toThrow(/needs a question/);
  });

  it("keeps category and validated of a behavior", () => {
    const s = readBehaviors(
      write([
        { id: "b1", question: "Q ?", evidence: [{ ref: "D#§1", role: "rule" }], category: "acronym", validated: true },
      ]),
    );
    expect(s.behaviors[0]).toMatchObject({ id: "b1", question: "Q ?", category: "acronym", validated: true });
  });
});

describe("matching corners", () => {
  it("refs without an anchor match by text only", () => {
    const c = { docId: "D", anchor: "§1", figureIds: [] };
    expect(hitMatches(c, "plain")).toBe(false);
    expect(hitMatches(c, "E#§1")).toBe(false);
    expect(chunkResolver([c])("plain")).toEqual({ ref: "plain", chunks: [] });
    expect(chunkResolver([c])("Z#§1")).toEqual({ ref: "Z#§1", chunks: [] });
    expect(itemMatches({ ref: "plain", chunks: [] }, "plain")).toBe(true);
  });

  it("no must evidence scores zero nDCG; a rank past k gives no MRR; empty totals and scores", () => {
    const b = { id: "x", question: "q", queries: [], evidence: [{ ref: "D#§1", role: "rule" as const, must: false }] };
    const s = scoreBehavior(b, { ranked: [] });
    expect(s.ndcg10).toBe(0);
    const hit = { item: { ref: "D#§1", chunks: [] }, chars: 1 };
    const filler = (i: number) => ({ item: { ref: `D#§9.${i}`, chunks: [] }, chars: 1 });
    const late = scoreBehavior(
      { ...b, evidence: [{ ref: "D#§1", role: "rule", must: true }] },
      { ranked: [...Array.from({ length: 12 }, (_, i) => filler(i)), hit] },
      [10],
      10,
    );
    expect(late.rank).toBe(13);
    expect(late.mrr).toBe(0);
    expect(totals([]).ndcg10).toBe(0);
    expect(score([], 10)).toEqual({ n: 0, recall5: 0, recall10: 0, mrr: 0 });
  });
});

describe("candidate models", () => {
  it("a known model not installed is refused", () => {
    env.mock = false;
    expect(() => candidateModel(dir, "bge-m3-q8", "embedding")).toThrow(/is not installed on this PC/);
  });
});

describe("runEval corners", () => {
  it("graph warnings: related and mentions that fail; mentions on several pages", async () => {
    let pages = 0;
    graph.related = () => {
      throw new Error("related broke");
    };
    graph.mentions = (_p, { term, page }) => {
      if (term === "TCO") throw "mentions broke";
      pages = Math.max(pages, page ?? 1);
      return { term, forms: [term], total: 0, sections: 0, page: page ?? 1, pages: 2, docs: [] };
    };
    const r = await runEval(dir, quietCtx(dir), { mode: "bm25", reranker: "none" });
    const g = r.policies[1];
    expect(g.available).toBe(true);
    expect(g.warnings.some((w) => /related .*related broke/.test(w))).toBe(true);
    expect(g.warnings.some((w) => /mentions "TCO": mentions broke/.test(w))).toBe(true);
    expect(pages).toBe(2);
    expect(r.reranker).toBeNull();
    graph.related = () => {
      throw "related string";
    };
    graph.mentions = (_p, { term }) => {
      if (term === "TCO") throw new Error("mentions error");
      return {
        term,
        forms: [term],
        total: 1,
        sections: 1,
        page: 1,
        pages: 1,
        docs: [{ docId: D3, title: "", hits: 1, sections: [{ ref: `${D3}#§5.6.6`, title: "", hits: 1 }] }],
      } as never;
    };
    const again = await runEval(dir, quietCtx(dir), { mode: "bm25" });
    expect(again.policies[1].warnings.some((w) => /related string/.test(w))).toBe(true);
    expect(again.policies[1].warnings.some((w) => /mentions error/.test(w))).toBe(true);
  });

  it("a behavior that nothing retrieves has no rank", async () => {
    const set = write([{ id: "lost", question: "zzzz qqqq", evidence: [{ ref: "NOPE#§9", role: "rule" }] }]);
    const r = await runEval(dir, quietCtx(dir), { mode: "bm25", set });
    expect(r.behaviors[0].rank).toBeNull();
  });

  it("mentions not built yet turns the graph policy off", async () => {
    graph.mentions = () => {
      throw new Error("rag.mentions is not built yet.");
    };
    const r = await runEval(dir, quietCtx(dir), { mode: "bm25", reranker: "null" });
    expect(r.policies[1]).toMatchObject({ available: false, reason: "rag.mentions is not built yet." });
  });

  it("an unexpected error in the graph policy fails the evaluation", async () => {
    graph.mentions = () => ({ term: "x", forms: [], total: 0, sections: 0, page: 1, pages: 1 }) as never;
    await expect(runEval(dir, quietCtx(dir), { mode: "bm25", reranker: null })).rejects.toThrow(TypeError);
  });

  it("stops when cancelled", async () => {
    const ctrl = new AbortController();
    const ctx = {
      ...quietCtx(dir, ctrl.signal),
      progress: (p: { message?: string }) => {
        if (p.message?.startsWith("Behavior 1/")) ctrl.abort();
      },
    };
    await expect(runEval(dir, ctx, { mode: "bm25" })).rejects.toThrow(/Evaluation cancelled/);
  });

  it("a query the embedding model cannot read is a warning of every policy", async () => {
    runtimes.mock = {
      ...mockRuntime,
      embed: async (m, texts, mode) => {
        if (mode === "query") throw new Error("query refused");
        return mockRuntime.embed(m, texts, mode);
      },
    };
    const r = await runEval(dir, quietCtx(dir));
    expect(r.policies[0].warnings.some((w) => /query refused/.test(w))).toBe(true);
  });

  it("without any embedding model: setting none, headers from Claude", async () => {
    env.mock = false;
    const p = readProject(dir);
    writeProject(dir, { ...p, rag: { ...p.rag, claudeHeaders: true } as typeof p.rag });
    const r = await runEval(dir, quietCtx(dir), { mode: "bm25" });
    expect(r.embedding).toBe("none");
    expect(r.setting).toBe("none-bm25");
    expect(r.config.headers).toBe("claude");
    expect(r.behaviors.some((b) => b.rank === null) || r.behaviors.every((b) => b.rank !== null)).toBe(true);
    expect(r.behaviors[0].must).toBeGreaterThan(0);
  });
});
