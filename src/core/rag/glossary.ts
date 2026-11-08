import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../lib/hash.ts";
import { readProject } from "../lib/project.ts";
import { fold, frenchTokens, STOP_WORDS, stemWord } from "./stem-fr.ts";

export type GlossaryEntry = { abbr: string; long: string; source: string };

const TITLE = /acronyme|abr[ée]viation|glossaire|sigle/i;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const DEFINITION_LINE = /^\s*(?:[-*+•]\s+)?(.{1,30}?)\s*(?:\s:\s*|:\s+|\s[–—-]\s+|\t+|\s=\s+)(.+)$/;

function clean(cell: string): string {
  return cell
    .replace(/\\\|/g, "|")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAbbr(abbr: string): boolean {
  if (!abbr || abbr.length > 25 || abbr.split(" ").length > 4 || !/^[\p{L}\p{N}]/u.test(abbr)) return false;
  const upper = abbr.match(/\p{Lu}/gu)?.length ?? 0;
  return upper >= 2 || (abbr.length <= 5 && /^\p{Lu}/u.test(abbr));
}

function entriesOf(abbrCell: string, longCell: string, source: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  for (const abbr of clean(abbrCell).split(/\s+\/\s+/))
    for (const meaning of clean(longCell).split(/\s+;\s+/)) {
      const long = meaning
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/[\s.;,]+$/, "")
        .trim();
      if (abbr && long && fold(abbr) !== fold(long)) out.push({ abbr, long, source });
    }
  return out;
}

export function parseGlossary(md: string, docId: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const lines = md.split(/\r?\n/);
  let level = 0;
  let source = docId;
  for (const [i, line] of lines.entries()) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (level && h[1].length <= level) level = 0;
      if (!level && TITLE.test(h[2].replace(/<!--.*?-->/g, ""))) {
        level = h[1].length;
        const anchor = /<!--\s*§\s*(.*?)\s*-->/.exec(h[2]);
        source = anchor ? `${docId}#§${anchor[1]}` : docId;
      }
      continue;
    }
    if (!level || !line.trim()) continue;
    if (line.trimStart().startsWith("|")) {
      if (SEPARATOR_ROW.test(line) || SEPARATOR_ROW.test(lines[i + 1] ?? "")) continue;
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split(/(?<!\\)\|/);
      if (cells.length >= 2 && looksLikeAbbr(clean(cells[0]).split(/\s+\/\s+/)[0]))
        out.push(...entriesOf(cells[0], cells[1], source));
      continue;
    }
    const d = DEFINITION_LINE.exec(line.replace(/\*\*|__|`/g, ""));
    if (d && looksLikeAbbr(clean(d[1]).split(/\s+\/\s+/)[0])) out.push(...entriesOf(d[1], d[2], source));
  }
  return out;
}

type Cached = { mtimeMs: number; size: number; hash: string; entries: GlossaryEntry[] };
const cache = new Map<string, Cached>();

function docGlossary(file: string, docId: string): GlossaryEntry[] {
  const st = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entries;
  const md = readFileSync(file, "utf8");
  const hash = sha256(md);
  const entries = hit?.hash === hash ? hit.entries : parseGlossary(md, docId);
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, hash, entries });
  return entries;
}

export function glossaryOf(project: string): GlossaryEntry[] {
  const all: GlossaryEntry[] = [];
  const own = readProject(project).glossary ?? {};
  for (const [abbr, long] of Object.entries(own)) all.push(...entriesOf(abbr, long, "project.json"));
  const root = join(project, "docs");
  if (existsSync(root))
    for (const e of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(root, e.name, "doc.md");
      if (e.isDirectory() && existsSync(file)) all.push(...docGlossary(file, e.name));
    }
  const seen = new Set<string>();
  return all.filter((g) => {
    const key = `${fold(g.abbr)}\n${fold(g.long)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const rawTokens = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const contentStems = (text: string) =>
  frenchTokens(text)
    .filter((t) => !STOP_WORDS.has(fold(t)))
    .map(stemWord);

function contains<T>(hay: T[], needle: T[], eq: (a: T, b: T) => boolean): boolean {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((n, j) => eq(hay[i + j], n))) return true;
  return false;
}

function sameAbbr(abbr: string): (token: string, part: string) => boolean {
  const loose = rawTokens(abbr).join("").length >= 3;
  return (token, part) =>
    token === part || (loose && !STOP_WORDS.has(fold(token)) && fold(token) === fold(part) && token.length > 0);
}

export type Expansion = { from: string; to: string; source: string };

const foundIn = (raw: string[], stems: string[], term: string) =>
  contains(raw, rawTokens(term), sameAbbr(term)) ||
  (!looksLikeAbbr(term) && contains(stems, contentStems(term), (a, b) => a === b));

// ponytail: an acronym is found case-sensitively unless it has 3 letters or more (« IL » is not « il »); a long form
// is found by its stems, stop words aside; a one-letter acronym is never added (« D » would match every « d' »). A
// synonym group of the project (rag.retrieval.synonyms) works both ways: any member found brings the others, a word
// by its stems, an acronym as an acronym
export function expansions(glossary: GlossaryEntry[], text: string, synonyms: string[][] = []): Expansion[] {
  const raw = rawTokens(text);
  const stems = contentStems(text);
  const out: Expansion[] = [];
  for (const g of glossary) {
    if (contains(raw, rawTokens(g.abbr), sameAbbr(g.abbr))) out.push({ from: g.abbr, to: g.long, source: g.source });
    if (
      fold(g.abbr).replace(/[^\p{L}\p{N}]/gu, "").length >= 2 &&
      contains(stems, contentStems(g.long), (a, b) => a === b)
    )
      out.push({ from: g.long, to: g.abbr, source: g.source });
  }
  for (const group of synonyms) {
    const from = group.find((t) => foundIn(raw, stems, t));
    if (from) for (const to of group) if (to !== from) out.push({ from, to, source: "synonym" });
  }
  const seen = new Set<string>([fold(text.trim())]);
  return out.filter((e) => {
    const k = fold(e.to);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function expand(glossary: GlossaryEntry[], text: string, synonyms: string[][] = []): string[] {
  return expansions(glossary, text, synonyms).map((e) => e.to);
}

export function projectSynonyms(project: string): string[][] {
  return readProject(project).rag.retrieval?.synonyms ?? [];
}

export function expandTerm(project: string, term: string): string[] {
  return [term, ...expand(glossaryOf(project), term, projectSynonyms(project))];
}
