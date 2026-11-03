import { STOP_WORDS, stemWord } from "../rag/stem-fr.ts";
import type { Query } from "./query.ts";

export type Mark = [number, number];
export type Token = { at: number; end: number; word: string };
export type Field = { name: string; text: string; folded: string; tokens: Token[]; w: number; step?: number };
export type Doc = { fields: Field[] };
export type Corpus<T extends Doc> = { docs: T[]; vocab: Map<string, string> };

// ponytail: folded one character at a time, so an offset in the folded text is the same offset in the text — the
// marks found on one land on the other
export function foldKeep(text: string): string {
  let out = "";
  for (const c of text) {
    const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === c.length ? f : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
  }
  return out;
}

export function field(name: string, text: string, w: number, step?: number): Field {
  const folded = foldKeep(text);
  const tokens: Token[] = [];
  for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu))
    tokens.push({ at: m.index, end: m.index + m[0].length, word: m[0] });
  return { name, text, folded, tokens, w, ...(step === undefined ? {} : { step }) };
}

export function corpus<T extends Doc>(docs: T[]): Corpus<T> {
  const vocab = new Map<string, string>();
  for (const d of docs)
    for (const f of d.fields) for (const t of f.tokens) if (!vocab.has(t.word)) vocab.set(t.word, stemWord(t.word));
  return { docs, vocab };
}

export const EXACT = 1;
export const STEM = 0.9;
export const PREFIX = 0.75;
export const FUZZY = 0.6;

export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      low = Math.min(low, v);
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

export const isCode = (raw: string) =>
  /[_\d]/.test(raw) || /[\p{L}\p{N}][-#§:.][\p{L}\p{N}]/u.test(raw) || /^§/.test(raw);

// ponytail: a term is a word (matched on the vocabulary: same word, same French stem, a prefix while typing, one or
// two typos) or a code (a key, a code, a section: matched as it is written, inside the text)
type Term =
  | { kind: "word"; raw: string; levels: Map<string, number> }
  | { kind: "code"; raw: string; needle: string }
  | { kind: "phrase"; raw: string; needle: string };

export type Compiled = { terms: Term[]; exclude: Term[] };

function wordTerm(raw: string, vocab: Map<string, string>, last: boolean): Term | null {
  const w = foldKeep(raw)
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
  if (!w) return null;
  if (isCode(w) || /[^\p{L}\p{N}]/u.test(w)) return { kind: "code", raw, needle: w };
  const stem = stemWord(w);
  const levels = new Map<string, number>();
  const typos = w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0;
  const minPrefix = last ? 2 : 3;
  for (const [word, s] of vocab) {
    let level = 0;
    if (word === w) level = EXACT;
    else if (s === stem && stem.length >= 3) level = STEM;
    else if (w.length >= minPrefix && word.startsWith(w)) level = PREFIX;
    else if (typos && distance(w, word, typos) <= typos) level = FUZZY;
    if (level) levels.set(word, level);
  }
  return { kind: "word", raw, levels };
}

export function compile(q: Query, vocab: Map<string, string>): Compiled {
  const words = q.terms.filter((t) => !STOP_WORDS.has(foldKeep(t)) || q.terms.length === 1);
  const terms = [
    ...words.map((t, i) => wordTerm(t, vocab, i === words.length - 1 && !/\s$/.test(q.raw))),
    ...q.phrases.map((p): Term => ({ kind: "phrase", raw: p, needle: foldKeep(p).replace(/\s+/g, " ") })),
  ].filter((t): t is Term => !!t);
  const exclude = q.exclude
    .map((e): Term | null =>
      e.includes(" ") ? { kind: "phrase", raw: e, needle: foldKeep(e) } : wordTerm(e, vocab, false),
    )
    .filter((t): t is Term => !!t)
    .map((t) => (t.kind === "word" ? { ...t, levels: new Map([...t.levels].filter(([, l]) => l >= STEM)) } : t));
  return { terms, exclude };
}

function substrings(text: string, needle: string): Mark[] {
  const out: Mark[] = [];
  if (!needle) return out;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length))
    out.push([at, at + needle.length]);
  return out;
}

export function termIn(t: Term, f: Field): { level: number; marks: Mark[] } {
  if (t.kind !== "word") {
    const marks = substrings(t.kind === "phrase" ? f.folded.replace(/\s/g, " ") : f.folded, t.needle);
    return { level: marks.length ? EXACT : 0, marks };
  }
  let level = 0;
  const marks: Mark[] = [];
  for (const tok of f.tokens) {
    const l = t.levels.get(tok.word);
    if (!l) continue;
    level = Math.max(level, l);
    marks.push([tok.at, tok.end]);
  }
  return { level, marks };
}

export type Scored<T> = {
  doc: T;
  score: number;
  matched: number;
  best: Field;
  marks: Mark[];
  fieldMarks: Map<Field, Mark[]>;
};

// ponytail: each term takes its best field (weight × how well it matched); every term must match, except when
// none does — then the docs that match most terms come, ranked lower; a doc where all terms meet in one place
// (one step, the summary) ranks above one where they are spread
export function score<T extends Doc>(doc: T, c: Compiled): Scored<T> | null {
  if (!c.terms.length) return null;
  for (const t of c.exclude) if (doc.fields.some((f) => termIn(t, f).level)) return null;
  let total = 0;
  let matched = 0;
  const fieldMarks = new Map<Field, Mark[]>();
  const place = new Map<string, number>();
  for (const t of c.terms) {
    let best = 0;
    for (const f of doc.fields) {
      const r = termIn(t, f);
      if (!r.level) continue;
      fieldMarks.set(f, [...(fieldMarks.get(f) ?? []), ...r.marks]);
      best = Math.max(best, r.level * f.w);
      const p = f.step === undefined ? f.name : `step ${f.step}`;
      place.set(p, (place.get(p) ?? 0) + r.level * f.w);
    }
    if (best) matched++;
    total += best;
  }
  if (!matched) return null;
  let bestField: Field | null = null;
  let bestPlace = -1;
  for (const [f, marks] of fieldMarks) {
    const p = place.get(f.step === undefined ? f.name : `step ${f.step}`) ?? 0;
    const v = p * 10 + new Set(marks.map((m) => m[0])).size;
    if (v > bestPlace) {
      bestPlace = v;
      bestField = f;
    }
  }
  const together = Math.max(...place.values()) >= total * 0.999 && c.terms.length > 1 ? 1.25 : 1;
  const f = bestField as Field;
  return {
    doc,
    score: total * together * (matched / c.terms.length) ** 2,
    matched,
    best: f,
    marks: merge(fieldMarks.get(f) ?? []),
    fieldMarks,
  };
}

export function search<T extends Doc>(c: Compiled, docs: T[]): Scored<T>[] {
  const all = docs.map((d) => score(d, c)).filter((s): s is Scored<T> => !!s);
  const full = all.filter((s) => s.matched === c.terms.length);
  const pool = full.length ? full : all.filter((s) => s.matched * 2 >= c.terms.length);
  return pool.sort((a, b) => b.score - a.score);
}

export function merge(marks: Mark[]): Mark[] {
  const sorted = [...marks].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Mark[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else out.push([m[0], m[1]]);
  }
  return out;
}

// ponytail: a window of the text around its first mark, cut on spaces, with the marks moved into it
export function snippet(text: string, marks: Mark[], size = 160): { text: string; marks: Mark[] } {
  const flat = text.replace(/\s/g, " ");
  if (flat.length <= size) return { text: flat, marks };
  const first = marks[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.round(size / 3));
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    start = space >= 0 && space < first ? space + 1 : start;
  }
  let end = Math.min(flat.length, start + size);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    end = space > start + size / 2 ? space : end;
  }
  const pre = start > 0 ? "…" : "";
  const post = end < flat.length ? "…" : "";
  const shift = pre.length - start;
  return {
    text: `${pre}${flat.slice(start, end)}${post}`,
    marks: marks.filter(([a, b]) => a >= start && b <= end).map(([a, b]): Mark => [a + shift, b + shift]),
  };
}
