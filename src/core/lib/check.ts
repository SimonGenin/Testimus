import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { clock, momentOf, normalizeAnchor, parseAnchor } from "../rag/anchors.ts";
import { FIGURE_IMAGE, parseSections } from "../rag/chunk.ts";
import type { CheckFile, CitingTest, DocJson, Finding, Source, Step, StepVerdict, Test } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { stepColumns } from "./columns.ts";
import { findDoc } from "./docs.ts";
import { isObserved } from "./media.ts";
import { natural } from "./natural.ts";
import { writeJson } from "./project.ts";
import { readCheck, readTest, testDir, testExists, testsDir } from "./store.ts";
import { hasRawEmbed } from "./test-blocks.ts";
import { formatSource, NEW_SUMMARY, parseSource, testMdHash } from "./testfile.ts";
import { isTimed, momentText, resolveTimed, type Timed, type VideoText, videoText } from "./video/sources.ts";

export type DocText = {
  id: string;
  doc: Partial<DocJson>;
  anchors: Set<string>;
  text: string;
  md: string;
  scopes: Map<string, string | null>;
  pieces?: [string, string][];
  pictures?: Set<string>;
  video?: VideoText;
  /** timed sources (anchor, quote) a report of a new hearing or description could not find again */
  lost?: Set<string>;
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
    const lost = join(dir, e.name, "video", "lost.json");
    if (existsSync(lost)) d.lost = new Set(JSON.parse(readFileSync(lost, "utf8")) as string[]);
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

const timed = (d: DocText, anchor: string, quote: string): Timed => {
  d.video ??= videoText(d.md);
  return resolveTimed(d.video, anchor, quote);
};

// ponytail: a source in a video is judged against time (video/sources.ts), never against a line's place in doc.md:
// the moment must be in the video, the words said around it (or, for v:, written under a key frame of the range). What
// is told for a quote that is not there says where to listen — the closest words and their moment
function timedFindings(step: number, src: Source, ref: string, anchor: string, r: Timed): Omit<Finding, "pass">[] {
  const quote = `"${short(flat(src.quote))}"`;
  const when = momentText(anchor);
  if (!r.ok) {
    if (r.why === "no-video" || r.why === "no-moment")
      return [
        {
          step,
          kind: "source-missing",
          severity: "error",
          message:
            r.why === "no-video"
              ? `Step ${step}: ${src.docId} has no video with a moment ${anchor}: cite a moment of one of its videos (media_show lists them).`
              : `Step ${step}: ${anchor} is past the end of the video of ${src.docId}${r.length ? ` (${clock(r.length)} long)` : ""}: cite a moment within it.`,
          sources: [ref],
        },
      ];
    if (r.why === "no-frame")
      return [
        {
          step,
          kind: "source-missing",
          severity: "error",
          message: `Step ${step}: no key frame of ${src.docId} falls in ${when}, so nothing seen there can be quoted: keep a frame of that range (media_keep { doc, at }), then quote its description.`,
          sources: [ref],
        },
      ];
    if (r.elsewhere)
      return [
        {
          step,
          kind: "quote-not-at-anchor",
          severity: "error",
          message: `Step ${step}: the quote ${quote} is in ${src.docId} but not at ${when}: it is at ${r.elsewhere} — cite ${src.docId}#${r.elsewhere}.`,
          sources: [ref, `${src.docId}#${r.elsewhere}`],
        },
      ];
    return [
      {
        step,
        kind: "quote-not-found",
        severity: "error",
        message:
          r.why === "not-seen"
            ? `Step ${step}: the quote ${quote} is not in the description of a key frame of ${src.docId} at ${when}: copy the exact words of a description (media_show gives them).`
            : r.nearest
              ? `Step ${step}: the quote ${quote} is not said in ${src.docId} around ${when}; the closest words there are « ${short(r.nearest.text)} » at ${r.nearest.anchor} — listen to that moment again and quote what is said.`
              : `Step ${step}: nothing like the quote ${quote} is said in ${src.docId} around ${when}: copy the words of its transcript (media_transcript).`,
        sources: r.nearest ? [ref, `${src.docId}#${r.nearest.anchor}`] : [ref],
      },
    ];
  }
  if (!src.quote.trim())
    return [
      {
        step,
        kind: "quote-not-found",
        severity: "warning",
        message: `Step ${step}: source ${ref} has no quote: add the exact words the step relies on.`,
        sources: [ref],
      },
    ];
  const out: Omit<Finding, "pass">[] = [];
  if (tooShort(src.quote))
    out.push({
      step,
      kind: "quote-weak",
      severity: "warning",
      message: `Step ${step}: the quote ${quote} is too short to prove anything: quote at least ${MIN_WORDS} words (${MIN_CHARS} characters) of ${ref}.`,
      sources: [ref],
    });
  if (r.unsure)
    out.push({
      step,
      kind: "quote-uncertain",
      severity: "warning",
      message: `Step ${step}: ${ref} quotes words the transcription was not sure of: listen to ${when} in Documents › Video, then confirm the line or correct it.`,
      sources: [ref],
    });
  return out;
}

// ponytail: a video source is written at the second of the line its quote starts in (its canonical form) — the same
// source cited a second off, or mid-line, is brought back to it, so two tests citing one sentence name it alike
export function canonicalSources(test: Test, corpus: Corpus): { step: number; from: string; to: string }[] {
  const out: { step: number; from: string; to: string }[] = [];
  test.steps.forEach((s, i) => {
    for (const src of s.sources) {
      if (!src.anchor) continue;
      const anchor = normalizeAnchor(src.anchor);
      const d = corpus.docs.get(src.docId);
      if (!d || !isTimed(anchor) || !src.quote.trim()) continue;
      const r = timed(d, anchor, src.quote);
      if (r.ok && r.canonical !== anchor) out.push({ step: i + 1, from: anchor, to: r.canonical });
    }
  });
  return out;
}

// ponytail: the test's own file is rewritten line by line, only the anchors that move (`to` gives a source's new
// anchor, or null to leave it) — nothing else of it is touched
export function moveSources(
  project: string,
  id: string,
  to: (source: Source, anchor: string) => string | null,
): { from: string; to: string }[] {
  if (!testExists(project, id)) return [];
  const { md } = readTest(project, id);
  let inSources = false;
  const moved: { from: string; to: string }[] = [];
  const lines = md.split("\n").map((line) => {
    if (/^#{1,6}\s/.test(line)) inSources = /^###\s+Sources\s*$/i.test(line.trim());
    if (!inSources) return line;
    const bullet = /^\s*[-*]\s+/.exec(line)?.[0];
    const source = bullet ? parseSource(line.slice(bullet.length).replace(/\r$/, "")) : null;
    if (!bullet || !source?.anchor) return line;
    const anchor = normalizeAnchor(source.anchor);
    const next = to(source, anchor);
    if (!next || next === anchor) return line;
    moved.push({ from: `${source.docId}#${anchor}`, to: `${source.docId}#${next}` });
    return `${bullet}${formatSource({ ...source, anchor: next })}${line.endsWith("\r") ? "\r" : ""}`;
  });
  if (moved.length) writeAtomic(join(testDir(project, id), "test.md"), lines.join("\n"));
  return moved;
}

// ponytail: a video heard again keeps its transcript before until a person applies its report (or puts the old one
// back) — until then no source of that video is moved, so going back leaves the tests as they were
const awaitsReport = (project: string, docId: string, anchor: string): boolean => {
  const n = momentOf(parseAnchor(anchor).id)?.n ?? 1;
  return existsSync(join(project, "docs", docId, "video", `${n}.report.json`));
};

export function canonicalize(project: string, id: string, corpus: Corpus): number {
  if (!testExists(project, id)) return 0;
  if (!canonicalSources(readTest(project, id).test, corpus).length) return 0;
  return moveSources(project, id, (source, anchor) => {
    const d = corpus.docs.get(source.docId);
    if (!d || !isTimed(anchor) || !source.quote.trim() || awaitsReport(project, d.id, anchor)) return null;
    const r = timed(d, anchor, source.quote);
    return r.ok ? r.canonical : null;
  }).length;
}

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
  if ((test.summary ?? "").trim() === NEW_SUMMARY)
    add({
      kind: "empty-field",
      severity: "warning",
      message: `The test is still called « ${NEW_SUMMARY} »: give it a summary that says what it verifies.`,
      sources: [],
    });
  if (!(test.description ?? "").trim())
    add({
      kind: "empty-field",
      severity: "warning",
      message: "The test has no description: say what it verifies and what the tester starts from.",
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
      if (isTimed(anchor)) {
        const gone = d.lost?.has(`${anchor}\n${src.quote}`);
        for (const f of timedFindings(step, src, ref, anchor, timed(d, anchor, src.quote)))
          add(
            gone && f.kind === "quote-not-found"
              ? {
                  ...f,
                  kind: "source-missing",
                  message: `${f.message} The video was heard or described again since this source was written.`,
                }
              : f,
          );
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

export function writeCheck(project: string, id: string, findings: Finding[], verdicts?: StepVerdict[]): CheckFile {
  const md = readTest(project, id).md;
  const file: CheckFile = {
    at: env.now().toISOString(),
    testHash: testMdHash(md),
    findings: bySteps(findings),
    ...(verdicts?.length ? { verdicts: [...verdicts].sort((a, b) => a.step - b.step) } : {}),
  };
  writeJson(join(testDir(project, id), "check.json"), file);
  return file;
}

// ponytail: what is wrong with a source written docId#anchor "quote", as the mechanical pass judges a step's — used
// for the passages a run gives as proof outside a test (an item it did not write, a second look)
export function sourceProblem(corpus: Corpus, src: Source): string | null {
  const d = corpus.docs.get(src.docId);
  if (!d) return `${src.docId} is not a document of this project`;
  const anchor = normalizeAnchor(src.anchor ?? "");
  if (anchor && isTimed(anchor)) {
    const r = timed(d, anchor, src.quote);
    if (r.ok) return null;
    return r.why === "no-video" || r.why === "no-moment" || r.why === "no-frame"
      ? `${src.docId} has nothing to quote at ${anchor}`
      : `the quote "${short(flat(src.quote))}" is not at ${src.docId}#${anchor}`;
  }
  if (!anchor || !d.anchors.has(anchor)) return `${src.docId} has no anchor ${anchor || "(none)"}`;
  if (!src.quote.trim()) return null;
  if (!(scoped(d, anchor) ?? d.text).includes(plainText(src.quote)))
    return `the quote "${short(flat(src.quote))}" is not under ${src.docId}#${anchor}`;
  return null;
}

export function runMechanical(project: string, id: string, corpus: Corpus = loadCorpus(project)): CheckFile {
  canonicalize(project, id, corpus);
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
    const fresh = old && !isStale(project, id, old);
    const semantic = fresh ? semanticOf(old) : [];
    canonicalize(project, id, corpus);
    return writeCheck(
      project,
      id,
      [...mechanicalCheck(project, id, corpus), ...semantic],
      fresh ? old.verdicts : undefined,
    );
  });
}

export const semanticOf = (check: CheckFile | null): Finding[] =>
  (check?.findings ?? []).filter((f) => f.pass === "semantic");

// ponytail: the mechanical pass is recomputed on every record — it costs nothing and is what keeps
// the whole file honest about the testHash it is stamped with
export function recordSemantic(
  project: string,
  id: string,
  findings: Omit<Finding, "pass">[],
  verdicts?: StepVerdict[],
): CheckFile {
  const semantic = findings.map((f) => ({ ...f, sources: f.sources ?? [], pass: "semantic" as const }));
  return writeCheck(project, id, [...mechanicalCheck(project, id), ...semantic], verdicts);
}

// ponytail: the kinds that say a step claims what no passage says, or the contrary — a step that has one cannot be
// « supported »
const DISPROVES: Finding["kind"][] = ["unsupported", "contradicted", "wrong-object", "not-simulated-unsourced"];

// ponytail: what a record of verdicts must hold to be the proof of a check — one verdict per step of the test, the
// passages read for each one judged, a reason for each one left unverified, and no step called supported that a
// finding of the same record disproves
export function verdictProblems(
  steps: number,
  verdicts: StepVerdict[],
  findings: Pick<Finding, "step" | "kind" | "severity">[],
): string[] {
  const out: string[] = [];
  const seen = new Map<number, StepVerdict>();
  for (const v of verdicts) {
    if (v.step > steps) out.push(`steps: step ${v.step} does not exist (the test has ${steps})`);
    else if (seen.has(v.step)) out.push(`steps: step ${v.step} is there twice`);
    else seen.set(v.step, v);
  }
  const missing = Array.from({ length: steps }, (_, i) => i + 1).filter((n) => !seen.has(n));
  if (missing.length) out.push(`steps: no verdict for step ${missing.join(", ")} — give one per step of the test`);
  for (const v of seen.values()) {
    if (v.verdict !== "unverified" && !v.read.length)
      out.push(`steps: step ${v.step} is ${v.verdict} without a passage read — name the docId#anchor you opened`);
    if (v.verdict === "unverified" && !v.why?.trim())
      out.push(`steps: step ${v.step} is unverified without a why — say what stopped you`);
    const disproved = findings.some((f) => f.step === v.step && f.severity === "error" && DISPROVES.includes(f.kind));
    if (v.verdict === "supported" && disproved)
      out.push(`steps: step ${v.step} is called supported, and a finding of this record says its result is not`);
  }
  return out;
}

export function isStale(project: string, id: string, check: CheckFile | null = readCheck(project, id)): boolean {
  return !!check && testMdHash(readTest(project, id).md) !== check.testHash;
}
