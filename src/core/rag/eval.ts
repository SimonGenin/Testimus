import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { sha256 } from "../lib/hash.ts";
import { catalogEntry } from "../lib/models-catalog.ts";
import { readProject, writeJson } from "../lib/project.ts";
import type { ModelKind, ResolvedModel, RetrievalSettings, SpaceFingerprint } from "../types.ts";
import { activeModels, queryTaskOf, resolveModel } from "./activation.ts";
import type { DescribeChunks } from "./chunk.ts";
import { allChunks, type ChunkRow, getSpace, indexFile, withDb } from "./db.ts";
import {
  type BehaviorScore,
  chunkResolver,
  hitMatches,
  type Item,
  KS,
  mentionTerms,
  type Scores,
  score,
  scoreBehavior,
  type Totals,
  totals,
} from "./eval-score.ts";
import { defaultSet, readBehaviors } from "./eval-set.ts";
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

export const APP_VERSION = (
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }
).version;

// ponytail: kept for tests/unit/models-refdoc.test.ts until it imports eval-set.ts (core-rag BESOIN)
export { readBehaviors };

export const POLICIES = ["search", "search+graph"] as const;
export type PolicyName = (typeof POLICIES)[number];
export const MENTIONS_PAGES = 10;

// ponytail: a policy whose tool answers « not built yet » is reported unavailable instead of failing the run; tests
// swap the tools here to prove it (env is no seam for them)
export const graph = { related, mentions };

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
  space: { id: string; model: string; complete: boolean; fingerprint: SpaceFingerprint } | null;
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
  describe?: DescribeChunks;
};

function fingerprints(file: string, spaceId: string | undefined) {
  return withDb(file, (db) => {
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
  });
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

  const headers = opts.describe;
  const indexed =
    mode === "bm25"
      ? await indexProject(project, ctx, { model: null, dbFile: live, describe: headers })
      : forcedEmbedding
        ? await indexProject(project, ctx, { model: embedding, dbFile: live, describe: headers })
        : await indexProject(project, ctx, { describe: headers });
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
