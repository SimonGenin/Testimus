import type { SearchWhy } from "../../types.ts";
import type { ChunkRow } from "../db.ts";
import { plain, type QueryTerms, stemsOf } from "./lexical.ts";

function has(hay: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((n, j) => hay[i + j] === n)) return true;
  return false;
}

// ponytail: why a passage came — its rank by the words and by the model (1 = first), the reranker's score, and which
// forms of the query its text holds: a word as written (accents and case aside), another form of it (its French
// stem), a synonym or glossary form (« TK → télécommande »), an indexed word one letter from a typo
export function explainHit(
  terms: QueryTerms,
  c: ChunkRow,
  ranks: { words: number | null; meaning: number | null; reranker: number | null },
): SearchWhy {
  const text = `${c.header}\n${c.text}`;
  const tokens = plain(text);
  const stems = stemsOf(text);
  const present = (form: string) => has(tokens, plain(form)) || has(stems, stemsOf(form));
  const matched = terms.exact.filter((p) => has(tokens, p)).map((p) => p.join(" "));
  const asWritten = new Set(matched.flatMap((m) => stemsOf(m)));
  const stemOnly = terms.stems.filter((s) => has(stems, s) && !asWritten.has(s.join(" "))).map((s) => s.join(" "));
  return {
    ...ranks,
    matched: [...new Set(matched)],
    stems: [...new Set(stemOnly)],
    synonyms: terms.expansions.filter((e) => present(e.to)).map((e) => `${e.from} → ${e.to}`),
    typos: terms.typos.filter((t) => present(t.to)).map((t) => `${t.from} → ${t.to}`),
  };
}
