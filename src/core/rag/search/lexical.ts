import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { chunksByRowid } from "../db.ts";
import { expand, type GlossaryEntry, glossaryOf } from "../glossary.ts";
import { fold, frenchTokens, STOP_WORDS, stemWord } from "../stem-fr.ts";
import { keep, type SearchOpts } from "./filter.ts";

export const CANDIDATES = 50;
export const BM25_WEIGHTS = [1, 1, 5];

export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

const plain = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const phrase = (tokens: string[]) => `"${tokens.join(" ")}"`;
const searchable = (folded: string) => !STOP_WORDS.has(folded) && (folded.length > 1 || /\d/.test(folded));
const isCode = (raw: string) => /_/.test(raw) || (/\d/.test(raw) && /\p{L}/u.test(raw));

// ponytail: exact forms query the unicode61 columns (header, text, codes), stems the stemmed column; codes and ids stay
// exact phrases; glossary expansions are added as phrases in both
export function ftsQuery(query: string, glossary: GlossaryEntry[] = []): string {
  const exact: string[] = [];
  const stems: string[] = [];
  for (const raw of query.split(/\s+/)) {
    if (!raw) continue;
    if (isCode(raw)) {
      const parts = plain(raw);
      if (parts.length) exact.push(phrase(parts));
      continue;
    }
    for (const t of plain(raw)) if (searchable(t)) exact.push(phrase([t]));
    for (const t of frenchTokens(raw)) if (searchable(fold(t))) stems.push(phrase([fold(stemWord(t))]));
  }
  for (const form of expand(glossary, query)) {
    const parts = plain(form);
    if (!parts.length) continue;
    exact.push(phrase(parts));
    stems.push(phrase(frenchTokens(form).map((t) => fold(stemWord(t)))));
  }
  const ex = [...new Set(exact)];
  const st = [...new Set(stems)];
  const sides = [
    ex.length ? `{header text codes} : (${ex.join(" OR ")})` : "",
    st.length ? `stem : (${st.join(" OR ")})` : "",
  ];
  return sides.filter(Boolean).join(" OR ");
}

export function bm25Weights(given?: number[]): [number, number, number, number] {
  const w = BM25_WEIGHTS.map((d, i) => (Number.isFinite(given?.[i]) ? Number(given?.[i]) : d));
  const stem = given?.[3];
  return [w[0], w[1], w[2], Number.isFinite(stem) ? Number(stem) : w[1]];
}

function projectOfIndex(db: DatabaseSync): string | null {
  const file = db.location();
  if (!file) return null;
  let dir = dirname(file);
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "project.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export function bm25(db: DatabaseSync, query: string, opts: SearchOpts): number[] {
  const project = projectOfIndex(db);
  const q = ftsQuery(query, project ? glossaryOf(project) : []);
  if (!q) return [];
  const candidates = opts.retrieval?.candidates ?? CANDIDATES;
  const rows = db
    .prepare("select rowid from chunks_fts where chunks_fts match ? order by bm25(chunks_fts, ?, ?, ?, ?) limit ?")
    .all(q, ...bm25Weights(opts.retrieval?.bm25Weights), candidates * 4) as { rowid: number }[];
  const ids = rows.map((r) => Number(r.rowid));
  const byId = chunksByRowid(db, ids);
  return ids.filter((id) => keep(byId.get(id), opts)).slice(0, candidates);
}
