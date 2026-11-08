import type { DatabaseSync } from "node:sqlite";
import { chunksByRowid } from "../db.ts";
import { type Expansion, expansions, type GlossaryEntry, glossaryOf } from "../glossary.ts";
import { fold, frenchTokens, STOP_WORDS, stemWord } from "../stem-fr.ts";
import { keep, type SearchOpts, scopeSql } from "./filter.ts";
import { type Typo, typoVariants } from "./typos.ts";

export const CANDIDATES = 50;
const BM25_WEIGHTS = [1, 1, 5];

export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

export const plain = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
export const stemsOf = (text: string) => frenchTokens(text).map((t) => fold(stemWord(t)));
const phrase = (tokens: string[]) => `"${tokens.join(" ")}"`;
const searchable = (folded: string) => !STOP_WORDS.has(folded) && (folded.length > 1 || /\d/.test(folded));
const isCode = (raw: string) => /_/.test(raw) || (/\d/.test(raw) && /\p{L}/u.test(raw));

// ponytail: what a query looks for — its words (a code is one phrase of its parts), their French stems, the glossary
// and synonym forms it brings, and the indexed words one letter from a word the index lacks (typos on)
export type QueryTerms = {
  exact: string[][];
  stems: string[][];
  words: string[];
  expansions: Expansion[];
  typos: Typo[];
};

export function queryTerms(
  query: string,
  glossary: GlossaryEntry[] = [],
  synonyms: string[][] = [],
  typos: Typo[] = [],
): QueryTerms {
  const exact: string[][] = [];
  const stems: string[][] = [];
  const plainWords: string[] = [];
  for (const raw of query.split(/\s+/)) {
    if (!raw) continue;
    if (isCode(raw)) {
      const parts = plain(raw);
      if (parts.length) exact.push(parts);
      continue;
    }
    for (const t of plain(raw))
      if (searchable(t)) {
        exact.push([t]);
        plainWords.push(t);
      }
    for (const t of frenchTokens(raw)) if (searchable(fold(t))) stems.push([fold(stemWord(t))]);
  }
  return { exact, stems, words: plainWords, expansions: expansions(glossary, query, synonyms), typos };
}

// ponytail: exact forms query the unicode61 columns (header, text, codes), stems the stemmed column; codes and ids stay
// exact phrases; glossary, synonym and typo forms are added as phrases in both
export function ftsOf(t: QueryTerms): string {
  const exact = t.exact.map(phrase);
  const stems = t.stems.map(phrase);
  for (const form of [...t.expansions.map((e) => e.to), ...t.typos.map((x) => x.to)]) {
    const parts = plain(form);
    if (!parts.length) continue;
    exact.push(phrase(parts));
    stems.push(phrase(stemsOf(form)));
  }
  const ex = [...new Set(exact)];
  const st = [...new Set(stems)];
  const sides = [
    ex.length ? `{header text codes} : (${ex.join(" OR ")})` : "",
    st.length ? `stem : (${st.join(" OR ")})` : "",
  ];
  return sides.filter(Boolean).join(" OR ");
}

export function ftsQuery(query: string, glossary: GlossaryEntry[] = [], synonyms: string[][] = []): string {
  return ftsOf(queryTerms(query, glossary, synonyms));
}

export function bm25Weights(given?: number[]): [number, number, number, number] {
  const w = BM25_WEIGHTS.map((d, i) => (Number.isFinite(given?.[i]) ? Number(given?.[i]) : d));
  const stem = given?.[3];
  return [w[0], w[1], w[2], Number.isFinite(stem) ? Number(stem) : w[1]];
}

// ponytail: the words a query looks for, its glossary and synonyms expansions and its typos — worked out once per
// search, for the word ranking and for its explanation
export function termsOf(db: DatabaseSync, query: string, opts: SearchOpts): QueryTerms {
  const r = opts.retrieval;
  const terms = queryTerms(query, opts.project ? glossaryOf(opts.project) : [], r?.synonyms ?? []);
  return r?.typos ? { ...terms, typos: typoVariants(db, terms.words) } : terms;
}

export function bm25(
  db: DatabaseSync,
  query: string,
  opts: SearchOpts,
  terms: QueryTerms = termsOf(db, query, opts),
): number[] {
  const q = ftsOf(terms);
  if (!q) return [];
  const candidates = opts.retrieval?.candidates ?? CANDIDATES;
  const scope = scopeSql(opts);
  const inScope = scope.where ? ` and rowid in (select rowid from chunks where ${scope.where})` : "";
  const rows = db
    .prepare(
      `select rowid from chunks_fts where chunks_fts match ?${inScope} order by bm25(chunks_fts, ?, ?, ?, ?) limit ?`,
    )
    .all(q, ...scope.args, ...bm25Weights(opts.retrieval?.bm25Weights), candidates * 4) as { rowid: number }[];
  const ids = rows.map((r) => Number(r.rowid));
  const byId = chunksByRowid(db, ids);
  return ids.filter((id) => keep(byId.get(id), opts)).slice(0, candidates);
}
