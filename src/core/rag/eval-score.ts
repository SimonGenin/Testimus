import type { Behavior, EvidenceRole } from "../types.ts";
import { normalizeAnchor, normalizeRef } from "./anchors.ts";
import type { ChunkRow } from "./db.ts";

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

type ChunkKey = Pick<ChunkRow, "docId" | "anchor" | "figureIds">;

export function hitMatches(c: ChunkKey, expected: string): boolean {
  const m = expected.match(/^([^#]+)#(.+)$/);
  if (!m || m[1] !== c.docId) return false;
  const a = normalizeAnchor(m[2]);
  if (c.anchor === a) return true;
  return a.startsWith("fig:") && c.figureIds.includes(a.slice(4));
}

export type Item = { ref: string; chunks: ChunkKey[] };

export function itemMatches(item: Item, evidence: string): boolean {
  return normalizeRef(item.ref) === normalizeRef(evidence) || item.chunks.some((c) => hitMatches(c, evidence));
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
      const key = normalizeRef(i.ref);
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
