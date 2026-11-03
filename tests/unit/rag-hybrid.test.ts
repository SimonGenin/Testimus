import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { env } from "../../src/core/env.ts";
import { resolveModel } from "../../src/core/rag/activation.ts";
import { indexFile, insertChunk, openDb } from "../../src/core/rag/db.ts";
import type { SearchOpts } from "../../src/core/rag/search/filter.ts";
import {
  mergeRetrieval,
  RETRIEVAL_DEFAULTS,
  retrievalSettings,
  rrf,
  search,
  searchChunks,
} from "../../src/core/rag/search/hybrid.ts";
import type { ResolvedModel, RetrievalSettings } from "../../src/core/types.ts";

const seen = vi.hoisted(() => ({
  bm25: [] as SearchOpts[],
  vector: [] as SearchOpts[],
  rerankTexts: [] as string[][],
  lists: { bm25: [] as number[], vector: [] as number[] },
  rerank: null as null | { model: string; score: (text: string) => number },
  rerankFails: null as string | null,
  embedFails: null as string | null,
  space: null as null | { id: string; complete: boolean },
  degraded: null as string | null,
  pack: undefined as Partial<RetrievalSettings> | undefined,
}));

vi.mock("../../src/core/rag/search/lexical.ts", async (orig) => ({
  ...(await orig<typeof import("../../src/core/rag/search/lexical.ts")>()),
  bm25: (_db: unknown, _q: string, opts: SearchOpts) => {
    seen.bm25.push(opts);
    return seen.lists.bm25;
  },
}));
vi.mock("../../src/core/rag/search/vector.ts", async (orig) => ({
  ...(await orig<typeof import("../../src/core/rag/search/vector.ts")>()),
  vector: async (_db: unknown, _p: string, _q: string, opts: SearchOpts) => {
    seen.vector.push(opts);
    return { ids: seen.lists.vector, degraded: seen.degraded };
  },
}));
vi.mock("../../src/core/rag/activation.ts", async (orig) => ({
  ...(await orig<typeof import("../../src/core/rag/activation.ts")>()),
  activeModels: async () => ({
    embedding: null,
    reranker: null,
    choice: null,
    source: "none",
    missing: [],
    retrieval: seen.pack,
  }),
}));
vi.mock("../../src/core/rag/embed.ts", async (orig) => ({
  ...(await orig<typeof import("../../src/core/rag/embed.ts")>()),
  rerankFor: async (_p: string, _o: SearchOpts, _q: string, texts: string[]) => {
    seen.rerankTexts.push(texts);
    if (seen.rerankFails) throw new Error(seen.rerankFails);
    const r = seen.rerank;
    return r ? { model: r.model, scores: texts.map(r.score) } : null;
  },
  embedWith: async () => {
    throw new Error(seen.embedFails ?? "no embedding in this test");
  },
}));
vi.mock("../../src/core/rag/fingerprint.ts", async (orig) => {
  const real = await orig<typeof import("../../src/core/rag/fingerprint.ts")>();
  return { ...real, spaceOf: (...a: Parameters<typeof real.spaceOf>) => seen.space ?? real.spaceOf(...a) };
});

let dir: string;
let ids: number[];

function project(retrieval?: Partial<RetrievalSettings>) {
  writeFileSync(
    join(dir, "project.json"),
    JSON.stringify({
      name: "t",
      jiraProject: "T",
      language: "fr",
      labelPrefix: "",
      folders: [],
      rag: { embedding: "bge-m3", reranker: null, ...(retrieval ? { retrieval } : {}) },
      claude: { model: "sonnet", effort: "medium", presets: [], contexts: [] },
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-hybrid-"));
  project();
  const db = openDb(indexFile(dir));
  ids = [1, 2, 3, 4, 5].map((n) =>
    insertChunk(
      db,
      {
        id: `D#§${n}`,
        docId: "D",
        anchor: `§${n}`,
        path: `${n}`,
        reqIds: [],
        figureIds: [],
        header: `H${n}`,
        text: `score ${n / 10}`,
        kind: "section",
      },
      `h${n}`,
    ),
  );
  db.close();
  seen.bm25 = [];
  seen.vector = [];
  seen.rerankTexts = [];
  seen.lists = { bm25: ids, vector: [...ids].reverse() };
  seen.rerank = null;
  seen.rerankFails = null;
  seen.embedFails = null;
  seen.space = null;
  seen.degraded = null;
  seen.pack = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const scoreOf = (text: string) => Number(text.match(/score ([\d.]+)/)?.[1]);

describe("retrieval settings (SPEC-RAG §4.3)", () => {
  it("defaults to today's constants, then project.json, then the per-run override", () => {
    expect(RETRIEVAL_DEFAULTS).toEqual({
      candidates: 50,
      rrfK: 60,
      bm25Weights: [1, 1, 5],
      rerank: { top: 30, mode: "topk" },
      expand: "none",
    });
    expect(retrievalSettings(dir)).toEqual(RETRIEVAL_DEFAULTS);
    project({ candidates: 80, rerank: { top: 10, mode: "threshold", thresholds: { m: 0.5 } } });
    const r = retrievalSettings(dir, { rrfK: 5, rerank: { threshold: 0.2 } });
    expect(r).toEqual({
      candidates: 80,
      rrfK: 5,
      bm25Weights: [1, 1, 5],
      rerank: { top: 10, mode: "threshold", thresholds: { m: 0.5 }, threshold: 0.2 },
      expand: "none",
    });
    expect(mergeRetrieval(RETRIEVAL_DEFAULTS, { candidates: undefined })).toEqual(RETRIEVAL_DEFAULTS);
  });

  it("passes the effective settings and the project folder to bm25 and vector", async () => {
    project({ bm25Weights: [2, 1, 9] });
    await searchChunks(dir, "q", { retrieval: { candidates: 7 } });
    for (const o of [seen.bm25[0], seen.vector[0]]) {
      expect(o.retrieval).toEqual({ ...RETRIEVAL_DEFAULTS, candidates: 7, bm25Weights: [2, 1, 9] });
      expect(o.project).toBe(dir);
    }
  });

  it("fuses with the configured rrfK", async () => {
    seen.lists = { bm25: [ids[0], ids[1]], vector: [ids[1]] };
    const hits = await searchChunks(dir, "q", { retrieval: { rrfK: 0 } });
    const want = rrf([[ids[0], ids[1]], [ids[1]]], 0);
    expect(want).toEqual([
      [ids[1], 1 / 2 + 1],
      [ids[0], 1],
    ]);
    expect(hits.map((h) => [h.chunk.rowid, h.score])).toEqual(want);
  });
});

describe("reranking (SPEC-RAG §4.5)", () => {
  it("topk reranks the top max(k, rerank.top) candidates and returns k", async () => {
    seen.rerank = { model: "m", score: scoreOf };
    const hits = await searchChunks(dir, "q", { k: 2, retrieval: { rerank: { top: 3 } } });
    expect(seen.rerankTexts[0]).toHaveLength(3);
    expect(hits).toHaveLength(2);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it("threshold keeps every candidate above the model's threshold, not a top-k", async () => {
    seen.rerank = { model: "m", score: scoreOf };
    const hits = await searchChunks(dir, "q", {
      k: 1,
      retrieval: { rerank: { mode: "threshold", top: 1, threshold: 0.9, thresholds: { m: 0.25 } } },
    });
    expect(seen.rerankTexts[0]).toHaveLength(5);
    expect(hits.map((h) => h.chunk.anchor)).toEqual(["§5", "§4", "§3"]);
  });

  it("threshold falls back to rerank.threshold, then to a plain top-k when none is set", async () => {
    seen.rerank = { model: "other", score: scoreOf };
    const a = await searchChunks(dir, "q", {
      k: 1,
      retrieval: { rerank: { mode: "threshold", threshold: 0.35, thresholds: { m: 0 } } },
    });
    expect(a.map((h) => h.chunk.anchor)).toEqual(["§5", "§4"]);
    const b = await searchChunks(dir, "q", { k: 2, retrieval: { rerank: { mode: "threshold" } } });
    expect(b.map((h) => h.chunk.anchor)).toEqual(["§5", "§4"]);
  });

  it("without a reranker the fused order stands", async () => {
    const hits = await searchChunks(dir, "q", { k: 3, retrieval: { rerank: { mode: "threshold", threshold: 9 } } });
    expect(hits).toHaveLength(3);
  });
});

describe("active pack and forced models", () => {
  it("merges defaults < active pack < project.json < run override", async () => {
    seen.pack = { candidates: 80, rrfK: 7, rerank: { top: 40, mode: "topk" } };
    project({ candidates: 90 });
    await searchChunks(dir, "q", { retrieval: { bm25Weights: [1, 1, 1] } });
    expect(seen.bm25[0].retrieval).toEqual({
      ...RETRIEVAL_DEFAULTS,
      candidates: 90,
      rrfK: 7,
      bm25Weights: [1, 1, 1],
      rerank: { top: 40, mode: "topk" },
    });
  });

  it("a forced model searches its own space and ignores the pack; a forced null reranker reranks nothing", async () => {
    seen.pack = { rrfK: 7 };
    seen.rerank = { model: "m", score: scoreOf };
    env.mock = true;
    const model = resolveModel("qwen3-embedding-0.6b-onnx-q8") as ResolvedModel;
    env.mock = false;
    const hits = await searchChunks(dir, "q", { k: 2, model, rerankModel: null });
    expect(seen.vector).toHaveLength(0);
    expect(seen.rerankTexts).toHaveLength(0);
    expect(seen.bm25[0].retrieval?.rrfK).toBe(60);
    expect(hits[0].degraded).toMatch(/No complete vectors for qwen3-embedding-0.6b-onnx-q8/);
  });
});

describe("degraded vector search", () => {
  it("flags every passage when the vector side fell back", async () => {
    seen.degraded = "space incomplete";
    const hits = await search(dir, "q", { k: 2 });
    expect(hits.every((h) => h.degraded === true)).toBe(true);
    seen.degraded = null;
    expect((await search(dir, "q", { k: 2 })).some((h) => "degraded" in h)).toBe(false);
  });
});

describe("a model that fails never fails the search (review #7, #13)", () => {
  const order = (hits: { chunk: { anchor: string } }[]) => hits.map((h) => h.chunk.anchor);

  it("a reranker that throws: the fused ranking, a logged warning, no BM25 flag", async () => {
    const fused = order(await searchChunks(dir, "q", { k: 3 }));
    seen.rerankFails = "llama-server did not start: out of memory";
    const logs: string[] = [];
    const hits = await searchChunks(dir, "q", { k: 3, log: (_l, m) => logs.push(m) });
    expect(order(hits)).toEqual(fused);
    expect(hits[0].degraded).toBe(
      "The reranker failed (llama-server did not start: out of memory): fused ranking without reranking.",
    );
    expect(logs).toEqual([hits[0].degraded]);
    const out = await search(dir, "q", { k: 3 });
    expect(out).toHaveLength(3);
    expect(out.some((h) => "degraded" in h)).toBe(false);
  });

  it("a reranker that answers: the same result with or without a log, nothing logged", async () => {
    seen.rerank = { model: "m", score: scoreOf };
    const logs: string[] = [];
    const a = await searchChunks(dir, "q", { k: 3 });
    const b = await searchChunks(dir, "q", { k: 3, log: (_l, m) => logs.push(m) });
    expect(b).toEqual(a);
    expect(order(a)).toEqual(["§5", "§4", "§3"]);
    expect(a.some((h) => "degraded" in h)).toBe(false);
    expect(logs).toEqual([]);
  });

  it("a forced embedding model that throws on the query (rag.eval --embedding): lexical only, reason kept", async () => {
    env.mock = true;
    const model = resolveModel("qwen3-embedding-0.6b-onnx-q8") as ResolvedModel;
    env.mock = false;
    seen.space = { id: "s1", complete: true };
    seen.embedFails = "CUDA out of memory";
    const hits = await searchChunks(dir, "q", { k: 2, model, rerankModel: null });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      degraded: "qwen3-embedding-0.6b-onnx-q8 failed on the query (CUDA out of memory): lexical search only.",
      lexical: true,
    });
  });

  it("rag.search logs why it fell back to BM25, even when nothing is found", async () => {
    seen.degraded = "No vectors for bge-m3-q8 yet: lexical search until rag index ends.";
    seen.lists = { bm25: [], vector: [] };
    const logs: [string, string][] = [];
    const hits = await invoke("rag.search", { query: "q" }, { project: dir, onLog: (l, m) => logs.push([l, m]) });
    expect(hits).toEqual([]);
    expect(logs).toEqual([["warn", seen.degraded]]);
  });
});
