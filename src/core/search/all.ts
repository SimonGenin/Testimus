import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { docIds, readDoc } from "../lib/docs.ts";
import { indexFile } from "../rag/db.ts";
import { search as passages } from "../rag/search/hybrid.ts";
import { foldKeep } from "../rag/stem-fr.ts";
import {
  awaitsReview,
  type DocJson,
  type SearchKind,
  type SearchMark,
  type SearchMatch,
  type SearchResult,
} from "../types.ts";
import {
  type Compiled,
  type Corpus,
  compile,
  corpus,
  type Doc,
  field,
  isCode,
  merge,
  type Scored,
  search,
  snippet,
  termIn,
} from "./match.ts";
import { KINDS, parseQuery, type Query, testsOnly, wants } from "./query.ts";
import { keepTest, type TestDoc, testsCorpus } from "./tests.ts";
import { nearestTests } from "./vectors.ts";

type SearchAllInput = { query: string; in?: SearchKind[]; k?: number; meaning?: boolean };

const RRF = 60;
const MEANING_SPREAD = 0.15;
const MEANING_MAX = 30;

const stamp = (file: string) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function docsStamp(project: string): string {
  const root = join(project, "docs");
  if (!existsSync(root)) return "";
  return readdirSync(root)
    .map((id) => `${id}:${stamp(join(root, id, "doc.json"))}:${stamp(join(root, id, "doc.md"))}`)
    .join("|");
}

type DocDoc = Doc & { doc: DocJson };
const docCache = new Map<string, { key: string; corpus: Corpus<DocDoc> }>();

function docCorpus(project: string): Corpus<DocDoc> {
  const key = docsStamp(project);
  const hit = docCache.get(project);
  if (hit?.key === key) return hit.corpus;
  const docs: DocDoc[] = [];
  for (const id of docIds(project)) {
    try {
      const doc = readDoc(project, id);
      docs.push({
        doc,
        fields: [
          field("id", `${doc.id} ${doc.code}`, 10),
          field("title", doc.title, 6),
          field("version", `${doc.version} ${doc.kind} ${doc.status}`, 1),
        ],
      });
    } catch {}
  }
  const c = corpus(docs);
  docCache.set(project, { key, corpus: c });
  return c;
}

const marksOf = (s: Scored<Doc>, name: string): SearchMark[] =>
  merge([...s.fieldMarks].filter(([f]) => f.name === name).flatMap(([, m]) => m));

function where(s: Scored<TestDoc>): string | undefined {
  const f = s.best;
  if (f.name === "summary" || f.name === "key") return undefined;
  return f.step === undefined ? f.name[0].toUpperCase() + f.name.slice(1) : `Step ${f.step} · ${f.name}`;
}

function testHit(d: TestDoc, s: Scored<TestDoc> | null, score: number, why: SearchMatch["why"]): SearchMatch {
  const t = d.test;
  const at = s && where(s);
  const cut = at && s ? snippet(s.best.text, s.marks) : null;
  const plain = !s && t.description.trim() ? snippet(t.description, []) : null;
  const shown = cut ?? plain;
  return {
    kind: "test",
    id: d.id,
    title: t.summary || "Untitled",
    titleMarks: s ? marksOf(s as Scored<Doc>, "summary") : [],
    detail: [t.key ?? "no key", t.folder || "/"].join(" · "),
    ...(shown ? { snippet: shown.text, marks: shown.marks } : { marks: [] }),
    ...(at ? { where: at } : {}),
    score,
    why,
    testId: d.id,
    ...(t.key ? { key: t.key } : {}),
    review: t.review,
    awaiting: awaitsReview({ review: t.review, generated: !!t.generatedBy }),
    ...(s?.best.step ? { step: s.best.step } : {}),
  };
}

type Found = { hits: SearchMatch[]; total: number; unembedded: number; note?: string; meaning?: boolean };

async function findTests(project: string, q: Query, c: Compiled | null, k: number, meaning: boolean): Promise<Found> {
  const all = testsCorpus(project);
  const docs = all.docs.filter((d) => keepTest(d, q.filters));
  if (!c) {
    const hits = [...docs].sort((a, b) => b.mtime - a.mtime).map((d) => testHit(d, null, 0, "filter"));
    return { hits: hits.slice(0, k), total: hits.length, unembedded: 0 };
  }
  const lexical = search(c, docs);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const score = new Map<string, { s: number; lex?: Scored<TestDoc>; sem?: boolean }>();
  lexical.forEach((s, i) => {
    score.set(s.doc.id, { s: 2 / (RRF + i + 1), lex: s });
  });
  let unembedded = 0;
  let note: string | undefined;
  let used = false;
  if (meaning) {
    try {
      const kept = docs.filter((d) => !c.exclude.some((t) => d.fields.some((f) => termIn(t, f).level)));
      const n = await nearestTests(project, q.text, kept);
      unembedded = n.unembedded;
      note = n.degraded;
      used = !n.degraded;
      const top = n.ranked[0]?.[1] ?? 0;
      n.ranked
        .filter(([, cos]) => cos >= top - MEANING_SPREAD)
        .slice(0, MEANING_MAX)
        .forEach(([id], i) => {
          const cur = score.get(id) ?? { s: 0 };
          score.set(id, { ...cur, s: cur.s + 1 / (RRF + i + 1), sem: true });
        });
    } catch (e) {
      note = `Search by meaning failed (${e instanceof Error ? e.message : String(e)}): words only.`;
    }
  }
  const hits = [...score]
    .sort((a, b) => b[1].s - a[1].s)
    .map(([id, v]) =>
      testHit(byId.get(id) as TestDoc, v.lex ?? null, v.s, v.lex ? (v.sem ? "both" : "words") : "meaning"),
    );
  return { hits: hits.slice(0, k), total: hits.length, unembedded, ...(note ? { note } : {}), meaning: used };
}

function findDocuments(project: string, q: Query, k: number): Found {
  const all = docCorpus(project);
  const found = search(compile(q, all.vocab), all.docs);
  const hits = found.slice(0, k).map(
    (s): SearchMatch => ({
      kind: "document",
      id: s.doc.doc.id,
      title: s.doc.doc.title || s.doc.doc.id,
      titleMarks: marksOf(s as Scored<Doc>, "title"),
      detail: [s.doc.doc.code || s.doc.doc.id, s.doc.doc.version && `v${s.doc.doc.version}`, s.doc.doc.status]
        .filter(Boolean)
        .join(" · "),
      marks: [],
      score: s.score,
      why: "words",
      docId: s.doc.doc.id,
    }),
  );
  return { hits, total: found.length, unembedded: 0 };
}

const inDocs = (docId: string, q: Query) => {
  const id = foldKeep(docId);
  return !q.filters.doc?.length || q.filters.doc.some((d) => id.includes(d));
};

function docIdsOf(project: string, q: Query): string[] | undefined {
  if (!q.filters.doc?.length) return undefined;
  const root = join(project, "docs");
  return (existsSync(root) ? readdirSync(root) : []).filter((id) => inDocs(id, q));
}

export function marksIn(text: string, q: Query): SearchMark[] {
  const f = field("text", text, 1);
  const c = compile(q, corpus([{ fields: [f] }]).vocab);
  return merge(c.terms.flatMap((t) => termIn(t, f).marks));
}

async function findPassages(project: string, q: Query, k: number, meaning: boolean): Promise<Found> {
  if (!existsSync(indexFile(project))) return { hits: [], total: 0, unembedded: 0 };
  const docIds = docIdsOf(project, q);
  if (docIds && !docIds.length) return { hits: [], total: 0, unembedded: 0 };
  let note: string | undefined;
  const found = await passages(project, q.text, {
    k,
    mode: meaning ? "hybrid" : "bm25",
    expand: "none",
    ...(meaning ? {} : { reranker: null }),
    ...(docIds ? { docIds } : {}),
    log: (_, m) => {
      note = m;
    },
  });
  const excluded = (text: string) => {
    if (!q.exclude.length) return false;
    const f = field("text", text, 1);
    return compile(q, corpus([{ fields: [f] }]).vocab).exclude.some((t) => termIn(t, f).level);
  };
  const hits = found
    .filter((h) => !excluded(h.text))
    .map((h): SearchMatch => {
      const cut = snippet(h.text, marksIn(h.text, q), 200);
      const rest = h.header.split(" — ").slice(1).join(" — ");
      const title =
        (h.path && rest.startsWith(h.path)
          ? `${h.path.split(" > ").pop()} ${rest.slice(h.path.length).trim()}`
          : rest) ||
        h.path ||
        h.anchor;
      return {
        kind: "passage",
        id: `${h.docId}#${h.anchor}`,
        title,
        titleMarks: marksIn(title, q),
        detail: `${h.docId} · ${h.anchor}`,
        snippet: cut.text,
        marks: cut.marks,
        score: h.score,
        why: cut.marks.length ? (meaning ? "both" : "words") : "meaning",
        docId: h.docId,
        anchor: h.anchor,
      };
    });
  return { hits, total: hits.length, unembedded: 0, ...(note ? { note } : {}) };
}

function orderOf(q: Query, found: Partial<Record<SearchKind, Found>>): SearchKind[] {
  const codes = q.terms.map((t) => foldKeep(t));
  const exact = (kind: SearchKind) =>
    (found[kind]?.hits ?? []).some((h) => codes.includes(foldKeep(kind === "test" ? (h.key ?? h.id) : h.id)));
  const first = (["test", "document"] as SearchKind[]).find(exact);
  return first ? [first, ...KINDS.filter((x) => x !== first)] : [...KINDS];
}

export async function searchAll(project: string, input: SearchAllInput): Promise<SearchResult> {
  const q = parseQuery(input.query);
  if (input.in?.length) q.filters.in = [...new Set([...(q.filters.in ?? []), ...input.in])];
  if (!q.filters.in?.length && testsOnly(q.filters)) q.filters.in = ["test"];
  const k = input.k ?? 8;
  const hasText = !!(q.terms.length || q.phrases.length);
  // ponytail: a key or a code alone is a question for words — its meaning would only add noise
  const meaning = (input.meaning ?? true) && !!(q.phrases.length || q.terms.some((t) => !isCode(t)));
  const found: Partial<Record<SearchKind, Found>> = {};
  const notes: string[] = [];
  const guard = async (kind: SearchKind, work: () => Found | Promise<Found>) => {
    try {
      found[kind] = await work();
    } catch (e) {
      notes.push(`${kind}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (wants(q, "test") && (hasText || testsOnly(q.filters)))
    await guard("test", async () => {
      const all = testsCorpus(project);
      return findTests(project, q, hasText ? compile(q, all.vocab) : null, k, meaning);
    });
  if (hasText) {
    if (wants(q, "document")) await guard("document", () => findDocuments(project, q, k));
    if (wants(q, "passage") && q.text.trim()) await guard("passage", () => findPassages(project, q, k, meaning));
  }
  for (const f of Object.values(found)) if (f?.note && !notes.includes(f.note)) notes.push(f.note);
  const order = orderOf(q, found);
  return {
    hits: order.flatMap((kind) => found[kind]?.hits ?? []),
    totals: Object.fromEntries(Object.entries(found).map(([kind, f]) => [kind, f?.total ?? 0])),
    order,
    meaning: !meaning ? "off" : found.test?.meaning === false && found.test.note ? "unavailable" : "on",
    unembedded: found.test?.unembedded ?? 0,
    notes,
  };
}
