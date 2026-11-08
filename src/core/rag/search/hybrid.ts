import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { UserError } from "../../command.ts";
import { docIds, readDoc } from "../../lib/docs.ts";
import { indexRunState } from "../../lib/docs-index.ts";
import { loadMsSoFar, recordPerf } from "../../lib/models-perf.ts";
import { readProject } from "../../lib/project.ts";
import type { RetrievalSettings, SearchHit, SearchWhy } from "../../types.ts";
import { activeModels } from "../activation.ts";
import { type ChunkRow, chunkCount, chunksByRowid, indexFile, nearest, withDb } from "../db.ts";
import { embedWith, rerankFor, rerankWith } from "../embed.ts";
import { spaceOf } from "../fingerprint.ts";
import { explainHit } from "./explain.ts";
import { keep, type RetrievalOverride, type SearchOpts } from "./filter.ts";
import { type Expand, expandHits, hitOf } from "./hits.ts";
import { bm25, termsOf } from "./lexical.ts";
import { type VectorResult, vector } from "./vector.ts";

export type { RetrievalOverride, SearchMode, SearchOpts } from "./filter.ts";
export type { Expand } from "./hits.ts";

const RRF_K = 60;

export const RETRIEVAL_DEFAULTS: RetrievalSettings = {
  candidates: 50,
  rrfK: RRF_K,
  bm25Weights: [1, 1, 5],
  rrfWeights: [1, 1],
  rerank: { top: 30, mode: "topk" },
  expand: "none",
  typos: false,
  synonyms: [],
};

export function mergeRetrieval(base: RetrievalSettings, over: RetrievalOverride | undefined): RetrievalSettings {
  if (!over) return base;
  const defined = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  const { rerank, ...rest } = over;
  return {
    ...base,
    ...defined(rest),
    rerank: { ...base.rerank, ...defined(rerank ?? {}) },
  };
}

export function projectRetrieval(project: string): RetrievalOverride | undefined {
  return existsSync(join(project, "project.json")) ? readProject(project).rag.retrieval : undefined;
}

export function retrievalSettings(
  project: string,
  override?: RetrievalOverride,
  pack?: RetrievalOverride,
): RetrievalSettings {
  return mergeRetrieval(mergeRetrieval(mergeRetrieval(RETRIEVAL_DEFAULTS, pack), projectRetrieval(project)), override);
}

export async function packRetrieval(project: string): Promise<RetrievalOverride | undefined> {
  try {
    return (await activeModels(project)).retrieval;
  } catch {
    return undefined;
  }
}

async function vectorOf(db: DatabaseSync, project: string, query: string, o: SearchOpts): Promise<VectorResult> {
  const m = o.model;
  if (!m) return vector(db, project, query, o);
  const space = spaceOf(db, m);
  if (!space?.complete)
    return { ids: [], degraded: `No complete vectors for ${m.entry.id}: run its index first.`, unbuilt: true };
  let q: Float32Array;
  try {
    [q] = await embedWith(m, [query], "query");
  } catch (e) {
    return { ids: [], degraded: `${m.entry.id} failed on the query (${messageOf(e)}): lexical search only.` };
  }
  const ids = nearest(db, space.id, q, Math.min(chunkCount(db), 4096)).map((r) => r.rowid);
  const byId = chunksByRowid(db, ids);
  return {
    ids: ids.filter((id) => keep(byId.get(id), o)).slice(0, o.retrieval?.candidates ?? RETRIEVAL_DEFAULTS.candidates),
    degraded: null,
  };
}

async function rerankOf(project: string, o: SearchOpts, query: string, texts: string[]) {
  if (o.rerankModel === undefined) return rerankFor(project, o, query, texts);
  if (!o.rerankModel) return null;
  return { model: o.rerankModel.entry.id, scores: await rerankWith(o.rerankModel, query, texts) };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function rerankThreshold(r: RetrievalSettings, model: string): number | undefined {
  return r.rerank.thresholds?.[model] ?? r.rerank.threshold;
}

// ponytail: weights[i] scales list i's share (words, then meaning); a missing weight is 1
export function rrf(lists: number[][], k = RRF_K, weights: number[] = []): [number, number][] {
  const score = new Map<number, number>();
  for (const [l, list] of lists.entries()) {
    const w = weights[l] ?? 1;
    for (const [i, id] of list.entries()) score.set(id, (score.get(id) ?? 0) + w / (k + i + 1));
  }
  return [...score].sort((a, b) => b[1] - a[1]);
}

// ponytail: `degraded` is every fallback this search took (vectors, reranker) — rag.eval lists it in its warnings;
// `lexical` marks the BM25-only fallback that rag.search flags on each hit; `why` only when explain is asked
export type Ranked = { chunk: ChunkRow; score: number; degraded?: string; lexical?: true; why?: SearchWhy };

type SearchLog = (level: "info" | "warn", message: string) => void;
type RankOpts = SearchOpts & { log?: SearchLog; explain?: boolean };
export type SearchInput = RankOpts & { expand?: Expand; dateFrom?: string; dateTo?: string };

export async function searchChunks(project: string, query: string, opts: RankOpts = {}): Promise<Ranked[]> {
  return (await ranked(project, query, opts)).hits;
}

const rankOf = (ids: number[] | undefined) => new Map((ids ?? []).map((id, i) => [id, i + 1]));

async function ranked(
  project: string,
  query: string,
  opts: RankOpts,
): Promise<{ hits: Ranked[]; settings: RetrievalSettings }> {
  const t0 = performance.now();
  const l0 = loadMsSoFar();
  const k = opts.k ?? 10;
  const mode = opts.mode ?? "hybrid";
  const file = opts.dbFile ?? indexFile(project);
  if (!existsSync(file)) throw new UserError("The project has no index yet.", "Run testimus rag index.");
  const settings = retrievalSettings(project, opts.retrieval, opts.model ? undefined : await packRetrieval(project));
  const o: SearchOpts = { ...opts, retrieval: settings, project };
  return withDb(file, async (db) => {
    const lists: number[][] = [];
    const weights: number[] = [];
    let words: number[] | undefined;
    let meaning: number[] | undefined;
    let degraded: string | null = null;
    let unbuilt = false;
    const terms = mode !== "vector" || opts.explain ? termsOf(db, query, o) : null;
    if (terms && mode !== "vector") {
      const t = performance.now();
      words = bm25(db, query, o, terms);
      recordPerf({ at: "", op: "search.bm25", items: words.length, ms: Math.round(performance.now() - t) });
      lists.push(words);
      weights.push(settings.rrfWeights[0] ?? 1);
    }
    if (mode !== "bm25") {
      const t = performance.now();
      const lv = loadMsSoFar();
      const v = await vectorOf(db, project, query, o);
      if (!v.degraded)
        recordPerf({
          at: "",
          op: "search.vector",
          items: v.ids.length,
          ms: Math.round(performance.now() - t - (loadMsSoFar() - lv)),
          ...(o.model ? { model: o.model.entry.id } : {}),
        });
      meaning = v.ids;
      lists.push(v.ids);
      weights.push(settings.rrfWeights[1] ?? 1);
      degraded = v.degraded;
      unbuilt = !!v.unbuilt;
    }
    // ponytail: vectors an index run is still embedding are its work in progress — said as such, not as a problem;
    // any other fallback (the model does not load, the query fails) is said as it is, run or not
    const building = unbuilt && !opts.dbFile && !!indexRunState(project);
    if (building) degraded = "An index run is under way: search matches words until it ends.";
    let ranked = rrf(lists, settings.rrfK, weights);
    const byId = chunksByRowid(
      db,
      ranked.map(([id]) => id),
    );
    const pool = settings.rerank.mode === "threshold" ? ranked : ranked.slice(0, Math.max(k, settings.rerank.top));
    let rerankFailed: string | null = null;
    let reranked: Awaited<ReturnType<typeof rerankOf>> = null;
    // ponytail: a reranker that cannot answer (server down, out of memory) leaves the fused ranking as it is — the
    // search never fails for it, and the warning says why
    if (ranked.length)
      try {
        reranked = await rerankOf(
          project,
          o,
          query,
          pool.map(([id]) => {
            const c = byId.get(id) as ChunkRow;
            return `${c.header}\n${c.text}`;
          }),
        );
      } catch (e) {
        rerankFailed = `The reranker failed (${messageOf(e)}): fused ranking without reranking.`;
      }
    const reasons = [degraded, rerankFailed].filter((r): r is string => !!r);
    for (const r of reasons) opts.log?.(building && r === degraded ? "info" : "warn", r);
    const why = reasons.join(" ");
    let cut = k;
    if (reranked) {
      ranked = pool.map(([id], i): [number, number] => [id, reranked.scores[i]]).sort((a, b) => b[1] - a[1]);
      const threshold = settings.rerank.mode === "threshold" ? rerankThreshold(settings, reranked.model) : undefined;
      if (threshold !== undefined) {
        ranked = ranked.filter(([, s]) => s >= threshold);
        cut = ranked.length;
      }
    }
    const explained = opts.explain && terms ? { terms, words: rankOf(words), meaning: rankOf(meaning) } : null;
    const hits = ranked.slice(0, cut).map(([id, score]): Ranked => {
      const chunk = byId.get(id) as ChunkRow;
      return {
        chunk,
        score,
        ...(why ? { degraded: why } : {}),
        ...(degraded ? { lexical: true as const } : {}),
        ...(explained
          ? {
              why: explainHit(explained.terms, chunk, {
                words: explained.words.get(id) ?? null,
                meaning: explained.meaning.get(id) ?? null,
                reranker: reranked ? score : null,
              }),
            }
          : {}),
      };
    });
    recordPerf({
      at: "",
      op: "search.total",
      items: hits.length,
      ms: Math.round(performance.now() - t0 - (loadMsSoFar() - l0)),
    });
    return { hits, settings };
  });
}

// ponytail: a date filter keeps the documents whose doc.json date (YYYY-MM-DD) lies within it, bounds included — it
// narrows docIds; a document without a date is left out by any date filter
function datedDocs(project: string, opts: SearchInput): string[] | undefined {
  if (!opts.dateFrom && !opts.dateTo) return opts.docIds;
  const within = (date: string) =>
    !!date && (!opts.dateFrom || date >= opts.dateFrom) && (!opts.dateTo || date <= opts.dateTo);
  const ids = (opts.docIds?.length ? opts.docIds : docIds(project)).filter((id) => {
    try {
      return within(readDoc(project, id).date ?? "");
    } catch {
      return false;
    }
  });
  return ids;
}

export async function search(project: string, query: string, opts: SearchInput = {}): Promise<SearchHit[]> {
  const docs = datedDocs(project, opts);
  if (docs && !docs.length) return [];
  const scoped = { ...opts, ...(docs ? { docIds: docs } : {}) };
  const { hits, settings } = await ranked(project, query, scoped);
  const top = hits.map(({ chunk: c, score, lexical, why }) =>
    hitOf(project, c, score, { ...(lexical ? { degraded: true } : {}), ...(why ? { why } : {}) }),
  );
  const expand = opts.expand ?? settings.expand;
  return [...top, ...expandHits(project, hits, expand, { ...scoped, project })];
}
