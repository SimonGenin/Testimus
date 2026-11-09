import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { normalizeAnchor } from "../rag/anchors.ts";
import { FIGURE_IMAGE, parseSections } from "../rag/chunk.ts";
import type { CheckFile, CitingTest, DocJson, Finding, Step, Test } from "../types.ts";
import { stepColumns } from "./columns.ts";
import { findDoc } from "./docs.ts";
import { isObserved } from "./media.ts";
import { natural } from "./natural.ts";
import { writeJson } from "./project.ts";
import { readCheck, readTest, testDir, testExists, testsDir } from "./store.ts";
import { hasRawEmbed } from "./test-blocks.ts";
import { testMdHash } from "./testfile.ts";

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
const ANCHORS = /<!--\s*(§|fig|page|img|frame|t)\s*(\S+?)\s*-->/g;

export const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// ponytail: doc.md keeps Word's bold and italic as * and **, which a quote never carries
export const plainText = (s: string) => flat(s.replace(COMMENTS, " ").replace(/\*/g, ""));

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

// ponytail: where a quote sits — a picture or a transcript line of an images or video document first (the narrowest
// place), else the section whose own text (heading and body, without its subsections) holds it, else a figure caption
function piecesOf(md: string): [string, string][] {
  const lines = md.split(/\r?\n/);
  const media: [string, string][] = [];
  const figures: [string, string][] = [];
  lines.forEach((l, i) => {
    const n = /<!--\s*((?:fig|img|frame|t)\s+\S+?)\s*-->/.exec(l)?.[1].replace(/\s+/, ":");
    if (!n) return;
    let p0 = i;
    let p1 = i + 1;
    while (p0 > 0 && lines[p0 - 1].trim() !== "") p0--;
    while (p1 < lines.length && lines[p1].trim() !== "") p1++;
    (n.startsWith("fig:") ? figures : media).push([n, plainText(lines.slice(p0, p1).join("\n"))]);
  });
  const sections: [string, string][] = parseSections(md).map((s) => [
    s.anchor,
    plainText(`${lines[s.line]}\n${s.body}`),
  ]);
  return [...media, ...sections, ...figures];
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
      const anchor = normalizeAnchor(src.anchor);
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
    // ponytail: images and videos say how to do a step (where to click, the exact labels), never what is expected — an
    // expected result whose every source is an observed document is told, unless the team marked it as the reference
    const backing = s.sources.filter((x) => !x.column && x.anchor);
    const observed = backing.filter((x) => {
      const d = corpus.docs.get(x.docId)?.doc;
      return !!d?.source && isObserved(d as DocJson);
    });
    if (expected.trim() && backing.length && observed.length === backing.length) {
      const refs = [...new Set(observed.map((x) => `${x.docId}#${normalizeAnchor(x.anchor)}`))];
      add({
        step,
        kind: "observed-only",
        severity: "warning",
        message: `Step ${step}: its expected result rests only on ${andList(refs)}, pictures or videos of the real system — they show what it does, not what it must do. Cite the passage of a document that specifies the result (keep the picture for how to do the step), or mark the images or video document as the reference in Documents when the team says it is one.`,
        sources: refs,
      });
    }
    const bare = linked.filter(
      (name) => cellOf(s, name).trim() && !s.sources.some((x) => x.column && sameName(x.column, name)),
    );
    if (bare.length)
      add({
        step,
        kind: "column-unsourced",
        severity: "warning",
        message:
          bare.length === 1
            ? `Step ${step}: ${bare[0]} is a Reference source column and none of its items has a source of its own. Give each item a Sources line ending in @${bare[0]} "<item>", or switch Reference source off for ${bare[0]} in Settings › Smart columns.`
            : `Step ${step}: ${andList(bare)} are Reference source columns and none of their items has a source of its own. Give each item a Sources line ending in @<column> "<item>", or switch Reference source off for these columns in Settings › Smart columns.`,
        sources: [],
      });
    for (const src of s.sources)
      if (src.column && src.item && !flat(cellOf(s, src.column)).includes(flat(src.item)))
        add({
          step,
          kind: "item-not-found",
          severity: "warning",
          message: `Step ${step}: a source backs « ${short(src.item)} » in ${src.column}, and the step's ${src.column} does not hold it: write the item as the cell has it, or remove the @${src.column} part.`,
          sources: src.anchor ? [`${src.docId}#${normalizeAnchor(src.anchor)}`] : [],
        });
    // ponytail: a step with a picture of unknown origin (pasted, or attached before images knew their figure) may
    // already show it — only a step without one is told
    if (!s.images.some((im) => !im.figure))
      for (const src of s.sources) {
        const anchor = normalizeAnchor(src.anchor);
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
export function testsCiting(
  project: string,
  doc: { id: string; code?: string },
  only: (anchor: string) => boolean = () => true,
): CitingTest[] {
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
    const steps = test.steps.filter((s) => s.sources.some((x) => names.has(x.docId) && only(x.anchor ?? ""))).length;
    if (steps) out.push({ id: e.name, key: test.key, summary: test.summary, review: test.review, steps });
  }
  return out.sort((a, b) => natural(a.id, b.id));
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

export function isStale(project: string, id: string, check: CheckFile | null = readCheck(project, id)): boolean {
  return !!check && testMdHash(readTest(project, id).md) !== check.testHash;
}
