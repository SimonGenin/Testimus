import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { UserError } from "../../command.ts";
import { docDir, readDocMd, readFigures } from "../../lib/docs.ts";
import { indexRunState } from "../../lib/docs-index.ts";
import { loadMsSoFar, recordPerf } from "../../lib/models-perf.ts";
import { readProject } from "../../lib/project.ts";
import type { RetrievalSettings, SearchHit } from "../../types.ts";
import { activeModels } from "../activation.ts";
import { docFigures } from "../chunk.ts";
import { type ChunkRow, chunkCount, chunksByRowid, indexFile, nearest, toChunk, withDb } from "../db.ts";
import { embedWith, rerankFor, rerankWith } from "../embed.ts";
import { spaceOf } from "../fingerprint.ts";
import { keep, type RetrievalOverride, type SearchOpts } from "./filter.ts";
import { bm25 } from "./lexical.ts";
import { type VectorResult, vector } from "./vector.ts";

export type { RetrievalOverride, SearchMode, SearchOpts } from "./filter.ts";

const RRF_K = 60;

export const RETRIEVAL_DEFAULTS: RetrievalSettings = {
  candidates: 50,
  rrfK: RRF_K,
  bm25Weights: [1, 1, 5],
  rerank: { top: 30, mode: "topk" },
  expand: "none",
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

export function retrievalSettings(
  project: string,
  override?: RetrievalOverride,
  pack?: RetrievalOverride,
): RetrievalSettings {
  const fromProject = existsSync(join(project, "project.json")) ? readProject(project).rag.retrieval : undefined;
  return mergeRetrieval(mergeRetrieval(mergeRetrieval(RETRIEVAL_DEFAULTS, pack), fromProject), override);
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
  if (!space?.complete) return { ids: [], degraded: `No complete vectors for ${m.entry.id}: run its index first.` };
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

export function rrf(lists: number[][], k = RRF_K): [number, number][] {
  const score = new Map<number, number>();
  for (const list of lists) for (const [i, id] of list.entries()) score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1));
  return [...score].sort((a, b) => b[1] - a[1]);
}

function figureFile(project: string, c: ChunkRow): string | undefined {
  if (c.kind !== "figure") return undefined;
  const md = existsSync(join(docDir(project, c.docId), "doc.md")) ? readDocMd(project, c.docId) : "";
  const f = docFigures(md, readFigures(project, c.docId)).find((x) => x.anchor === c.anchor);
  return f?.file ? `docs/${c.docId}/${f.file}` : undefined;
}

// ponytail: `degraded` is every fallback this search took (vectors, reranker) — rag.eval lists it in its warnings;
// `lexical` marks the BM25-only fallback that rag.search flags on each hit
export type Ranked = { chunk: ChunkRow; score: number; degraded?: string; lexical?: true };

export type Expand = RetrievalSettings["expand"];
type SearchLog = (level: "info" | "warn", message: string) => void;
type SearchInput = SearchOpts & { expand?: Expand; log?: SearchLog };

export async function searchChunks(
  project: string,
  query: string,
  opts: SearchOpts & { log?: SearchLog } = {},
): Promise<Ranked[]> {
  return (await ranked(project, query, opts)).hits;
}

async function ranked(
  project: string,
  query: string,
  opts: SearchOpts & { log?: SearchLog },
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
    let degraded: string | null = null;
    if (mode !== "vector") {
      const t = performance.now();
      const ids = bm25(db, query, o);
      recordPerf({ at: "", op: "search.bm25", items: ids.length, ms: Math.round(performance.now() - t) });
      lists.push(ids);
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
      lists.push(v.ids);
      degraded = v.degraded;
    }
    // ponytail: vectors an index run is still embedding are its work in progress — said as such, not as a problem
    const building = !!degraded && !opts.dbFile && !!indexRunState(project);
    if (building) degraded = "An index run is under way: search matches words until it ends.";
    let ranked = rrf(lists, settings.rrfK);
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
    const hits = ranked.slice(0, cut).map(
      ([id, score]): Ranked => ({
        chunk: byId.get(id) as ChunkRow,
        score,
        ...(why ? { degraded: why } : {}),
        ...(degraded ? { lexical: true as const } : {}),
      }),
    );
    recordPerf({
      at: "",
      op: "search.total",
      items: hits.length,
      ms: Math.round(performance.now() - t0 - (loadMsSoFar() - l0)),
    });
    return { hits, settings };
  });
}

const hitOf = (project: string, c: ChunkRow, score: number, extra: Partial<SearchHit> = {}): SearchHit => {
  const figure = figureFile(project, c);
  return {
    docId: c.docId,
    anchor: c.anchor,
    path: c.path,
    text: c.text,
    header: c.header,
    score,
    kind: c.kind,
    ...(figure ? { figure } : {}),
    ...extra,
  };
};

const parentOf = (n: string) => n.split(".").slice(0, -1).join(".");

// ponytail: expansion follows the document's own structure, never a model — the parent section, the section a figure
// sits in, and (graph) the sections the hit cross-references or amends; added after the k hits, each passage once,
// flagged `via`
function expandHits(project: string, hits: Ranked[], expand: Expand, opts: SearchOpts): SearchHit[] {
  if (expand === "none" || !hits.length) return [];
  return withDb(opts.dbFile ?? indexFile(project), (db) => {
    const sectionChunk = db.prepare(
      "select * from chunks where doc_id = ? and (id = ? or id = ?) order by rowid limit 1",
    );
    const linked = db.prepare("select dst from edges where src = ? and kind in ('refers', 'amends')");
    const seen = new Set(hits.map((h) => `${h.chunk.docId}#${h.chunk.anchor}`));
    const out: SearchHit[] = [];
    const addSection = (ref: string, score: number, via: "section" | "graph") => {
      const m = ref.match(/^([^#]+)#(§.+)$/);
      if (!m || seen.has(ref)) return;
      const raw = sectionChunk.get(m[1], ref, `${ref}~1`) as Parameters<typeof toChunk>[0] | undefined;
      const c = raw ? toChunk(raw) : undefined;
      if (!keep(c, opts)) return;
      seen.add(ref);
      out.push(hitOf(project, c, score, { via }));
    };
    for (const { chunk: c, score } of hits) {
      const n = c.path.split(" > ").pop() ?? "";
      if (c.kind === "section" && c.anchor.startsWith("§") && parentOf(n))
        addSection(`${c.docId}#§${parentOf(n)}`, score, "section");
      if (c.kind !== "section" && n) addSection(`${c.docId}#§${n}`, score, "section");
      if (expand !== "graph" || c.kind !== "section") continue;
      for (const r of linked.all(`${c.docId}#${c.anchor}`) as { dst: string }[]) addSection(r.dst, score, "graph");
    }
    return out;
  });
}

export async function search(project: string, query: string, opts: SearchInput = {}): Promise<SearchHit[]> {
  const { hits, settings } = await ranked(project, query, opts);
  const top = hits.map(({ chunk: c, score, lexical }) => hitOf(project, c, score, lexical ? { degraded: true } : {}));
  const expand = opts.expand ?? settings.expand;
  return [...top, ...expandHits(project, hits, expand, { ...opts, project })];
}
