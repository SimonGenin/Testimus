import { type Block, REVIEWS, type Review, type Source, type Step, type StepImage, type Test } from "../types.ts";
import { testHash } from "./hash.ts";
import { tablesIn } from "./table.ts";

type Raw = {
  id?: string;
  pre: string[];
  fields: Map<string, string[]>;
  sources: string[];
  images: StepImage[];
  seen: Set<string>;
};

const KNOWN = [
  "key",
  "project",
  "summary",
  "folder",
  "labels",
  "status",
  "covers",
  "cloned_from",
  "preconditions",
  "review",
  "review_note",
  "reviewed_by",
  "reviewed_at",
  "generated_by",
];

const ALIAS: Record<string, string> = {
  action: "Action",
  data: "Data",
  expected: "Expected Result",
  "expected result": "Expected Result",
  "expected results": "Expected Result",
  result: "Expected Result",
};

// ponytail: the two section lists of format v2 (and the single list of v1) name attachments that no
// field embeds — which is exactly what the Attachments list is, so they open as one
const IMAGES = new Set(["attachments", "action images", "expected images", "images"]);

// ponytail: an alias yields to a real step field of that exact name (xray.json), so a custom field
// called « Result » or « Expected » round-trips instead of melting into Expected Result
export const fieldName = (heading: string, known: readonly string[] = []) =>
  known.includes(heading) ? heading : (ALIAS[heading.toLowerCase()] ?? heading);

const FENCE = /^\s*---\s*$/;

// ponytail: the one fence rule — the parser, the review patch and the body hash all find the
// frontmatter here, so a `--- ` or a CRLF can never make one of them see a different file
export function frontmatterOf(md: string): { bom: string; nl: string; head: string[]; rest: string } | null {
  const bom = md.startsWith("﻿") ? "﻿" : "";
  const text = md.slice(bom.length);
  const lines = text.split("\n");
  if (!FENCE.test(lines[0])) return null;
  let off = lines[0].length + 1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      const head = lines.slice(1, i).map((l) => l.replace(/\r$/, ""));
      const rest = text.slice(off + lines[i].replace(/\r$/, "").length);
      return { bom, nl: text.includes("\r\n") ? "\r\n" : "\n", head, rest };
    }
    off += lines[i].length + 1;
  }
  return null;
}

// ponytail: testHash with the fences canonical — equal to testHash(md) for every well-formed file
export function testMdHash(md: string): string {
  const fm = frontmatterOf(md);
  return testHash(fm ? `---\n\n---${fm.rest || "\n"}` : md);
}

// ponytail: reserved `extra` keys start with "#" — no frontmatter key can (a "#" line is a comment):
// "#raw:<key>" = an entry kept as written, "#line:<n>" = a comment or stray line, "#sections" = the
// unknown ## sections of the body as JSON
const SECTIONS = "#sections";
const rawKey = (k: string) => `#raw:${k}`;
export const isReserved = (k: string) => k.startsWith("#");
const LISTS = ["labels", "covers", "preconditions"];
const PROP: Record<string, keyof Test> = {
  cloned_from: "clonedFrom",
  review_note: "reviewNote",
  reviewed_by: "reviewedBy",
  reviewed_at: "reviewedAt",
  generated_by: "generatedBy",
};
const propOf = (k: string) => PROP[k] ?? (k as keyof Test);
const keyOf = (line: string) => (line.trim().startsWith("#") ? null : (/^\s*([^:]+?)\s*:/.exec(line)?.[1] ?? null));
const continues = (line: string) => /^\s/.test(line) || /^-(\s|$)/.test(line);

type Section = { after: number; heading: string; text: string };

function sectionsOf(extra: Record<string, string> | undefined): Section[] {
  try {
    const v: unknown = JSON.parse(extra?.[SECTIONS] ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (s): s is Section =>
        typeof s?.after === "number" &&
        typeof s.heading === "string" &&
        typeof s.text === "string" &&
        !/[\r\n]/.test(s.heading),
    );
  } catch {
    return [];
  }
}

const bare = (l: string) => {
  let n = 0;
  while (l[n] === "\\") n++;
  const rest = l.slice(n);
  return { n, marked: rest.startsWith("#") || rest === "---" };
};

const esc = (l: string) => (bare(l).marked ? "\\" + l : l);
const unesc = (l: string) => {
  const b = bare(l);
  return b.n > 0 && b.marked ? l.slice(1) : l;
};

// ponytail: blank = the empty string, so a whitespace-only line survives the round trip untouched
const trimBlank = (ls: string[]) => {
  let a = 0;
  let b = ls.length;
  while (a < b && ls[a] === "") a++;
  while (b > a && ls[b - 1] === "") b--;
  return ls.slice(a, b);
};

const escText = (t: string) => trimBlank(t.split("\n")).map(esc).join("\n");
const unescText = (ls: string[]) => trimBlank(ls.map(unesc)).join("\n");

const needsQuote = (v: string) =>
  v !== v.trim() || v.startsWith("[") || v.startsWith('"') || v.includes(" #") || /[\r\n]/.test(v);

const fmLine = (k: string, v: string) => (v === "" ? k + ":" : k + ": " + (needsQuote(v) ? JSON.stringify(v) : v));

const unquote = (v: string) => {
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    try {
      const p: unknown = JSON.parse(v);
      if (typeof p === "string") return p;
    } catch {
      return v;
    }
  }
  return v;
};

const splitComment = (s: string): { name: string; comment?: string } => {
  const m = /^(.*?)\s*<!--\s*(.*?)\s*-->\s*$/.exec(s);
  return m ? { name: m[1], comment: m[2] || undefined } : { name: s };
};

const SOURCE = /^([^\s#"]+)#(\S+?)(?:\s+"(.*)")?$/;

export function parseSource(line: string): Source | null {
  const s = SOURCE.exec(line.trim().replace(/^[-*+]\s+/, ""));
  return s ? { docId: s[1], anchor: s[2], quote: s[3] ?? "" } : null;
}

// ponytail: a line that is not docId#anchor "quote" is kept whole in docId, so a human edit is never lost
export const formatSource = (s: Source) =>
  s.anchor === "" && s.quote === "" ? s.docId : `${s.docId}#${s.anchor}${s.quote ? ` "${s.quote}"` : ""}`;

function parseSources(lines: string[], n: number, warnings: string[]): Source[] {
  const out: Source[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = /^\s*(?:([-*+])\s+)?(.*?)\s*$/.exec(line)!;
    if (!m[1]) warnings.push(`Source line without a "- " bullet in step ${n}: "${line.trim()}"`);
    const s = parseSource(m[2]);
    if (!s) {
      warnings.push(`Step ${n}: source "${m[2]}" is not docId#anchor "quote" — kept as written`);
      out.push({ docId: m[2], anchor: "", quote: "" });
      continue;
    }
    if (!s.quote) warnings.push(`Step ${n}: source ${s.docId}#${s.anchor} has no quote`);
    out.push(s);
  }
  return out;
}

type Entry = { key: string | null; value: string; lines: string[] };

function readFrontmatter(lines: string[], warnings: string[]) {
  const entries: Entry[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const last = entries.at(-1);
    if (last?.key && (/^\s*-(\s|$)/.test(line) || (last.value === "" && /^\s/.test(line)))) {
      last.lines.push(line);
      continue;
    }
    const key = keyOf(line);
    if (key === null) {
      entries.push({ key: null, value: "", lines: [line] });
      if (!line.trim().startsWith("#"))
        warnings.push(`Kept frontmatter line "${line.trim()}" as written (expected "key: value")`);
      continue;
    }
    entries.push({ key, value: line.slice(line.indexOf(":") + 1).trim(), lines: [line] });
  }

  const fm = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const raw = new Map<string, string>();
  const extra: Record<string, string> = {};
  let n = 0;
  for (const e of entries) {
    if (e.key === null) {
      extra[`#line:${n++}`] = e.lines[0];
      continue;
    }
    const known = KNOWN.includes(e.key);
    lists.delete(e.key);
    delete extra[rawKey(e.key)];
    raw.set(e.key, e.lines.join("\n"));
    if (e.lines.length > 1) {
      const items = e.lines.slice(1).map((l) => /^\s*-(?:\s+(.*?))?\s*$/.exec(l)?.[1]);
      if (LISTS.includes(e.key) && e.value === "" && items.every((x) => x !== undefined))
        lists.set(
          e.key,
          items.map((x) => unquote(x ?? "")).filter((x) => x !== ""),
        );
      else warnings.push(`Kept the multi-line value of "${e.key}" as written`);
      extra[rawKey(e.key)] = e.lines.join("\n");
      if (known) fm.set(e.key, e.value);
      else delete extra[e.key];
      continue;
    }
    if (known) fm.set(e.key, e.value);
    else extra[e.key] = unquote(e.value);
  }
  return { fm, lists, raw, extra };
}

export function parseTest(md: string, fieldNames: readonly string[] = []): { test: Test; warnings: string[] } {
  const warnings: string[] = [];
  const lines = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let head: string[] = [];

  if (FENCE.test(lines[0] ?? "")) {
    let closed = false;
    for (i = 1; i < lines.length; i++) {
      if (FENCE.test(lines[i])) {
        head = lines.slice(1, i);
        i++;
        closed = true;
        break;
      }
    }
    if (!closed) {
      head = lines.slice(1);
      warnings.push("Frontmatter is not closed by ---");
    }
  } else {
    warnings.push("No frontmatter — key, project and folder are unknown");
  }
  const { fm, lists, raw, extra } = readFrontmatter(head, warnings);

  const desc: string[] = [];
  const raws: Raw[] = [];
  const sections: { after: number; heading: string; lines: string[] }[] = [];
  let cur: string[] | null = desc;
  let imgs: StepImage[] | null = null;
  let step: Raw | null = null;
  let inSection = false;
  let seenHeading = false;
  let warnedPreamble = false;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s*(.*?)\s*$/.exec(line);
    let handled = false;
    if (h) {
      const level = h[1].length;
      const { name, comment } = splitComment(h[2]);
      const lower = name.toLowerCase();
      if (level === 2 && lower === "description") {
        seenHeading = true;
        step = null;
        cur = desc;
        imgs = null;
        inSection = false;
        handled = true;
      } else if (level === 2 && /^step\b/i.test(name)) {
        seenHeading = true;
        step = { id: comment, pre: [], fields: new Map(), sources: [], images: [], seen: new Set() };
        raws.push(step);
        cur = step.pre;
        imgs = null;
        inSection = false;
        handled = true;
      } else if (level === 3 && step && name !== "") {
        const kind = IMAGES.has(lower) ? "images" : lower === "sources" ? "sources" : fieldName(name, fieldNames);
        if (step.seen.has(kind)) warnings.push(`Duplicate "### ${name}" in step ${raws.length}`);
        step.seen.add(kind);
        imgs = kind === "images" ? step.images : null;
        if (kind === "images") cur = null;
        else if (kind === "sources") cur = step.sources;
        else {
          if (!step.fields.has(kind)) step.fields.set(kind, []);
          cur = step.fields.get(kind)!;
        }
        handled = true;
      } else if (level === 2) {
        warnings.push(`Kept unknown section "## ${name}" as written`);
        const s = { after: raws.length, heading: h[2], lines: [] as string[] };
        sections.push(s);
        seenHeading = true;
        step = null;
        cur = s.lines;
        imgs = null;
        inSection = true;
        handled = true;
      } else if (!inSection) {
        warnings.push(`Kept unknown heading "${line.trim()}" as plain text`);
      }
    }
    if (handled) continue;

    if (imgs) {
      if (line.trim() === "") continue;
      const m = /^\s*(?:([-*+])\s+)?(\S.*?)\s*(?:<!--\s*(.*?)\s*-->)?\s*$/.exec(line);
      if (!m) continue;
      if (!m[1]) warnings.push(`Image line without a "- " bullet: "${line.trim()}"`);
      imgs.push(m[3] ? { file: m[2], remoteId: m[3] } : { file: m[2] });
      continue;
    }
    if (cur) {
      if (!seenHeading && !warnedPreamble && line.trim() !== "") {
        warnings.push("Text before the first section was kept as the description");
        warnedPreamble = true;
      }
      cur.push(line);
    }
  }

  const get = (k: string) => unquote(fm.get(k) ?? "");
  const list = (k: string) =>
    lists.get(k) ??
    (fm.get(k) ?? "")
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter((s) => s !== "");

  let review: Review = "draft";
  const rv = get("review");
  if (REVIEWS.includes(rv as Review)) review = rv as Review;
  else if (rv) {
    warnings.push(`Unknown review state "${rv}" — kept as written, read as draft`);
    extra[rawKey("review")] = raw.get("review") ?? `review: ${rv}`;
  }
  if (sections.length)
    extra[SECTIONS] = JSON.stringify(
      sections.map((s) => ({ after: s.after, heading: s.heading, text: trimBlank(s.lines).join("\n") })),
    );

  const steps: Step[] = raws.map((r, n) => {
    const fields: Record<string, string> = {};
    const pre = trimBlank(r.pre);
    if (pre.length) {
      warnings.push(`Text before the first field of step ${n + 1} was kept as its Action`);
      const action = r.fields.get("Action");
      fields.Action = unescText(action ? [...pre, "", ...action] : pre);
    }
    for (const [k, ls] of r.fields) if (!(pre.length && k === "Action")) fields[k] = unescText(ls);
    return { id: r.id, fields, sources: parseSources(r.sources, n + 1, warnings), images: r.images };
  });

  const test: Test = {
    key: get("key") || undefined,
    project: get("project"),
    summary: get("summary"),
    folder: get("folder"),
    labels: list("labels"),
    status: get("status") || undefined,
    description: unescText(desc),
    covers: list("covers"),
    clonedFrom: get("cloned_from") || undefined,
    preconditions: list("preconditions"),
    review,
    reviewNote: get("review_note") || undefined,
    reviewedBy: get("reviewed_by") || undefined,
    reviewedAt: get("reviewed_at") || undefined,
    generatedBy: get("generated_by") || undefined,
    steps,
    extra,
  };
  warnings.push(...outsideTest(test));
  return { test, warnings };
}

export function fieldWarnings(test: Test, known: readonly string[]): string[] {
  const out: string[] = [];
  test.steps.forEach((s, n) => {
    for (const f of Object.keys(s.fields))
      if (!known.includes(f)) out.push(`Step ${n + 1}: "### ${f}" is not a step field of this project (xray.json)`);
  });
  return out;
}

const imageSection = (images: StepImage[]) =>
  "### Attachments\n\n" +
  images.map((im) => "- " + im.file + (im.remoteId ? " <!-- " + im.remoteId + " -->" : "")).join("\n");

// ponytail: an embedded image is a markdown ref inside the field text — one string per field, so the
// file, the parser, the dirty check and Claude all keep treating a field as text
const REF = /!\[\]\(([^()\s"]+)(?:\s+"([^"]*)")?\)/g;
const RAW = /!xray-attachment:\/\/[^!\n]*!/;
// ponytail: an image Xray embeds by address instead of by attachment — a live external URL, or the
// dead `blob:` a paste left behind. Read-only: it is drawn from its own URL, never created here. It
// names no attachment id, so unlike RAW a rebuild cannot break it and the step stays pushable.
// RAW comes first in SCAN, so an `xray-attachment://` never falls through to here
const EXTERN = /!((?:[a-z][a-z0-9+.-]*:)+\/\/[^!\n|]+)(?:\|([^!\n]*))?!/;
const SCAN = new RegExp([REF.source, RAW.source, EXTERN.source].join("|"), "g");

export const imageRef = (file: string, params = "") => `![](${file}${params ? ` "${params}"` : ""})`;

export const mapRefs = (text: string, fn: (file: string, params: string, ref: string) => string) =>
  text.replace(REF, (m: string, file: string, params?: string) => fn(file, params ?? "", m));

// ponytail: blocks carry their offsets, so every edit is one splice — only the one blank line that
// separates two blocks belongs to neither, every other space the user typed stays in its block
export function blocksOf(text: string, images: StepImage[]): Block[] {
  const out: Block[] = [];
  let from = 0;
  for (const t of tablesIn(text)) {
    out.push(...scan(text, images, from, t.at), { kind: "table", ...t });
    from = t.end;
  }
  out.push(...scan(text, images, from, text.length));
  return out;
}

function scan(text: string, images: StepImage[], spanFrom: number, spanTo: number): Block[] {
  const out: Block[] = [];
  const pushText = (from: number, to: number) => {
    const raw = text.slice(from, to);
    if (!raw.trim()) return;
    const at = from + (from > 0 ? (/^\n\n?/.exec(raw)?.[0].length ?? 0) : 0);
    const end = to - (to < text.length ? (/\n\n?$/.exec(raw)?.[0].length ?? 0) : 0);
    out.push({ kind: "text", text: text.slice(at, end), at, end });
  };
  let last = spanFrom;
  SCAN.lastIndex = spanFrom;
  for (let m = SCAN.exec(text); m && m.index < spanTo; m = SCAN.exec(text)) {
    const at = m.index;
    const image = m[1] ? images.find((im) => im.file === m[1]) : undefined;
    // ponytail: a ref to a file the step does not attach is not an image — it stays the text it is
    if (m[1] && !image) continue;
    pushText(last, at);
    out.push(
      image
        ? { kind: "image", image, params: m[2] ?? "", at, end: at + m[0].length }
        : m[3]
          ? { kind: "extern", url: m[3], params: m[4] ?? "", at, end: at + m[0].length }
          : { kind: "raw", text: m[0], at, end: at + m[0].length },
    );
    last = at + m[0].length;
  }
  pushText(last, spanTo);
  return out;
}

// ponytail: a table cell holds blocks of the same field, so every question about "what is in this
// field" is asked here and nowhere else — a screenshot in a cell is embedded, an embed Xray dropped in
// a cell still makes the step unpushable. Offsets stay absolute, so a leaf block splices like any other.
export const leafBlocks = (text: string, images: StepImage[]): Block[] =>
  blocksOf(text, images).flatMap((b) =>
    b.kind === "table"
      ? b.rows.flatMap((r) =>
          r.cells.flatMap((c) => leafBlocks(c.text, images).map((n) => ({ ...n, at: n.at + c.at, end: n.end + c.at }))),
        )
      : [b],
  );

// ponytail: an attachment is a file of the test folder — never absolute, never a drive, never above
// the folder — or a push would upload whatever it names
export const insideTest = (file: string) =>
  file.trim() !== "" &&
  !/^[\\/]/.test(file) &&
  !/^[A-Za-z]:/.test(file) &&
  !/^file:/i.test(file) &&
  !file.split(/[\\/]/).includes("..");

const WEB = /^https?:\/\//i;

export function outsideTest(test: Test): string[] {
  const out: string[] = [];
  test.steps.forEach((s, n) => {
    for (const im of s.images)
      if (!insideTest(im.file))
        out.push(`Step ${n + 1}: attachment "${im.file}" is not a file inside the test folder (images/…)`);
    for (const text of Object.values(s.fields))
      mapRefs(text, (file, _params, ref) => {
        if (!WEB.test(file) && !insideTest(file))
          out.push(`Step ${n + 1}: image "${file}" is not a file inside the test folder (images/…)`);
        return ref;
      });
  });
  return out;
}

export const hasRawEmbed = (s: Step) =>
  Object.values(s.fields).some((t) => leafBlocks(t, s.images).some((b) => b.kind === "raw"));

export const orderFields = (fields: Record<string, string>, order: readonly string[] = []) => [
  ...order.filter((n) => Object.hasOwn(fields, n)),
  ...Object.keys(fields).filter((n) => !order.includes(n)),
];

// ponytail: an entry kept as written goes back only while it still reads as the value the test holds,
// and only if it is that one entry — never a fence, never a second key slipped in
const oneEntry = (raw: string, key: string) => {
  const ls = raw.split("\n");
  return keyOf(ls[0]) === key && !ls.some((l) => FENCE.test(l)) && ls.slice(1).every(continues);
};

function rawEntry(test: Test, key: string): string | null {
  const raw = test.extra?.[rawKey(key)];
  if (raw === undefined || !oneEntry(raw, key)) return null;
  const read = parseTest(`---\n${raw}\n---\n`).test;
  const p = propOf(key);
  return JSON.stringify(read[p] ?? null) === JSON.stringify(test[p] ?? null) ? raw : null;
}

const strayLine = (v: string) => !/[\r\n]/.test(v) && !FENCE.test(v) && keyOf(v) === null;

export function serializeTest(test: Test, fieldOrder: readonly string[] = []): string {
  const fm: string[] = [];
  const put = (key: string, canonical: string | null) => {
    const raw = rawEntry(test, key);
    if (raw !== null) fm.push(raw);
    else if (canonical !== null) fm.push(canonical);
  };
  put("key", test.key ? fmLine("key", test.key) : null);
  put("project", fmLine("project", test.project));
  put("summary", fmLine("summary", test.summary));
  put("folder", fmLine("folder", test.folder));
  put("labels", "labels: [" + test.labels.join(", ") + "]");
  put("status", test.status ? fmLine("status", test.status) : null);
  put("covers", test.covers.length ? "covers: [" + test.covers.join(", ") + "]" : null);
  put("cloned_from", test.clonedFrom ? fmLine("cloned_from", test.clonedFrom) : null);
  put("preconditions", test.preconditions.length ? "preconditions: [" + test.preconditions.join(", ") + "]" : null);
  put("review", fmLine("review", test.review ?? "draft"));
  // ponytail: a note is free prose (colons, quotes, a # now and then) — always quoted, never mis-split
  put("review_note", test.reviewNote ? "review_note: " + JSON.stringify(test.reviewNote) : null);
  put("reviewed_by", test.reviewedBy ? fmLine("reviewed_by", test.reviewedBy) : null);
  put("reviewed_at", test.reviewedAt ? fmLine("reviewed_at", test.reviewedAt) : null);
  put("generated_by", test.generatedBy ? fmLine("generated_by", test.generatedBy) : null);
  for (const [k, v] of Object.entries(test.extra ?? {})) {
    if (k.startsWith("#raw:")) {
      const key = k.slice(5);
      if (!KNOWN.includes(key) && oneEntry(v, key)) fm.push(v);
    } else if (k.startsWith("#line:")) {
      if (strayLine(v)) fm.push(v);
    } else if (!isReserved(k) && !KNOWN.includes(k)) fm.push(fmLine(k, v));
  }

  const desc = escText(test.description);
  const out = ["---\n" + fm.join("\n") + "\n---", desc ? "## Description\n\n" + desc : "## Description"];
  const sections = sectionsOf(test.extra);
  const last = test.steps.length;
  const putSections = (after: number) => {
    for (const s of sections)
      if (Math.min(Math.max(s.after, 0), last) === after) out.push("## " + s.heading + (s.text ? "\n\n" + s.text : ""));
  };
  putSections(0);
  test.steps.forEach((s, n) => {
    if (n > 0) putSections(n);
    out.push("## Step " + (n + 1) + (s.id ? " <!-- " + s.id + " -->" : ""));
    for (const name of orderFields(s.fields, fieldOrder)) {
      const body = escText(s.fields[name]);
      if (body) out.push("### " + name + "\n\n" + body);
    }
    if (s.sources?.length) out.push("### Sources\n\n" + s.sources.map((x) => "- " + formatSource(x)).join("\n"));
    if (s.images.length) out.push(imageSection(s.images));
  });
  if (last > 0) putSections(last);
  return out.join("\n\n") + "\n";
}

// ponytail: two spellings of the same test is the one question every dirty check asks (test.md against
// .remote.md, the local copy against the snapshot Jira sent). Identical bytes are the common case and answer without parsing anything — only a file that
// really differs pays the round trip through the parser, which is what makes a snapshot written by an
// older format, or a hand-reflowed one, still count as clean
export const sameTestMd = (a: string, b: string): boolean =>
  a === b || serializeTest(parseTest(a).test) === serializeTest(parseTest(b).test);

export function newTest(project: string, folder: string, fieldNames: readonly string[] = []): Test {
  return {
    project,
    summary: "New test",
    folder,
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "draft",
    steps: [blankStep(fieldNames)],
    extra: {},
  };
}

export function blankStep(fieldNames: readonly string[] = []): Step {
  return { fields: Object.fromEntries(fieldNames.map((n) => [n, ""])), sources: [], images: [] };
}
