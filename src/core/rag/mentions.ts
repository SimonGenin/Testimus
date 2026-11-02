import { existsSync, statSync } from "node:fs";
import { UserError } from "../command.ts";
import type { Chunk, DocJson } from "../types.ts";
import { chunkDoc, lines, parseSections } from "./chunk.ts";
import { chunksOf, indexFile, openDb } from "./db.ts";
import { expandTerm } from "./glossary.ts";
import { isSuperseded, projectDocs } from "./indexer.ts";
import { evidenceOptions } from "./statements.ts";
import { fold, STOP_WORDS, stemWord } from "./stem-fr.ts";

export type MentionsInput = {
  term: string;
  regex?: boolean;
  stem?: boolean;
  glossary?: boolean;
  docIds?: string[];
  includeSuperseded?: boolean;
  page?: number;
  pageSize?: number;
};
export type MentionSection = {
  ref: string;
  path: string;
  title: string;
  kind: "section" | "figure" | "matrix-row";
  count: number;
  hits: { form: string; context: string }[];
};
export type Mentions = {
  term: string;
  forms: string[];
  total: number;
  sections: number;
  page: number;
  pages: number;
  docs: { docId: string; count: number; sections: MentionSection[] }[];
};

export type CorpusDoc = {
  doc: DocJson;
  md: string;
  superseded: boolean;
  chunks: Chunk[];
  titles: Map<string, string>;
  sections: { anchor: string; title: string; path: string }[];
  position: (anchor: string) => number;
};

const MAX_HITS = 10;
const CONTEXT = 90;

function positions(md: string): (anchor: string) => number {
  const ls = lines(md);
  const at = new Map<string, number>();
  ls.forEach((l, i) => {
    for (const m of l.matchAll(/<!--\s*(§|fig)\s*(\S+?)\s*-->/g)) {
      const key = m[1] === "§" ? `§${m[2]}` : `fig:${m[2]}`;
      if (!at.has(key)) at.set(key, i);
    }
  });
  return (anchor) => {
    const known = at.get(anchor);
    if (known !== undefined) return known;
    const row = anchor.match(/^req:(.+?)@matrix(?:~(\d+))?$/);
    if (row) {
      const n = Number(row[2] ?? 1);
      let seen = 0;
      for (let i = 0; i < ls.length; i++) if (/^\s*\|/.test(ls[i]) && ls[i].includes(row[1]) && ++seen === n) return i;
    }
    return ls.length;
  };
}

const cache = new Map<string, { key: string; docs: CorpusDoc[] }>();

// ponytail: the index's chunks when the document is indexed as it is now, else the same chunks cut from doc.md —
// both paths give the same passages, so the tools answer the same with or without an index (SPEC-RAG P1)
export function corpusDocs(project: string): CorpusDoc[] {
  const docs = projectDocs(project);
  const file = indexFile(project);
  const hasIndex = existsSync(file);
  const key = [hasIndex ? statSync(file).mtimeMs : 0, ...docs.map((d) => `${d.doc.id}:${d.content}`)].join("\n");
  const hit = cache.get(project);
  if (hit?.key === key) return hit.docs;
  const opts = evidenceOptions(project);
  const db = hasIndex ? openDb(file) : null;
  try {
    const indexed = new Map<string, string>();
    if (db)
      for (const r of db.prepare("select doc_id, content from docs").all() as { doc_id: string; content: string }[])
        indexed.set(r.doc_id, r.content);
    const out = docs.map((d): CorpusDoc => {
      const fresh = db && indexed.get(d.doc.id) === d.content;
      const chunks = fresh ? chunksOf(db, d.doc.id) : chunkDoc(d.doc, d.md, d.figures, opts);
      const sections = parseSections(d.md).map((s) => ({ anchor: s.anchor, title: s.title, path: s.path }));
      return {
        doc: d.doc,
        md: d.md,
        superseded: isSuperseded(d.doc),
        chunks,
        titles: new Map(sections.map((s) => [s.anchor, s.title])),
        sections,
        position: positions(d.md),
      };
    });
    cache.set(project, { key, docs: out });
    return out;
  } finally {
    db?.close();
  }
}

export const baseAnchor = (anchor: string) => anchor.replace(/~\d+$/, "");

export function chunkTitle(d: CorpusDoc, c: Chunk): string {
  const a = baseAnchor(c.anchor);
  if (c.kind === "figure") return c.text.split("\n")[0] ?? "";
  if (c.kind === "matrix-row") {
    const traced = c.path.split(" > ").pop() ?? "";
    const t = d.titles.get(`§${traced}`);
    return `${c.reqIds[0] ?? a} (matrix)${t ? ` → ${traced} ${t}` : ""}`;
  }
  return d.titles.get(a) ?? "";
}

type Span = { start: number; end: number };

function foldKeep(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === ch.length ? f : ch.length === ch.toLowerCase().length ? ch.toLowerCase() : ch;
  }
  return out;
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isCode = (w: string) => /_/.test(w) || (/\d/.test(w) && /\p{L}/u.test(w));
const strictCase = (form: string) => /^\p{Lu}{1,2}$/u.test(form.trim());

type Matcher = (text: string, folded: string, tokens: () => Token[]) => Span[];

function phraseMatcher(form: string): Matcher | null {
  const words = form.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const strict = strictCase(form);
  const body = words.map((w) => reEscape(strict ? w : foldKeep(w))).join(String.raw`\s+`);
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}_])${body}(?![\p{L}\p{N}_])`, "gu");
  return (text, folded) =>
    [...(strict ? text : folded).matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

type Token = { start: number; end: number; stem: string; stop: boolean };

const contentStems = (text: string) =>
  [...text.matchAll(/[\p{L}\p{N}]+/gu)]
    .map((m) => m[0].toLowerCase())
    .filter((w) => !STOP_WORDS.has(fold(w)))
    .map(stemWord);

function stemMatcher(form: string): Matcher | null {
  if (/^\p{Lu}+$/u.test(form.trim()) || form.split(/\s+/).some(isCode)) return null;
  const want = contentStems(form);
  if (!want.length) return null;
  return (_text, _folded, tokens) => {
    const content = tokens().filter((t) => !t.stop);
    const out: Span[] = [];
    for (let i = 0; i + want.length <= content.length; i++)
      if (want.every((s, j) => content[i + j].stem === s))
        out.push({ start: content[i].start, end: content[i + want.length - 1].end });
    return out;
  };
}

function regexMatcher(term: string): Matcher {
  let re: RegExp;
  try {
    re = new RegExp(term, "giu");
  } catch {
    try {
      re = new RegExp(term, "gi");
    } catch (e) {
      throw new UserError(
        `Not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`,
        "Write a JavaScript regex, e.g. sectionneurs?\\s+(S|TK), or leave regex off.",
      );
    }
  }
  return (text) =>
    [...text.matchAll(re)].filter((m) => m[0]).map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => {
    const w = m[0].toLowerCase();
    return { start: m.index, end: m.index + m[0].length, stem: stemWord(w), stop: STOP_WORDS.has(fold(w)) };
  });
}

function contextOf(text: string, s: Span): string {
  const lineStart = text.lastIndexOf("\n", s.start - 1) + 1;
  const nl = text.indexOf("\n", s.end);
  const lineEnd = nl < 0 ? text.length : nl;
  const a = Math.max(lineStart, s.start - CONTEXT);
  const b = Math.min(lineEnd, s.end + CONTEXT);
  const cut = (x: string) => x.replace(/\s+/g, " ").trim();
  return `${a > lineStart ? "…" : ""}${cut(text.slice(a, b))}${b < lineEnd ? "…" : ""}`;
}

function spansIn(text: string, matchers: Matcher[]): Span[] {
  const folded = foldKeep(text);
  let toks: Token[] | null = null;
  const tokens = () => {
    toks ??= tokenize(text);
    return toks;
  };
  const all = matchers.flatMap((m) => m(text, folded, tokens)).sort((x, y) => x.start - y.start || y.end - x.end);
  const out: Span[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) continue;
    out.push(s);
  }
  return out;
}

const searchable = (d: CorpusDoc, c: Chunk) => {
  const text = c.text.replace(/\*+/g, "");
  const first = c.kind === "section" && !/~(?!1$)\d+$/.test(c.anchor);
  const title = first ? (d.titles.get(baseAnchor(c.anchor)) ?? "").replace(/\*+/g, "") : "";
  return title ? `${title}\n${text}` : text;
};

export function mentions(project: string, input: MentionsInput): Mentions {
  const term = input.term.trim();
  if (!term) throw new UserError("Nothing to look for: the term is empty.", "Give a word, an id or an acronym.");
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.floor(input.pageSize ?? 50));
  const forms = input.regex ? [term] : input.glossary === false ? [term] : expandTerm(project, term);
  const matchers: Matcher[] = input.regex
    ? [regexMatcher(term)]
    : forms.flatMap((f) => [phraseMatcher(f), input.stem === false ? null : stemMatcher(f)]).filter((m) => !!m);
  const shownForms =
    input.regex || input.stem === false
      ? forms
      : [...new Set(forms.flatMap((f) => (stemMatcher(f) ? [f, `${contentStems(f).join(" ")}*`] : [f])))];

  type Group = MentionSection & { docId: string; pos: number };
  const groups: Group[] = [];
  const perDoc = new Map<string, number>();
  for (const d of corpusDocs(project)) {
    if (d.superseded && !input.includeSuperseded) continue;
    if (input.docIds?.length && !input.docIds.includes(d.doc.id)) continue;
    const byRef = new Map<string, Group>();
    for (const c of d.chunks) {
      const text = searchable(d, c);
      const spans = spansIn(text, matchers);
      if (!spans.length) continue;
      const anchor = baseAnchor(c.anchor);
      const ref = `${d.doc.id}#${anchor}`;
      let g = byRef.get(ref);
      if (!g) {
        g = {
          docId: d.doc.id,
          ref,
          path: c.path,
          title: chunkTitle(d, c),
          kind: c.kind,
          count: 0,
          hits: [],
          pos: d.position(anchor),
        };
        byRef.set(ref, g);
      }
      g.count += spans.length;
      for (const s of spans)
        if (g.hits.length < MAX_HITS) g.hits.push({ form: text.slice(s.start, s.end), context: contextOf(text, s) });
    }
    // ponytail: a section with no text of its own (only sub-sections, or only its matrix) has no chunk — its title
    // is searched all the same
    const chunked = new Set(d.chunks.filter((c) => c.kind === "section").map((c) => baseAnchor(c.anchor)));
    for (const s of d.sections) {
      const ref = `${d.doc.id}#${s.anchor}`;
      if (chunked.has(s.anchor) || byRef.has(ref)) continue;
      const text = s.title.replace(/\*+/g, "");
      const spans = spansIn(text, matchers);
      if (!spans.length) continue;
      byRef.set(ref, {
        docId: d.doc.id,
        ref,
        path: s.path,
        title: s.title,
        kind: "section",
        count: spans.length,
        hits: spans.slice(0, MAX_HITS).map((x) => ({ form: text.slice(x.start, x.end), context: contextOf(text, x) })),
        pos: d.position(s.anchor),
      });
    }
    const list = [...byRef.values()].sort((a, b) => a.pos - b.pos || a.ref.localeCompare(b.ref));
    if (!list.length) continue;
    perDoc.set(
      d.doc.id,
      list.reduce((n, g) => n + g.count, 0),
    );
    groups.push(...list);
  }
  const docOrder = [...perDoc].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  const rank = new Map(docOrder.map((id, i) => [id, i]));
  groups.sort((a, b) => (rank.get(a.docId) ?? 0) - (rank.get(b.docId) ?? 0));
  const slice = groups.slice((page - 1) * pageSize, page * pageSize);
  const docs: Mentions["docs"] = [];
  for (const g of slice) {
    let d = docs[docs.length - 1];
    if (d?.docId !== g.docId) {
      d = { docId: g.docId, count: perDoc.get(g.docId) ?? 0, sections: [] };
      docs.push(d);
    }
    d.sections.push({ ref: g.ref, path: g.path, title: g.title, kind: g.kind, count: g.count, hits: g.hits });
  }
  return {
    term,
    forms: shownForms,
    total: [...perDoc.values()].reduce((a, b) => a + b, 0),
    sections: groups.length,
    page,
    pages: Math.max(1, Math.ceil(groups.length / pageSize)),
    docs,
  };
}
