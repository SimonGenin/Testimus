import { existsSync, readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { covers, readLedger, type Searched } from "../claude/ledger.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { FIGURE_IMAGE, parseSections } from "../rag/chunk.ts";
import { normalizeRef, refInfo } from "../rag/related.ts";
import type { CheckFile, CitingTest, DocJson, Finding, Review, Step, Test } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { stepColumns } from "./columns.ts";
import { findDoc } from "./docs.ts";
import { writeJson } from "./project.ts";
import { readCheck, readTest, testDir, testExists, testsDir } from "./store.ts";
import { frontmatterOf, hasRawEmbed, testMdHash } from "./testfile.ts";

export type DocText = {
  id: string;
  doc: Partial<DocJson>;
  anchors: Set<string>;
  text: string;
  md: string;
  scopes: Map<string, string | null>;
  pieces?: [string, string][];
  pictures?: Set<string>;
};
export type Corpus = { docs: Map<string, DocText> };

const ACTION = "Action";
const EXPECTED = "Expected Result";
const COMMENTS = /<!--[\s\S]*?-->/g;
const ANCHORS = /<!--\s*(§|fig|page)\s*(\S+?)\s*-->/g;

export const flat = (s: string) => s.replace(/\s+/g, " ").trim();
// ponytail: doc.md keeps Word's bold and italic as * and **, which a quote never carries
export const plainText = (s: string) => flat(s.replace(COMMENTS, " ").replace(/\*/g, ""));

export function anchorKey(anchor: string): string {
  const a = anchor.trim();
  const m = /^(fig|page)\s*[:\s]\s*(.+)$/i.exec(a);
  if (m) return `${m[1].toLowerCase()}:${m[2].trim()}`;
  return `§${a.replace(/^§\s*/, "")}`;
}

export function anchorsOf(md: string): Set<string> {
  return new Set([...md.matchAll(ANCHORS)].map((m) => (m[1] === "§" ? `§${m[2]}` : `${m[1]}:${m[2]}`)));
}

export function loadCorpus(project: string): Corpus {
  const docs = new Map<string, DocText>();
  const dir = join(project, "docs");
  const entries = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  for (const e of entries) {
    const mdFile = join(dir, e.name, "doc.md");
    if (!e.isDirectory() || !existsSync(mdFile)) continue;
    const md = readFileSync(mdFile, "utf8");
    const doc: Partial<DocJson> = findDoc(project, e.name) ?? {};
    const d: DocText = { id: e.name, doc, anchors: anchorsOf(md), text: plainText(md), md, scopes: new Map() };
    docs.set(e.name, d);
    if (doc.code && !docs.has(doc.code)) docs.set(doc.code, d);
  }
  return { docs };
}

const keysIn = (line: string) =>
  [...line.matchAll(ANCHORS)].map((m) => (m[1] === "§" ? `§${m[2]}` : `${m[1]}:${m[2]}`));
const SECTION_MARK = /[<]!--\s*§/;
const PAGE_MARK = /[<]!--\s*page\b/;
const headingLevel = (line: string) => (SECTION_MARK.test(line) ? (/^(#{1,6})\s/.exec(line)?.[1].length ?? 0) : 0);

// ponytail: what a citation may quote — a § anchor is its section with the subsections; a figure is its caption
// paragraph only (what the picture shows is the semantic pass's job); a page runs to the next
export function scopeOf(md: string, anchor: string): string | null {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => keysIn(l).includes(anchor));
  if (at < 0) return null;
  const sectionFrom = (start: number): [number, number] => {
    const lv = headingLevel(lines[start]) || 7;
    let end = start + 1;
    while (end < lines.length && !(headingLevel(lines[end]) && headingLevel(lines[end]) <= lv)) end++;
    return [start, end];
  };
  let [a, b]: [number, number] = [at, lines.length];
  if (anchor.startsWith("§")) [a, b] = sectionFrom(at);
  else if (anchor.startsWith("page:")) {
    b = at + 1;
    while (b < lines.length && !PAGE_MARK.test(lines[b])) b++;
  } else {
    a = at;
    b = at + 1;
    while (a > 0 && lines[a - 1].trim() !== "") a--;
    while (b < lines.length && lines[b].trim() !== "") b++;
  }
  return plainText(lines.slice(a, b).join("\n"));
}

const scoped = (d: DocText, anchor: string) => {
  if (!d.scopes.has(anchor)) d.scopes.set(anchor, scopeOf(d.md, anchor));
  return d.scopes.get(anchor) ?? null;
};

// ponytail: where a quote sits — the section whose own text (heading and body, without its subsections) holds
// it, else a figure caption
function piecesOf(md: string): [string, string][] {
  const lines = md.split(/\r?\n/);
  const out: [string, string][] = parseSections(md).map((s) => [s.anchor, plainText(`${lines[s.line]}\n${s.body}`)]);
  lines.forEach((l, i) => {
    const n = /<!--\s*fig\s+(\S+?)\s*-->/.exec(l)?.[1];
    if (!n) return;
    let p0 = i;
    let p1 = i + 1;
    while (p0 > 0 && lines[p0 - 1].trim() !== "") p0--;
    while (p1 < lines.length && lines[p1].trim() !== "") p1++;
    out.push([`fig:${n}`, plainText(lines.slice(p0, p1).join("\n"))]);
  });
  return out;
}

function picturesOf(d: DocText): Set<string> {
  d.pictures ??= new Set([...d.md.matchAll(FIGURE_IMAGE)].map((m) => `fig:${m[3]}`));
  return d.pictures;
}

export function whereIs(d: DocText, quote: string): string | null {
  d.pieces ??= piecesOf(d.md);
  const q = plainText(quote);
  return d.pieces.find(([, t]) => t.includes(q))?.[0] ?? null;
}

export function occurrences(text: string, quote: string): number {
  const q = plainText(quote);
  if (!q) return 0;
  let n = 0;
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) n++;
  return n;
}

const MIN_WORDS = 4;
const MIN_CHARS = 20;
export const tooShort = (quote: string) => {
  const q = plainText(quote);
  return q.split(" ").filter(Boolean).length < MIN_WORDS || q.length < MIN_CHARS;
};

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

const stepKey = (s: Step) =>
  JSON.stringify(
    Object.entries(s.fields)
      .map(([k, v]) => [k, flat(v)])
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const cellOf = (s: Step, column: string) => Object.entries(s.fields).find(([k]) => sameName(k, column))?.[1] ?? "";

// ponytail: linked are the columns whose Reference source is on — their cells need a source of their own
export function mechanicalFindings(test: Test, corpus: Corpus, linked: readonly string[] = []): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "pass">) => out.push({ ...f, pass: "mechanical" });
  if (!test.steps.length)
    add({
      kind: "empty-field",
      severity: "error",
      message: "The test has no step: add at least one step with an action and an expected result.",
      sources: [],
    });
  const seen = new Map<string, number>();
  const embedded = new Set(
    test.steps.flatMap((s) =>
      s.images.flatMap((im) => {
        const [docId, anchor] = im.figure?.split("#") ?? [];
        return anchor ? [`${corpus.docs.get(docId)?.id ?? docId}#${anchor}`] : [];
      }),
    ),
  );
  test.steps.forEach((s, i) => {
    const step = i + 1;
    const expected = s.fields[EXPECTED] ?? "";
    if (!(s.fields[ACTION] ?? "").trim())
      add({
        step,
        kind: "empty-field",
        severity: "error",
        message: `Step ${step} has no Action: write the gesture the tester performs.`,
        sources: [],
      });
    if (!expected.trim())
      add({
        step,
        kind: "empty-field",
        severity: "error",
        message: `Step ${step} has no Expected Result: write what the tester must observe.`,
        sources: [],
      });
    if (hasRawEmbed(s))
      add({
        step,
        kind: "raw-embed",
        severity: "error",
        message: `Step ${step} embeds something Xray cannot show: replace it with a screenshot from images/ or remove it.`,
        sources: [],
      });
    const key = stepKey(s);
    const first = seen.get(key);
    if (key !== "[]" && first !== undefined)
      add({
        step,
        kind: "duplicate-step",
        severity: "warning",
        message: `Step ${step} repeats step ${first}: remove it or make it check something else.`,
        sources: [],
      });
    else seen.set(key, step);
    if (expected.trim() && !s.sources.length)
      add({
        step,
        kind: "source-missing",
        severity: "warning",
        message: `Step ${step} has no source for its expected result: add a ### Sources line docId#anchor "exact quote".`,
        sources: [],
      });
    for (const src of s.sources) {
      if (!src.anchor) {
        add({
          step,
          kind: "source-missing",
          severity: "error",
          message: `Step ${step}: source "${short(src.docId)}" is not docId#anchor "quote": rewrite it, e.g. DOC#§5.6.6 "exact words".`,
          sources: [],
        });
        continue;
      }
      const anchor = anchorKey(src.anchor);
      const ref = `${src.docId}#${anchor}`;
      const d = corpus.docs.get(src.docId);
      if (!d) {
        add({
          step,
          kind: "source-missing",
          severity: "error",
          message: `Step ${step} cites ${src.docId}, which is not a document of this project: fix the code or add the document.`,
          sources: [ref],
        });
        continue;
      }
      if (!d.anchors.has(anchor))
        add({
          step,
          kind: "source-missing",
          severity: "error",
          message: `Step ${step}: ${src.docId} has no anchor ${anchor}: cite an existing section, figure or page.`,
          sources: [ref],
        });
      if (!src.quote.trim())
        add({
          step,
          kind: "quote-not-found",
          severity: "warning",
          message: `Step ${step}: source ${ref} has no quote: add the exact words the step relies on.`,
          sources: [ref],
        });
      else if (!d.text.includes(plainText(src.quote)))
        add({
          step,
          kind: "quote-not-found",
          severity: "error",
          message: `Step ${step}: the quote "${short(flat(src.quote))}" is not in ${src.docId}: copy the exact words from its doc.md.`,
          sources: [ref],
        });
      else if (d.anchors.has(anchor) && !(scoped(d, anchor) ?? d.text).includes(plainText(src.quote))) {
        const where = whereIs(d, src.quote);
        add({
          step,
          kind: "quote-not-at-anchor",
          severity: "error",
          message: where
            ? `Step ${step}: the quote "${short(flat(src.quote))}" is in ${src.docId} but not under ${anchor}: it is under ${where} — cite ${src.docId}#${where}.`
            : `Step ${step}: the quote "${short(flat(src.quote))}" is in ${src.docId} but not under ${anchor}: cite the section that holds it.`,
          sources: where ? [ref, `${src.docId}#${where}`] : [ref],
        });
      } else if (tooShort(src.quote))
        add({
          step,
          kind: "quote-weak",
          severity: "warning",
          message: `Step ${step}: the quote "${short(flat(src.quote))}" is too short to prove anything: quote at least ${MIN_WORDS} words (${MIN_CHARS} characters) of ${ref}.`,
          sources: [ref],
        });
      else if (d.anchors.has(anchor) && occurrences(scoped(d, anchor) ?? "", src.quote) > 1)
        add({
          step,
          kind: "quote-weak",
          severity: "warning",
          message: `Step ${step}: the quote "${short(flat(src.quote))}" appears ${occurrences(scoped(d, anchor) ?? "", src.quote)} times under ${anchor}: quote more words so it points at one place.`,
          sources: [ref],
        });
    }
    for (const name of linked)
      if (cellOf(s, name).trim() && !s.sources.some((x) => x.column && sameName(x.column, name)))
        add({
          step,
          kind: "column-unsourced",
          severity: "warning",
          message: `Step ${step}: ${name} links its items to their sources, and none has one: add a ### Sources line docId#anchor "exact quote" @${name} "<item>" for each.`,
          sources: [],
        });
    for (const src of s.sources)
      if (src.column && src.item && !flat(cellOf(s, src.column)).includes(flat(src.item)))
        add({
          step,
          kind: "item-not-found",
          severity: "warning",
          message: `Step ${step}: a source backs « ${short(src.item)} » in ${src.column}, and the step's ${src.column} does not hold it: write the item as the cell has it, or remove the @${src.column} part.`,
          sources: src.anchor ? [`${src.docId}#${anchorKey(src.anchor)}`] : [],
        });
    // ponytail: a step with a picture of unknown origin (pasted, or attached before images knew their figure) may
    // already show it — only a step without one is told
    if (!s.images.some((im) => !im.figure))
      for (const src of s.sources) {
        const anchor = anchorKey(src.anchor);
        const d = corpus.docs.get(src.docId);
        if (!d || !picturesOf(d).has(anchor) || embedded.has(`${d.id}#${anchor}`)) continue;
        embedded.add(`${d.id}#${anchor}`);
        const ref = `${src.docId}#${anchor}`;
        add({
          step,
          kind: "figure-not-embedded",
          severity: "warning",
          message: `Step ${step} cites ${ref}, a picture the tester needs to see: embed it with tests_addImage { id, step: ${step}, figure: "${ref}" } (Action when it shows where to act, Expected Result when it shows what to see).`,
          sources: [ref],
        });
      }
  });
  return out;
}

export function mechanicalCheck(project: string, id: string, corpus: Corpus = loadCorpus(project)): Finding[] {
  const test = readTest(project, id).test;
  const linked = stepColumns(project)
    .filter((c) => c.referenceSource)
    .map((c) => c.name);
  return mechanicalFindings(test, corpus, linked);
}

export type TestEvidence = {
  testId: string;
  jobId: string | null;
  consulted: string[];
  read: { ref: string; title: string; cited: boolean }[];
  searched: Searched[];
};

export function testEvidence(project: string, id: string): TestEvidence {
  const test = readTest(project, id).test;
  const ledger = readLedger(project, test.generatedBy);
  const consulted = ledger?.consulted ?? [];
  const cites = test.steps.flatMap((s) => s.sources.map((x) => normalizeRef(`${x.docId}#${x.anchor}`)));
  return {
    testId: id,
    jobId: ledger?.jobId ?? null,
    consulted,
    read: consulted.map((ref) => ({
      ref,
      title: refInfo(project, ref).title,
      cited: cites.some((c) => c === ref || covers([ref], c)),
    })),
    searched: ledger?.searched ?? [],
  };
}

const bySteps = (fs: Finding[]) =>
  fs
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.step ?? 0) - (b.f.step ?? 0) || a.i - b.i)
    .map((x) => x.f);

export function writeCheck(project: string, id: string, findings: Finding[]): CheckFile {
  const md = readTest(project, id).md;
  const file: CheckFile = { at: env.now().toISOString(), testHash: testMdHash(md), findings: bySteps(findings) };
  writeJson(join(testDir(project, id), "check.json"), file);
  return file;
}

export function runMechanical(project: string, id: string, corpus?: Corpus): CheckFile {
  return writeCheck(project, id, mechanicalCheck(project, id, corpus));
}

// ponytail: a source names a document by its id or by its code — loadCorpus answers both, so both count
export function testsCiting(project: string, doc: { id: string; code?: string }): CitingTest[] {
  const names = new Set([doc.id, doc.code].filter(Boolean));
  const dir = testsDir(project);
  const out: CitingTest[] = [];
  for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    if (!e.isDirectory() || !testExists(project, e.name)) continue;
    let test: Test;
    try {
      test = readTest(project, e.name).test;
    } catch {
      continue;
    }
    const steps = test.steps.filter((s) => s.sources.some((x) => names.has(x.docId))).length;
    if (steps) out.push({ id: e.name, key: test.key, summary: test.summary, review: test.review, steps });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

// ponytail: the test did not change, its documents did — the mechanical pass is redone, and the semantic
// findings stay while they were stamped for this very test.md
export function recheckMechanical(project: string, ids: string[]): CheckFile[] {
  const corpus = loadCorpus(project);
  return ids.map((id) => {
    const old = readCheck(project, id);
    const semantic = old && !isStale(project, id, old) ? semanticOf(old) : [];
    return writeCheck(project, id, [...mechanicalCheck(project, id, corpus), ...semantic]);
  });
}

export const semanticOf = (check: CheckFile | null): Finding[] =>
  (check?.findings ?? []).filter((f) => f.pass === "semantic");

// ponytail: the mechanical pass is recomputed on every record — it costs nothing and is what keeps
// the whole file honest about the testHash it is stamped with
export function recordSemantic(project: string, id: string, findings: Omit<Finding, "pass">[]): CheckFile {
  const semantic = findings.map((f) => ({ ...f, sources: f.sources ?? [], pass: "semantic" as const }));
  return writeCheck(project, id, [...mechanicalCheck(project, id), ...semantic]);
}

export const readTestReview = (project: string, id: string): Review => readTest(project, id).test.review;

export function isStale(project: string, id: string, check: CheckFile | null = readCheck(project, id)): boolean {
  return !!check && testMdHash(readTest(project, id).md) !== check.testHash;
}

export function osUser(): string {
  try {
    return userInfo().username || process.env.USERNAME || "unknown";
  } catch {
    return process.env.USERNAME || process.env.USER || "unknown";
  }
}

export type ReviewPatch = { review: Review; note?: string | null; by?: string | null; at?: string | null };

const plain = (v: string) =>
  v !== v.trim() || v.startsWith("[") || v.startsWith('"') || v.includes(" #") ? JSON.stringify(v) : v;

// ponytail: only the frontmatter lines change — the body keeps its bytes, so testHash and the
// findings it stamps stay fresh after a review decision
export function patchReview(md: string, p: ReviewPatch): string {
  const want: [string, string | null | undefined][] = [
    ["review", p.review],
    ["review_note", p.note === undefined || p.note === null ? p.note : JSON.stringify(p.note)],
    ["reviewed_by", p.by === undefined || p.by === null ? p.by : plain(p.by)],
    ["reviewed_at", p.at === undefined || p.at === null ? p.at : plain(p.at)],
  ];
  const touched = want.filter(([, v]) => v !== undefined);
  const keys = new Set(touched.map(([k]) => k));
  const fm = frontmatterOf(md);
  if (!fm)
    throw new UserError(
      "This test.md has no readable frontmatter (the --- lines around key, project, summary): the review decision was not written.",
      "Fix the --- lines at the top of test.md (or open the test in the editor), then decide again.",
    );
  const fresh = touched.filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
  const kept: string[] = [];
  let placed = false;
  let dropping = false;
  for (const line of fm.head) {
    if (dropping && /^\s/.test(line)) continue;
    dropping = false;
    const key = /^\s*([^:#]+?)\s*:/.exec(line)?.[1];
    if (key && keys.has(key)) {
      if (!placed) kept.push(...fresh);
      placed = true;
      dropping = true;
      continue;
    }
    kept.push(line);
  }
  if (!placed) kept.push(...fresh);
  return `${fm.bom}---${fm.nl}${kept.join(fm.nl)}${fm.nl}---${fm.rest}`;
}

export function setReview(project: string, id: string, p: ReviewPatch): Test {
  const file = join(testDir(project, id), "test.md");
  if (!existsSync(file)) throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.");
  writeAtomic(file, patchReview(readFileSync(file, "utf8"), p));
  return readTest(project, id).test;
}
