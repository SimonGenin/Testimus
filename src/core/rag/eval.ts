import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { sha256 } from "../lib/hash.ts";
import { catalogEntry } from "../lib/models-catalog.ts";
import { readProject, writeJson } from "../lib/project.ts";
import type { Behavior, EvidenceRole, ModelKind, ResolvedModel, RetrievalSettings } from "../types.ts";
import { activeModels, queryTaskOf, resolveModel } from "./activation.ts";
import { allChunks, type ChunkRow, getSpace, indexFile, openDb } from "./db.ts";
import { indexProject } from "./indexer.ts";
import { mentions } from "./mentions.ts";
import { related } from "./related.ts";
import {
  type Ranked,
  type RetrievalOverride,
  retrievalSettings,
  rrf,
  type SearchMode,
  searchChunks,
} from "./search/hybrid.ts";
import { normalizeAnchor } from "./search/passage.ts";

export const APP_VERSION = (
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

export const KS = [10, 20, 50];
export const ROLES: EvidenceRole[] = [
  "exception",
  "amendment",
  "contradiction",
  "rule",
  "condition",
  "definition",
  "figure",
];
export const POLICIES = ["search", "search+graph"] as const;
export type PolicyName = (typeof POLICIES)[number];
export const MENTIONS_PAGES = 10;

// ponytail: the graph tools are filled by another phase; tests swap them here
export const graph = { related, mentions };

export type BehaviorSet = {
  file: string;
  hash: string;
  behaviors: Behavior[];
};

const evidenceSchema = z.object({
  ref: z.string().regex(/^[^#\s]+#\S/, "docId#anchor"),
  role: z.enum(["definition", "rule", "condition", "exception", "amendment", "contradiction", "figure"]),
  must: z.boolean().default(true),
});
const behaviorSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  queries: z.array(z.string().min(1)).default([]),
  evidence: z.array(evidenceSchema).min(1),
  category: z.string().optional(),
  validated: z.boolean().optional(),
});
export function readBehaviors(file: string): BehaviorSet {
  if (!existsSync(file))
    throw new UserError(
      `No behavior set at ${file}.`,
      "A pack is measured on Testimus's reference document (testimus models measure <pack>); this project's own set goes in eval/behaviors.jsonl.",
    );
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
  const behaviors: Behavior[] = [];
  for (const [i, l] of raw.split(/\r?\n/).entries()) {
    if (!l.trim()) continue;
    const where = `${file} line ${i + 1}`;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch {
      throw new UserError(`${where} is not JSON.`, "One JSON object per line.");
    }
    const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join(".") || "line"}: ${x.message}`).join("; ");
    if (!o || typeof o !== "object" || !("evidence" in o))
      throw new UserError(`${where} needs a question and evidence.`, "See the rag-eval skill.");
    const r = behaviorSchema.safeParse(o);
    if (!r.success) throw new UserError(`${where}: ${issues(r.error)}.`, "See the rag-eval skill for the format.");
    if (!r.data.evidence.some((e) => e.must))
      throw new UserError(`${where}: no evidence has must: true.`, "Mark the evidence a test cannot do without.");
    behaviors.push(r.data);
  }
  const seen = new Set<string>();
  for (const b of behaviors) {
    if (seen.has(b.id))
      throw new UserError(`${file}: behavior id ${b.id} appears twice.`, "Give each line its own id.");
    seen.add(b.id);
  }
  if (!behaviors.length) throw new UserError(`${file} holds no behavior.`, "See the rag-eval skill.");
  return { file, hash: sha256(raw.replace(/\r\n/g, "\n")).slice(0, 16), behaviors };
}

export function defaultSet(project: string): string {
  return join(project, "eval", "behaviors.jsonl");
}

type ChunkKey = Pick<ChunkRow, "docId" | "anchor" | "figureIds">;

export function hitMatches(c: ChunkKey, expected: string): boolean {
  const m = expected.match(/^([^#]+)#(.+)$/);
  if (!m || m[1] !== c.docId) return false;
  const a = normalizeAnchor(m[2]);
  if (c.anchor === a) return true;
  return a.startsWith("fig:") && c.figureIds.includes(a.slice(4));
}

function refKey(ref: string): string {
  const m = ref.match(/^([^#]+)#(.+)$/);
  return m ? `${m[1]}#${normalizeAnchor(m[2])}` : ref;
}

export type Item = { ref: string; chunks: ChunkKey[] };

export function itemMatches(item: Item, evidence: string): boolean {
  return refKey(item.ref) === refKey(evidence) || item.chunks.some((c) => hitMatches(c, evidence));
}

export function chunkResolver(chunks: ChunkKey[]): (ref: string) => Item {
  const byDoc = new Map<string, ChunkKey[]>();
  for (const c of chunks) byDoc.set(c.docId, [...(byDoc.get(c.docId) ?? []), c]);
  return (ref) => {
    const m = ref.match(/^([^#]+)#(.+)$/);
    if (!m) return { ref, chunks: [] };
    const a = normalizeAnchor(m[2]);
    const of = (byDoc.get(m[1]) ?? []).filter(
      (c) => c.anchor === a || (a.startsWith("fig:") && c.figureIds.includes(a.slice(4))),
    );
    return { ref, chunks: of };
  };
}

export type Retrieval = {
  ranked: { item: Item; chars: number }[];
  expansion?: Map<string, { items: Item[]; chars: number }>;
  extra?: { items: Item[]; chars: number };
};
export type AtK = { recall: number; complete: boolean; precision: number; chars: number; items: number };
export type BehaviorScore = {
  atK: Record<string, AtK>;
  roles: Record<string, { n: number; found: Record<string, number> }>;
  found: Record<string, string[]>;
  ndcg10: number;
  mrr: number;
  rank: number | null;
};

export function scoreBehavior(b: Behavior, r: Retrieval, ks: number[] = KS, mrrK = 10): BehaviorScore {
  const must = b.evidence.filter((e) => e.must).map((e) => e.ref);
  const atK: Record<string, AtK> = {};
  const found: Record<string, string[]> = {};
  const roles: BehaviorScore["roles"] = {};
  for (const e of b.evidence) roles[e.role] ??= { n: 0, found: {} };
  for (const e of b.evidence) roles[e.role].n++;
  for (const k of ks) {
    const top = r.ranked.slice(0, k);
    const set = new Map<string, Item>();
    const add = (i: Item) => {
      const key = refKey(i.ref);
      const had = set.get(key);
      set.set(key, had ? { ref: had.ref, chunks: [...had.chunks, ...i.chunks] } : i);
    };
    let chars = 0;
    for (const t of top) {
      add(t.item);
      chars += t.chars;
      const x = r.expansion?.get(t.item.ref);
      if (!x) continue;
      chars += x.chars;
      for (const i of x.items) add(i);
    }
    if (r.extra) {
      chars += r.extra.chars;
      for (const i of r.extra.items) add(i);
    }
    const items = [...set.values()];
    const hit = (ref: string) => items.some((i) => itemMatches(i, ref));
    const got = must.filter(hit);
    const relevant = items.filter((i) => b.evidence.some((e) => itemMatches(i, e.ref))).length;
    found[k] = got;
    atK[k] = {
      recall: got.length / must.length,
      complete: got.length === must.length,
      precision: items.length ? relevant / items.length : 0,
      chars,
      items: items.length,
    };
    for (const role of Object.keys(roles))
      roles[role].found[k] = b.evidence.filter((e) => e.role === role && hit(e.ref)).length;
  }
  const credited = new Set<string>();
  let dcg = 0;
  let rank: number | null = null;
  for (const [i, t] of r.ranked.entries()) {
    const fresh = must.filter((m) => !credited.has(m) && itemMatches(t.item, m));
    if (fresh.length && rank === null) rank = i + 1;
    if (i < 10 && fresh.length) dcg += 1 / Math.log2(i + 2);
    for (const m of fresh) credited.add(m);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(must.length, 10); i++) idcg += 1 / Math.log2(i + 2);
  return {
    atK,
    roles,
    found,
    ndcg10: idcg ? dcg / idcg : 0,
    mrr: rank !== null && rank <= mrrK ? 1 / rank : 0,
    rank,
  };
}

export type Totals = {
  n: number;
  atK: Record<string, { recall: number; complete: number; precision: number; chars: number }>;
  byRole: Record<string, { n: number; recall: Record<string, number> }>;
  ndcg10: number;
  mrr: number;
};

export function totals(scores: BehaviorScore[], ks: number[] = KS): Totals {
  const n = scores.length;
  const mean = (f: (s: BehaviorScore) => number) => (n ? scores.reduce((a, s) => a + f(s), 0) / n : 0);
  const byRole: Totals["byRole"] = {};
  const roles = [...ROLES, ...new Set(scores.flatMap((s) => Object.keys(s.roles)))].filter(
    (r, i, all) => all.indexOf(r) === i && scores.some((s) => s.roles[r]),
  );
  for (const role of roles) {
    const items = scores.reduce((a, s) => a + (s.roles[role]?.n ?? 0), 0);
    byRole[role] = {
      n: items,
      recall: Object.fromEntries(
        ks.map((k) => [k, scores.reduce((a, s) => a + (s.roles[role]?.found[k] ?? 0), 0) / items]),
      ),
    };
  }
  return {
    n,
    atK: Object.fromEntries(
      ks.map((k) => [
        k,
        {
          recall: mean((s) => s.atK[k].recall),
          complete: mean((s) => (s.atK[k].complete ? 1 : 0)),
          precision: mean((s) => s.atK[k].precision),
          chars: mean((s) => s.atK[k].chars),
        },
      ]),
    ),
    byRole,
    ndcg10: mean((s) => s.ndcg10),
    mrr: mean((s) => s.mrr),
  };
}

export type Scores = { n: number; recall5: number; recall10: number; mrr: number };

export function score(ranks: (number | null)[], k: number): Scores {
  const n = ranks.length || 1;
  const within = (r: number | null, cut: number) => r !== null && r <= cut;
  return {
    n: ranks.length,
    recall5: ranks.filter((r) => within(r, 5)).length / n,
    recall10: ranks.filter((r) => within(r, 10)).length / n,
    mrr: ranks.reduce<number>((s, r) => s + (r !== null && r <= k ? 1 / r : 0), 0) / n,
  };
}

const CODE = /[\p{L}\p{N}]*_[\p{L}\p{N}_]+|\b\p{Lu}{2,}[\p{Lu}\p{N}]*\b/gu;

export function mentionTerms(b: Pick<Behavior, "question" | "queries">): string[] {
  const codes = [b.question, ...b.queries].flatMap((t) => t.match(CODE) ?? []);
  const terms = [...new Set([...codes, ...b.queries.map((q) => q.trim())])].filter(Boolean);
  if (terms.length) return terms;
  return [
    ...new Set(
      b.question
        .split(/[^\p{L}\p{N}'-]+/u)
        .map((w) => w.replace(/^\p{L}'/u, ""))
        .filter((w) => w.length >= 6),
    ),
  ].slice(0, 3);
}

const notBuiltYet = (e: unknown) => e instanceof Error && /not built yet/.test(e.message);
const size = (o: unknown) => JSON.stringify(o).length;

export type PolicyReport = {
  name: PolicyName;
  available: boolean;
  reason?: string;
  description: string;
  totals: Totals | null;
  warnings: string[];
};
export type BehaviorReport = {
  id: string;
  question: string;
  category: string | null;
  validated: boolean | null;
  must: number;
  rank: number | null;
  policies: Partial<Record<PolicyName, BehaviorScore>>;
};
export type EvalConfig = {
  chunker: string;
  headers: "claude" | "default";
  space: { id: string; model: string; complete: boolean; fingerprint: unknown } | null;
  embedding: string;
  reranker: string | null;
  mode: SearchMode;
  retrieval: RetrievalSettings;
  ks: number[];
  mrrK: number;
  corpus: string;
  set: { file: string; hash: string; behaviors: number; validated: boolean };
  app: string;
  index: string;
};
export type EvalReport = Scores & {
  version: 2;
  setting: string;
  provisional: boolean;
  config: EvalConfig;
  policies: PolicyReport[];
  behaviors: BehaviorReport[];
  embedding: string;
  reranker: string | null;
  mode: SearchMode;
  k: number;
  index: string;
  report: string;
};

export type EvalOpts = {
  set?: string;
  k?: number;
  embedding?: string;
  reranker?: string | null;
  mode?: SearchMode;
  retrieval?: RetrievalOverride;
  packRetrieval?: RetrievalOverride;
};

function fingerprints(file: string, spaceId: string | undefined) {
  const db = openDb(file);
  try {
    const chunks = db.prepare("select id, hash from chunks order by id").all() as { id: string; hash: string }[];
    const docs = db.prepare("select doc_id, content from docs order by doc_id").all() as {
      doc_id: string;
      content: string;
    }[];
    const space = spaceId ? getSpace(db, spaceId) : undefined;
    // ponytail: the trailing 0 is the superseded flag reports used to hash, kept so their corpus still compares
    return {
      chunker: sha256(chunks.map((c) => `${c.id}\t${c.hash}`).join("\n")).slice(0, 16),
      corpus: sha256(docs.map((d) => `${d.doc_id}\t${sha256(d.content)}\t0`).join("\n")).slice(0, 16),
      space: space
        ? { id: space.id, model: space.modelId, complete: space.complete, fingerprint: space.fingerprint }
        : null,
      chunks: allChunks(db),
    };
  } finally {
    db.close();
  }
}

export function candidateModel(project: string, id: string, kind: ModelKind): ResolvedModel {
  const entry = catalogEntry(id);
  if (!entry || entry.kind !== kind)
    throw new UserError(`Unknown ${kind} ${id}.`, "testimus models catalog lists the ids.");
  const m = resolveModel(entry.id, queryTaskOf(project));
  if (!m)
    throw new UserError(
      `${entry.id} is not installed on this PC.`,
      `Install it first: testimus models pull ${entry.id}.`,
    );
  return m;
}

export async function runEval(project: string, ctx: Ctx, opts: EvalOpts = {}): Promise<EvalReport> {
  const mrrK = opts.k ?? 10;
  const ks = [...new Set([...KS, mrrK])].sort((a, b) => a - b);
  const depth = Math.max(...ks);
  const mode = opts.mode ?? "hybrid";
  const p = readProject(project);
  const set = readBehaviors(resolve(project, opts.set ?? defaultSet(project)));
  const active = await activeModels(project);
  const forcedEmbedding = opts.embedding !== undefined;
  const forcedReranker = opts.reranker !== undefined;
  const embedding = forcedEmbedding ? candidateModel(project, opts.embedding as string, "embedding") : active.embedding;
  const reranker = !forcedReranker
    ? active.reranker
    : opts.reranker === null || opts.reranker === "none" || opts.reranker === "null"
      ? null
      : candidateModel(project, opts.reranker as string, "reranker");
  const settings = retrievalSettings(project, opts.retrieval, forcedEmbedding ? opts.packRetrieval : active.retrieval);
  const live = indexFile(project);

  const indexed =
    mode === "bm25"
      ? await indexProject(project, ctx, { model: null, dbFile: live })
      : forcedEmbedding
        ? await indexProject(project, ctx, { model: embedding, dbFile: live })
        : await indexProject(project, ctx);
  const fp = fingerprints(live, mode === "bm25" ? undefined : indexed.space);
  const resolveRef = chunkResolver(fp.chunks);

  const available: Record<PolicyName, string | null> = { search: null, "search+graph": null };
  const warnings: Record<PolicyName, string[]> = { search: [], "search+graph": [] };
  const relatedMemo = new Map<string, { items: Item[]; chars: number }>();
  const expand = (ref: string): { items: Item[]; chars: number } => {
    const memo = relatedMemo.get(ref);
    if (memo) return memo;
    let out = { items: [] as Item[], chars: 0 };
    try {
      const r = graph.related(project, { ref, depth: 1 });
      out = { items: r.neighbours.map((n) => resolveRef(n.ref)), chars: size(r) };
    } catch (e) {
      if (notBuiltYet(e)) throw e;
      warnings["search+graph"].push(`related ${ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
    relatedMemo.set(ref, out);
    return out;
  };
  const mention = (term: string): { items: Item[]; chars: number } => {
    const out = { items: [] as Item[], chars: 0 };
    for (let page = 1; page <= MENTIONS_PAGES; page++) {
      let m: ReturnType<typeof mentions>;
      try {
        m = graph.mentions(project, { term, page, pageSize: 200 });
      } catch (e) {
        if (notBuiltYet(e)) throw e;
        warnings["search+graph"].push(`mentions "${term}": ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      out.chars += size(m);
      for (const d of m.docs) for (const s of d.sections) out.items.push(resolveRef(s.ref));
      if (page >= m.pages) break;
    }
    return out;
  };

  const degraded = new Set<string>();
  const behaviors: BehaviorReport[] = [];
  for (const [i, b] of set.behaviors.entries()) {
    if (ctx.signal.aborted) throw new Error("Evaluation cancelled.");
    ctx.progress({ message: `Behavior ${i + 1}/${set.behaviors.length}`, done: i, total: set.behaviors.length });
    const queries = [...new Set([b.question, ...b.queries])];
    const lists: Ranked[][] = [];
    for (const q of queries)
      lists.push(
        await searchChunks(project, q, {
          k: depth,
          mode,
          retrieval: settings,
          ...(forcedEmbedding && embedding ? { model: embedding } : {}),
          ...(forcedReranker ? { rerankModel: reranker } : {}),
        }),
      );
    for (const h of lists.flat()) if (h.degraded) degraded.add(h.degraded);
    const byRowid = new Map(lists.flat().map((h) => [h.chunk.rowid, h.chunk]));
    const fused = rrf(
      lists.map((l) => l.map((h) => h.chunk.rowid)),
      settings.rrfK,
    )
      .slice(0, depth)
      .map(([id]) => byRowid.get(id) as ChunkRow);
    const ranked = fused.map((c) => ({
      item: { ref: `${c.docId}#${c.anchor}`, chunks: [c] },
      chars: c.header.length + c.text.length,
    }));
    const policies: BehaviorReport["policies"] = { search: scoreBehavior(b, { ranked }, ks, mrrK) };
    if (available["search+graph"] === null) {
      try {
        const expansion = new Map<string, { items: Item[]; chars: number }>();
        for (const { item } of ranked) expansion.set(item.ref, expand(item.ref));
        const said = mentionTerms(b).map(mention);
        const extra = { items: said.flatMap((s) => s.items), chars: said.reduce((a, s) => a + s.chars, 0) };
        policies["search+graph"] = scoreBehavior(b, { ranked, expansion, extra }, ks, mrrK);
      } catch (e) {
        if (!notBuiltYet(e)) throw e;
        available["search+graph"] = (e as Error).message;
      }
    }
    const must = b.evidence.filter((e) => e.must).map((e) => e.ref);
    const alone = lists[0];
    const at = alone.findIndex((h) => must.some((m) => hitMatches(h.chunk, m)));
    behaviors.push({
      id: b.id,
      question: b.question,
      category: b.category ?? null,
      validated: b.validated ?? null,
      must: must.length,
      rank: at < 0 ? null : at + 1,
      policies,
    });
  }

  const describe: Record<PolicyName, string> = {
    search: `rag.search (${mode}) on the question and each query, fused by RRF (k ${settings.rrfK}); top k passages`,
    "search+graph": `search, then rag.related (depth 1) on the anchor of each of the top k passages, then rag.mentions (all pages, up to ${MENTIONS_PAGES} × 200 sections) on the queries and the codes and acronyms of the question`,
  };
  const policies: PolicyReport[] = POLICIES.map((name) => {
    const off = available[name];
    const scores = behaviors.map((b) => b.policies[name]).filter((s): s is BehaviorScore => !!s);
    return {
      name,
      available: off === null,
      ...(off !== null ? { reason: off } : {}),
      description: describe[name],
      totals: off === null ? totals(scores, ks) : null,
      warnings: [...degraded, ...warnings[name]],
    };
  });
  if (available["search+graph"] !== null) for (const b of behaviors) delete b.policies["search+graph"];

  const provisional = set.behaviors.some((b) => b.validated === false);
  const overridden = opts.retrieval && Object.keys(opts.retrieval).length;
  const embeddingId = embedding?.entry.id ?? "none";
  const rerankerId = reranker?.entry.id ?? null;
  const setting = `${embeddingId}${rerankerId ? `+${rerankerId}` : ""}-${mode}${overridden ? `-r${sha256(JSON.stringify(settings)).slice(0, 6)}` : ""}`;
  const stamp = env.now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const report = join(project, ".testimus", "eval", `${stamp}-${setting}.json`);
  const index = live;
  const out: EvalReport = {
    version: 2,
    setting,
    provisional,
    config: {
      chunker: fp.chunker,
      headers: p.rag.claudeHeaders ? "claude" : "default",
      space: fp.space,
      embedding: embeddingId,
      reranker: rerankerId,
      mode,
      retrieval: settings,
      ks,
      mrrK,
      corpus: fp.corpus,
      set: {
        file: set.file,
        hash: set.hash,
        behaviors: set.behaviors.length,
        validated: !provisional,
      },
      app: APP_VERSION,
      index,
    },
    policies,
    behaviors,
    embedding: embeddingId,
    reranker: rerankerId,
    mode,
    k: mrrK,
    index,
    ...score(
      behaviors.map((b) => b.rank),
      mrrK,
    ),
    report,
  };
  writeJson(report, out);
  return out;
}
