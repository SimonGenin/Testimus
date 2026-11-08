import type { DatabaseSync } from "node:sqlite";

export type Typo = { from: string; to: string };

const MIN_LENGTH = 4;
const PER_WORD = 3;
const MAX_WORDS = 6;

// ponytail: one letter away — one letter changed, added, removed, or two neighbours swapped (Damerau, restricted)
export function oneApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let i = 0;
    while (a[i] === b[i]) i++;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

// ponytail: only a word the index does not hold is a typo (a word it holds is never second-guessed), only words of 4
// letters or more, at most 6 of them and 3 indexed words each, the most frequent first — the variants come from the
// index's own vocabulary (fts5vocab over the header and text columns), never from a list of guesses
export function typoVariants(db: DatabaseSync, words: string[]): Typo[] {
  const asked = [...new Set(words)].filter((w) => w.length >= MIN_LENGTH && /^\p{L}+$/u.test(w));
  if (!asked.length) return [];
  db.exec("create virtual table if not exists temp.chunks_vocab using fts5vocab(main, chunks_fts, col)");
  const known = db.prepare("select 1 from temp.chunks_vocab where term = ? and col in ('header', 'text') limit 1");
  const near = db.prepare(
    "select term, sum(doc) as n from temp.chunks_vocab where col in ('header', 'text') and length(term) between ? and ? group by term",
  );
  const out: Typo[] = [];
  for (const w of asked.filter((x) => !known.get(x)).slice(0, MAX_WORDS)) {
    const rows = near.all(w.length - 1, w.length + 1) as { term: string; n: number }[];
    const close = rows.filter((r) => oneApart(w, r.term)).sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));
    for (const r of close.slice(0, PER_WORD)) out.push({ from: w, to: r.term });
  }
  return out;
}
