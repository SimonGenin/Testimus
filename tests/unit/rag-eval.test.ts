import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { env } from "../../src/core/env.ts";
import { catalogEntry } from "../../src/core/lib/models-catalog.ts";
import { readJson } from "../../src/core/lib/project.ts";
import { hooks } from "../../src/core/rag/chunk.ts";
import { indexFile, listSpaces, openDb, vectorCount } from "../../src/core/rag/db.ts";
import {
  type BehaviorScore,
  chunkResolver,
  defaultSet,
  type EvalReport,
  graph,
  type Item,
  mentionTerms,
  readBehaviors,
  runEval,
  scoreBehavior,
  totals,
} from "../../src/core/rag/eval.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import type { Behavior } from "../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";
const realGraph = { ...graph };
const realMock = env.mock;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-eval-"));
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
  hooks.describeChunks = null;
});

afterEach(() => {
  Object.assign(graph, realGraph);
  env.mock = realMock;
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, lines: unknown[]): string {
  const f = join(dir, name);
  writeFileSync(f, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\r\n"));
  return f;
}

describe("behavior set (SPEC-RAG §10.1)", () => {
  it("reads the v2 format with its defaults and keeps validated", () => {
    const s = readBehaviors(
      write("b.jsonl", [
        {
          id: "a",
          question: "Q ?",
          evidence: [
            { ref: "D#§1", role: "rule" },
            { ref: "D#fig:2", role: "figure", must: false },
          ],
          validated: false,
        },
        "",
      ]),
    );
    expect(s.format).toBe("behaviors");
    expect(s.behaviors).toEqual([
      {
        id: "a",
        question: "Q ?",
        queries: [],
        evidence: [
          { ref: "D#§1", role: "rule", must: true },
          { ref: "D#fig:2", role: "figure", must: false },
        ],
        validated: false,
        kind: "untagged",
      },
    ]);
  });

  it("still reads eval/questions.jsonl: each expected anchor is a must rule", () => {
    const s = readBehaviors(join(dir, "eval", "questions.jsonl"));
    expect(s.format).toBe("questions");
    expect(s.behaviors).toHaveLength(5);
    expect(s.behaviors[0]).toMatchObject({
      id: "q1",
      queries: [],
      evidence: [
        { ref: `${D3}#req:EXI_MOP_SPF_511_A_1670`, role: "rule", must: true },
        { ref: `${D3}#§5.6.6`, role: "rule", must: true },
      ],
    });
    expect(s.behaviors[0].validated).toBeUndefined();
    const mixed = readBehaviors(
      write("m.jsonl", [
        { q: "old", expected: ["D#§1"], kind: "code" },
        { id: "new", question: "n", evidence: [{ ref: "D#§2", role: "exception", must: true }] },
      ]),
    );
    expect(mixed.format).toBe("mixed");
    expect(mixed.behaviors.map((b) => [b.id, b.kind, b.category])).toEqual([
      ["q1", "code", "code"],
      ["new", "untagged", undefined],
    ]);
  });

  it("refuses a line without must evidence, a bad role, a duplicate id, a non-JSON line", () => {
    const one = (l: unknown) => () => readBehaviors(write("x.jsonl", [l]));
    expect(one({ id: "a", question: "q", evidence: [{ ref: "D#§1", role: "rule", must: false }] })).toThrow(
      /no evidence has must: true/,
    );
    expect(one({ id: "a", question: "q", evidence: [{ ref: "D#§1", role: "hint" }] })).toThrow(/evidence\.0\.role/);
    expect(one({ id: "a", question: "q", evidence: [{ ref: "nohash", role: "rule" }] })).toThrow(/docId#anchor/);
    expect(one("{nope")).toThrow(/line 1 is not JSON/);
    const dup = { id: "a", question: "q", evidence: [{ ref: "D#§1", role: "rule" }] };
    expect(() => readBehaviors(write("d.jsonl", [dup, dup]))).toThrow(/a appears twice/);
  });

  it("hashes the set the same whatever the line endings", () => {
    const b = { id: "a", question: "q", evidence: [{ ref: "D#§1", role: "rule" }] };
    const crlf = readBehaviors(
      write(
        "1.jsonl",
        [b, b].map((x, i) => ({ ...x, id: `a${i}` })),
      ),
    );
    writeFileSync(join(dir, "2.jsonl"), readFileSync(join(dir, "1.jsonl"), "utf8").replace(/\r\n/g, "\n"));
    expect(readBehaviors(join(dir, "2.jsonl")).hash).toBe(crlf.hash);
  });

  it("defaults to eval/behaviors.jsonl, else eval/questions.jsonl", () => {
    expect(defaultSet(dir)).toBe(join(dir, "eval", "behaviors.jsonl"));
    rmSync(join(dir, "eval", "behaviors.jsonl"));
    expect(defaultSet(dir)).toBe(join(dir, "eval", "questions.jsonl"));
  });
});

const chunk = (docId: string, anchor: string, reqIds: string[] = [], figureIds: string[] = []) => ({
  docId,
  anchor,
  reqIds,
  figureIds,
});
const item = (docId: string, anchor: string, reqIds: string[] = []): Item => ({
  ref: `${docId}#${anchor}`,
  chunks: [chunk(docId, anchor, reqIds)],
});

const B: Behavior = {
  id: "b",
  question: "q",
  queries: [],
  evidence: [
    { ref: "A#§1", role: "rule", must: true },
    { ref: "A#§2", role: "exception", must: true },
    { ref: "A#§3", role: "figure", must: false },
    { ref: "B#req:R1", role: "amendment", must: true },
  ],
};

describe("L1 metrics, computed by hand (SPEC-RAG §10.3)", () => {
  const ranked = [
    { item: item("A", "§9"), chars: 100 },
    { item: item("A", "§2"), chars: 50 },
    { item: item("A", "§3"), chars: 10 },
    { item: item("A", "§1"), chars: 20 },
    { item: item("B", "§7", ["R1"]), chars: 40 },
  ];

  it("evidence recall, complete, precision, characters, role recall, nDCG@10, MRR", () => {
    const s = scoreBehavior(B, { ranked }, [2, 4, 5], 10);
    expect(s.atK[2]).toEqual({ recall: 1 / 3, complete: false, precision: 1 / 2, chars: 150, items: 2 });
    expect(s.atK[4]).toEqual({ recall: 2 / 3, complete: false, precision: 3 / 4, chars: 180, items: 4 });
    expect(s.atK[5]).toEqual({ recall: 1, complete: true, precision: 4 / 5, chars: 220, items: 5 });
    expect(s.found[4]).toEqual(["A#§1", "A#§2"]);
    expect(s.roles).toEqual({
      rule: { n: 1, found: { 2: 0, 4: 1, 5: 1 } },
      exception: { n: 1, found: { 2: 1, 4: 1, 5: 1 } },
      figure: { n: 1, found: { 2: 0, 4: 1, 5: 1 } },
      amendment: { n: 1, found: { 2: 0, 4: 0, 5: 1 } },
    });
    expect(s.rank).toBe(2);
    expect(s.mrr).toBe(1 / 2);
    const dcg = 1 / Math.log2(3) + 1 / Math.log2(5) + 1 / Math.log2(6);
    const idcg = 1 + 1 / Math.log2(3) + 1 / Math.log2(4);
    expect(s.ndcg10).toBeCloseTo(dcg / idcg, 12);
    expect(scoreBehavior(B, { ranked }, [5], 1).mrr).toBe(0);
  });

  it("a passage that matches two evidence items earns one gain; a miss scores zero", () => {
    const two: Behavior = {
      ...B,
      evidence: [
        { ref: "A#req:X", role: "rule", must: true },
        { ref: "A#§4", role: "rule", must: true },
      ],
    };
    const s = scoreBehavior(two, { ranked: [{ item: item("A", "§4", ["X"]), chars: 1 }] }, [10]);
    expect(s.atK[10].recall).toBe(1);
    expect(s.ndcg10).toBeCloseTo(1 / (1 + 1 / Math.log2(3)), 12);
    const none = scoreBehavior(two, { ranked: [] }, [10]);
    expect(none).toMatchObject({ rank: null, mrr: 0, ndcg10: 0 });
    expect(none.atK[10]).toEqual({ recall: 0, complete: false, precision: 0, chars: 0, items: 0 });
  });

  it("search + graph adds the neighbours of the top k passages and every mention, with their characters", () => {
    const resolve = chunkResolver([chunk("A", "§1"), chunk("B", "§7", ["R1"])]);
    const expansion = new Map([[ranked[0].item.ref, { items: [resolve("A#§1"), resolve("A#§9")], chars: 30 }]]);
    const extra = { items: [resolve("B#req:R1")], chars: 70 };
    const s = scoreBehavior(B, { ranked: ranked.slice(0, 1), expansion, extra }, [1]);
    expect(s.atK[1]).toEqual({ recall: 2 / 3, complete: false, precision: 2 / 3, chars: 200, items: 3 });
    expect(s.found[1]).toEqual(["A#§1", "B#req:R1"]);
    expect(s.rank).toBeNull();
  });

  it("totals: recall and precision are means over behaviors, role recall pools the items", () => {
    const one = scoreBehavior(B, { ranked }, [4]);
    const other: BehaviorScore = scoreBehavior(
      { ...B, evidence: [{ ref: "A#§9", role: "exception", must: true }] },
      { ranked },
      [4],
    );
    const t = totals([one, other], [4]);
    expect(t.n).toBe(2);
    expect(t.atK[4].recall).toBeCloseTo((2 / 3 + 1) / 2, 12);
    expect(t.atK[4].complete).toBe(1 / 2);
    expect(t.atK[4].precision).toBeCloseTo((3 / 4 + 1 / 4) / 2, 12);
    expect(t.atK[4].chars).toBe(180);
    expect(Object.keys(t.byRole)).toEqual(["exception", "amendment", "rule", "figure"]);
    expect(t.byRole.exception).toEqual({ n: 2, recall: { 4: 1 } });
    expect(t.byRole.amendment).toEqual({ n: 1, recall: { 4: 0 } });
    expect(t.mrr).toBeCloseTo((1 / 2 + 1) / 2, 12);
  });

  it("mentions are asked for the queries and the ids and acronyms of the question", () => {
    expect(mentionTerms({ question: "Que montre le TCO ?", queries: ["TCO deux rangs"] })).toEqual([
      "TCO",
      "TCO deux rangs",
    ]);
    expect(mentionTerms({ question: "Que dit EXI_MOP_SPF_511_A_1670 ?", queries: [] })).toEqual([
      "EXI_MOP_SPF_511_A_1670",
    ]);
    expect(mentionTerms({ question: "Comment l'opérateur autorise l'ouverture ?", queries: [] })).toEqual([
      "Comment",
      "opérateur",
      "autorise",
    ]);
  });
});

describe("rag.eval v2 on the fixture project", () => {
  it("runs both policies; the graph policy is reported unavailable while rag.related is not built", async () => {
    graph.related = () => {
      throw new Error("rag.related is not built yet.");
    };
    const r = await runEval(dir, quietCtx(dir));
    expect(r.version).toBe(2);
    expect(r.provisional).toBe(true);
    expect(r.config.set).toMatchObject({ format: "behaviors", behaviors: 5, validated: false });
    expect(r.config.set.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.config.chunker).toMatch(/^[0-9a-f]{16}$/);
    expect(r.config.corpus).toMatch(/^[0-9a-f]{16}$/);
    expect(r.config.headers).toBe("default");
    expect(r.config.space?.id).toMatch(/^[0-9a-f]{12}$/);
    expect(r.config.ks).toEqual([10, 20, 50]);
    expect(r.config.retrieval).toMatchObject({ candidates: 50, rrfK: 60, rerank: { top: 30, mode: "topk" } });
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"));
    expect(r.config.app).toBe(pkg.version);
    const [search, withGraph] = r.policies;
    expect(search).toMatchObject({ name: "search", available: true });
    expect(search.totals?.atK[10].recall).toBeGreaterThan(0);
    expect(search.totals?.byRole.exception.n).toBe(1);
    expect(withGraph).toMatchObject({ name: "search+graph", available: false, totals: null });
    expect(withGraph.reason).toMatch(/not built yet/);
    expect(r.behaviors[0].policies["search+graph"]).toBeUndefined();
    expect(r.behaviors.map((b) => b.category)).toEqual([
      "one-section",
      "one-section",
      "figure",
      "several-documents",
      "acronym",
    ]);
    expect(r.questions[0].rank).toBe(1);
    expect(r.n).toBe(5);
    expect(r.setting).toBe("bge-m3-q8-hybrid");
    expect(r.recall10).toBeGreaterThanOrEqual(r.recall5);
    expect(r.byKind.untagged.n).toBe(5);
    const saved = readJson<EvalReport>(r.report, {} as EvalReport);
    expect(saved.config).toEqual(r.config);
    expect(saved.provisional).toBe(true);
  });

  it("scores search + graph with the graph tools", async () => {
    const asked: string[] = [];
    graph.related = (_p, { ref }) => {
      asked.push(ref);
      return {
        ref,
        neighbours: ref.endsWith("#§5.6.7")
          ? [{ ref: `${D4}#§4.2`, kind: "refers", direction: "out", title: "Signal", path: "4 > 4.2", depth: 1 }]
          : [],
        warnings: [],
      };
    };
    const terms: string[] = [];
    graph.mentions = (_p, { term }) => {
      terms.push(term);
      return { term, forms: [term], total: 0, sections: 0, page: 1, pages: 1, docs: [] };
    };
    const r = await runEval(dir, quietCtx(dir), { mode: "bm25" });
    const [search, withGraph] = r.policies;
    expect(withGraph.available).toBe(true);
    expect(asked).toContain(`${D3}#req:EXI_MOP_SPF_511_A_1670`);
    expect(terms).toContain("TCO");
    for (const k of [10, 20, 50]) {
      expect(withGraph.totals?.atK[k].recall).toBeGreaterThanOrEqual(search.totals?.atK[k].recall as number);
      expect(withGraph.totals?.atK[k].chars).toBeGreaterThan(search.totals?.atK[k].chars as number);
    }
    expect(r.config.space).toBeNull();
  });

  it("overrides the retrieval settings for one run and says so in the setting", async () => {
    graph.related = () => {
      throw new Error("rag.related is not built yet.");
    };
    const r = await runEval(dir, quietCtx(dir), {
      mode: "bm25",
      retrieval: { rrfK: 1, rerank: { mode: "threshold" } },
    });
    expect(r.config.retrieval).toMatchObject({ rrfK: 1, candidates: 50, rerank: { top: 30, mode: "threshold" } });
    expect(r.setting).toMatch(/^bge-m3-q8-bm25-r[0-9a-f]{6}$/);
  });

  it("measures a candidate model in the live rag.db through its own space; the active space and state.json stay", async () => {
    graph.related = () => {
      throw new Error("rag.related is not built yet.");
    };
    await indexProject(dir, quietCtx(dir));
    const state = readFileSync(join(dir, "index", "state.json"), "utf8");
    const spaces = () => {
      const db = openDb(indexFile(dir));
      try {
        return listSpaces(db).map((s) => ({ id: s.id, model: s.modelId, n: vectorCount(db, s.id) }));
      } finally {
        db.close();
      }
    };
    const before = spaces();
    expect(before).toHaveLength(1);
    const r = await runEval(dir, quietCtx(dir), { embedding: "qwen3-embedding-0.6b", reranker: "bge-reranker-v2-m3" });
    const emb = catalogEntry("qwen3-embedding-0.6b")?.id as string;
    const rer = catalogEntry("bge-reranker-v2-m3")?.id as string;
    expect(r.config).toMatchObject({ embedding: emb, reranker: rer, index: indexFile(dir) });
    expect(r.setting).toBe(`${emb}+${rer}-hybrid`);
    const after = spaces();
    expect(after).toHaveLength(2);
    expect(after).toContainEqual(before[0]);
    expect(after.find((s) => s.id === r.config.space?.id)?.model).toBe(emb);
    expect(readFileSync(join(dir, "index", "state.json"), "utf8")).toBe(state);
    expect(existsSync(join(dir, ".testimus", "eval", emb))).toBe(false);
    expect(r.policies[0].totals?.atK[10].recall).toBeGreaterThan(0);
  });

  it("refuses an unknown candidate, or one of the wrong kind", async () => {
    await expect(runEval(dir, quietCtx(dir), { embedding: "nope" })).rejects.toThrow(/Unknown embedding nope/);
    await expect(runEval(dir, quietCtx(dir), { embedding: "bge-reranker-v2-m3-q8" })).rejects.toThrow(
      /Unknown embedding/,
    );
  });

  it("reads the v1 question set: not provisional", async () => {
    graph.related = () => {
      throw new Error("rag.related is not built yet.");
    };
    const r = await runEval(dir, quietCtx(dir), { set: "eval/questions.jsonl", mode: "bm25" });
    expect(r.config.set.format).toBe("questions");
    expect(r.provisional).toBe(false);
    expect(r.config.set.validated).toBe(true);
    expect(r.byKind.untagged.n).toBe(5);
  });

  it("runs through the registry with a retrieval override", async () => {
    graph.related = () => {
      throw new Error("rag.related is not built yet.");
    };
    const r = (await invoke(
      "rag.eval",
      { mode: "bm25", retrieval: { candidates: 20 } },
      { project: dir },
    )) as EvalReport;
    expect(r.config.retrieval.candidates).toBe(20);
    expect(existsSync(r.report)).toBe(true);
  });
});
