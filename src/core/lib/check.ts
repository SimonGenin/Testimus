import { existsSync, readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { covers, readLedger, type Searched } from "../claude/ledger.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { FIGURE_IMAGE, parseSections } from "../rag/chunk.ts";
import { normalizeRef, refInfo, related } from "../rag/related.ts";
import { type EvidenceOpts, matrixRows, type Statement, statementsOf } from "../rag/statements.ts";
import type { CheckFile, CitingTest, DocJson, Finding, Review, Step, Test } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { parseCsv } from "./csv.ts";
import { readJson, readProject, writeJson } from "./project.ts";
import { readCheck, readTest, testDir, testExists, testsDir } from "./store.ts";
import { frontmatterOf, hasRawEmbed, testMdHash } from "./testfile.ts";
import { compile, idsInCell, projectTraces, REQUIREMENT, requirementPatterns, scanTrace } from "./traces.ts";

export type DocText = {
  id: string;
  doc: Partial<DocJson>;
  anchors: Set<string>;
  text: string;
  md: string;
  scopes: Map<string, string | null>;
  opts?: EvidenceOpts;
  pieces?: [string, string][];
  pictures?: Set<string>;
};
export type Traced = { label: string; field: string; re: RegExp; ids: Set<string> };
export type Corpus = {
  docs: Map<string, DocText>;
  requirements: Set<string>;
  requirementField: string | null;
  traced?: Traced[];
};

const ACTION = "Action";
const EXPECTED = "Expected Result";
const COMMENTS = /<!--[\s\S]*?-->/g;
const ANCHORS = /<!--\s*(§|req|fig|page)\s*(\S+?)\s*-->/g;

export const flat = (s: string) => s.replace(/\s+/g, " ").trim();
// ponytail: doc.md keeps Word's bold and italic as * and **, which a quote never carries
export const plainText = (s: string) => flat(s.replace(COMMENTS, " ").replace(/\*/g, ""));

export function anchorKey(anchor: string): string {
  const a = anchor.trim();
  const m = /^(req|fig|page)\s*[:\s]\s*(.+)$/i.exec(a);
  if (m) return `${m[1].toLowerCase()}:${m[2].trim()}`;
  return `§${a.replace(/^§\s*/, "")}`;
}

export function anchorsOf(md: string): Set<string> {
  return new Set([...md.matchAll(ANCHORS)].map((m) => (m[1] === "§" ? `§${m[2]}` : `${m[1]}:${m[2]}`)));
}

// ponytail: the requirement field is the column of the tracked requirement kind; none while the project
// tracks no requirements
export function requirementFieldOf(project: string): string | null {
  const field = projectTraces(project).traces.find((t) => t.id === REQUIREMENT)?.field;
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function csvRequirements(project: string): string[] {
  const file = join(project, "requirements", "requirements.csv");
  if (!existsSync(file)) return [];
  const t = parseCsv(readFileSync(file, "utf8"));
  const col = Math.max(
    0,
    t.headers.findIndex((h) => /^(id|exigence|requirement)$/i.test(h.trim())),
  );
  return t.rows.map((r) => (r[col] ?? "").trim()).filter(Boolean);
}

export function loadCorpus(project: string): Corpus {
  const docs = new Map<string, DocText>();
  const requirements = new Set(csvRequirements(project));
  const pj = readProject(project);
  const opts: EvidenceOpts = { patterns: requirementPatterns(project), matrix: pj.requirementMatrix };
  const patterns = (opts.patterns ?? []).flatMap((p) => {
    try {
      return [new RegExp(p, "g")];
    } catch {
      return [];
    }
  });
  const dir = join(project, "docs");
  const entries = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  for (const e of entries) {
    const mdFile = join(dir, e.name, "doc.md");
    if (!e.isDirectory() || !existsSync(mdFile)) continue;
    const md = readFileSync(mdFile, "utf8");
    const doc = readJson<Partial<DocJson>>(join(dir, e.name, "doc.json"), {});
    const d: DocText = { id: e.name, doc, anchors: anchorsOf(md), text: plainText(md), md, scopes: new Map(), opts };
    for (const a of d.anchors) if (a.startsWith("req:")) requirements.add(a.slice(4));
    for (const r of matrixRows(md, opts)) {
      d.anchors.add(r.anchor);
      requirements.add(r.id);
    }
    for (const re of patterns) for (const m of md.matchAll(re)) requirements.add(m[0]);
    docs.set(e.name, d);
    if (doc.code && !docs.has(doc.code)) docs.set(doc.code, d);
  }
  return { docs, requirements, requirementField: requirementFieldOf(project), traced: tracedKinds(project) };
}

// ponytail: every other tracked kind is checked on its own column: its ids must be written in a document
function tracedKinds(project: string): Traced[] {
  return projectTraces(project)
    .traces.filter((t) => t.id !== REQUIREMENT)
    .flatMap((t) => {
      try {
        const ids = new Set(scanTrace(project, t.patterns).items.map((i) => i.id));
        return [{ label: t.label, field: t.field, re: compile(t.patterns), ids }];
      } catch {
        return [];
      }
    });
}

const keysIn = (line: string) =>
  [...line.matchAll(ANCHORS)].map((m) => (m[1] === "§" ? `§${m[2]}` : `${m[1]}:${m[2]}`));
const SECTION_MARK = /[<]!--\s*§/;
const PAGE_MARK = /[<]!--\s*page\b/;
const MARKER_ONLY = /^\s*<!--\s*req\s+\S+?\s*-->\s*$/;
const headingLevel = (line: string) => (SECTION_MARK.test(line) ? (/^(#{1,6})\s/.exec(line)?.[1].length ?? 0) : 0);

// ponytail: what a citation may quote — a § anchor is its section with the subsections; a requirement
// is the section that holds its statement; a matrix row (req:ID@matrix) is the row; a figure is its caption
// paragraph only (what the picture shows is the semantic pass's job); a page runs to the next
export function scopeOf(md: string, anchor: string, opts: EvidenceOpts = {}): string | null {
  const lines = md.split(/\r?\n/);
  if (/^req:.+@matrix(~\d+)?$/.test(anchor)) {
    const row = matrixRows(md, opts).find((r) => r.anchor === anchor);
    return row ? plainText(lines[row.line]) : null;
  }
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
    let h = at;
    if (anchor.startsWith("req:")) {
      let n = at + 1;
      while (n < lines.length && (!lines[n].trim() || MARKER_ONLY.test(lines[n]))) n++;
      if (n < lines.length && headingLevel(lines[n])) h = n;
    }
    while (h >= 0 && !headingLevel(lines[h])) h--;
    if (h >= 0) [a, b] = sectionFrom(h);
    else {
      a = 0;
      b = at + 1;
      while (b < lines.length && !headingLevel(lines[b])) b++;
    }
    if (anchor.startsWith("fig:")) {
      let p0 = at;
      let p1 = at + 1;
      while (p0 > 0 && lines[p0 - 1].trim() !== "") p0--;
      while (p1 < lines.length && lines[p1].trim() !== "") p1++;
      [a, b] = [p0, p1];
    }
  }
  const scope = plainText(lines.slice(a, b).join("\n"));
  if (!anchor.startsWith("req:")) return scope;
  const st = statementsIn(md, opts).get(anchor.slice(4));
  const own = st?.source === "body" ? plainText(st.text) : "";
  return own && !scope.includes(own) ? `${scope} ${own}` : scope;
}

let lastStatements: { md: string; opts: EvidenceOpts; map: Map<string, Statement> } | null = null;
// ponytail: a requirement's statement may be read away from its marker (a table row, a later id list) — what
// rag.passage shows as its focus is quotable under req:ID too
function statementsIn(md: string, opts: EvidenceOpts): Map<string, Statement> {
  if (lastStatements?.md !== md || lastStatements.opts !== opts)
    lastStatements = { md, opts, map: statementsOf("", md, opts) };
  return lastStatements.map;
}

const scoped = (d: DocText, anchor: string) => {
  if (!d.scopes.has(anchor)) d.scopes.set(anchor, scopeOf(d.md, anchor, d.opts));
  return d.scopes.get(anchor) ?? null;
};

// ponytail: where a quote sits — the section whose own text (heading and body, without its subsections or its
// requirement matrix) holds it, else a matrix row, else a figure caption
function piecesOf(md: string, opts: EvidenceOpts = {}): [string, string][] {
  const lines = md.split(/\r?\n/);
  const rows = matrixRows(md, opts);
  const masked = [...lines];
  for (const r of rows) masked[r.line] = "";
  const out: [string, string][] = parseSections(masked.join("\n")).map((s) => [
    s.anchor,
    plainText(`${lines[s.line]}\n${s.body}`),
  ]);
  for (const r of rows) out.push([r.anchor, plainText(lines[r.line])]);
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
  d.pieces ??= piecesOf(d.md, d.opts);
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

export const requirementIds = (value: string | undefined) => (value ?? "").split(/[\s,;]+/).filter(Boolean);

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

const stepKey = (s: Step) =>
  JSON.stringify(
    Object.entries(s.fields)
      .map(([k, v]) => [k, flat(v)])
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

export function mechanicalFindings(test: Test, corpus: Corpus): Finding[] {
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
          message: `Step ${step}: ${src.docId} has no anchor ${anchor}: cite an existing section, requirement or figure.`,
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
    if (corpus.requirementField)
      for (const id of requirementIds(s.fields[corpus.requirementField]))
        if (!corpus.requirements.has(id))
          add({
            step,
            kind: "requirement-unknown",
            severity: "error",
            message: `Step ${step}: requirement ${id} is neither in requirements/requirements.csv nor in a document: fix the id or add the requirement.`,
            sources: [],
          });
    for (const t of corpus.traced ?? []) {
      const value = Object.entries(s.fields).find(([k]) => k.trim().toLowerCase() === t.field.toLowerCase())?.[1];
      const cell = idsInCell(value, t.re);
      for (const id of [...cell.ids.filter((x) => !t.ids.has(x)), ...cell.other])
        add({
          step,
          kind: "id-unknown",
          severity: "error",
          message: `Step ${step}: ${t.label} ${id} (column ${t.field}) is written in no document: fix the id, or the patterns of the tracked ids.`,
          sources: [],
        });
    }
  });
  return out;
}

export function mechanicalCheck(project: string, id: string, corpus: Corpus = loadCorpus(project)): Finding[] {
  const test = readTest(project, id).test;
  return [...mechanicalFindings(test, corpus), ...relatedUnread(project, test, corpus.requirementField)];
}

type Link = {
  ref: string;
  kind: "defines" | "traces" | "mentions" | "amends";
  title: string;
  req: string;
  step: number;
};

// ponytail: the requirement field is what a test claims to cover; its defining and traced sections (and, for the
// Review screen, the sections that mention it and the amending ones) come from rag.related, never from a model
function requirementLinks(project: string, test: Test, field: string | null, kinds: Link["kind"][]): Link[] {
  if (!field) return [];
  const first = new Map<string, number>();
  test.steps.forEach((s, i) => {
    for (const r of requirementIds(s.fields[field])) if (!first.has(r)) first.set(r, i + 1);
  });
  const out: Link[] = [];
  const seen = new Set<string>();
  for (const [req, step] of first) {
    let r: ReturnType<typeof related>;
    try {
      r = related(project, { ref: req });
    } catch {
      continue;
    }
    for (const n of r.neighbours) {
      const kind = n.kind as Link["kind"];
      if (!kinds.includes(kind) || !/#§/.test(n.ref) || seen.has(n.ref)) continue;
      if ((kind === "defines" || kind === "traces") !== (n.direction === "out")) continue;
      seen.add(n.ref);
      out.push({ ref: n.ref, kind, title: n.title, req, step });
    }
  }
  return out;
}

export function relatedUnread(project: string, test: Test, field: string | null): Finding[] {
  const ledger = readLedger(project, test.generatedBy);
  if (!ledger) return [];
  return requirementLinks(project, test, field, ["defines", "traces"])
    .filter((l) => !covers(ledger.consulted, l.ref))
    .map((l) => ({
      step: l.step,
      kind: "related-unread" as const,
      severity: "info" as const,
      message: `Step ${l.step}: ${l.req} is ${l.kind === "defines" ? "defined" : "traced"} in ${l.ref}${l.title ? ` (${l.title})` : ""}, which the generation ${ledger.jobId} never opened.`,
      sources: [l.ref],
      pass: "mechanical" as const,
    }));
}

export type TestEvidence = {
  testId: string;
  jobId: string | null;
  consulted: string[];
  read: { ref: string; title: string; cited: boolean }[];
  related: { ref: string; kind: Link["kind"]; title: string; read: boolean; via: string }[];
  searched: Searched[];
};

export function testEvidence(project: string, id: string): TestEvidence {
  const test = readTest(project, id).test;
  const ledger = readLedger(project, test.generatedBy);
  const consulted = ledger?.consulted ?? [];
  const cites = test.steps.flatMap((s) => s.sources.map((x) => normalizeRef(`${x.docId}#${x.anchor}`)));
  const titles = new Map<string, string>();
  const links = requirementLinks(project, test, requirementFieldOf(project), [
    "defines",
    "traces",
    "mentions",
    "amends",
  ]);
  for (const l of links) titles.set(l.ref, l.title);
  const titleOf = (ref: string) => titles.get(ref) ?? refInfo(project, ref).title;
  return {
    testId: id,
    jobId: ledger?.jobId ?? null,
    consulted,
    read: consulted.map((ref) => ({
      ref,
      title: titleOf(ref),
      cited: cites.some((c) => c === ref || covers([ref], c)),
    })),
    related: links.map((l) => ({
      ref: l.ref,
      kind: l.kind,
      title: l.title,
      read: covers(consulted, l.ref),
      via: `${l.kind} ${l.req}`,
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
