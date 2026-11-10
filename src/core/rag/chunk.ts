import type { Chunk, ClaudeRun, DocJson, FigureEntry } from "../types.ts";

export type Section = {
  anchor: string;
  number: string;
  title: string;
  path: string;
  parent: string;
  where: string;
  line: number;
  body: string;
};

export type DocFigure = {
  n: string;
  anchor: string;
  file: string;
  caption: string;
  description: string;
  labels?: string[];
  kind?: FigureEntry["kind"];
  table?: string;
};

export type DescribeChunks = (
  doc: DocJson,
  chunks: Chunk[],
  signal: AbortSignal,
  project?: string,
  run?: ClaudeRun,
) => Promise<string[]>;

export const MAX_TOKENS = 800;

const HEADING = /^(#{1,6})\s+(.*)$/;
const SECTION_ANCHOR = /<!--\s*§\s*(.*?)\s*-->/;
const FIG = /<!--\s*fig\s+(\S+?)\s*-->/g;
export const FIGURE_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*<!--\s*fig\s+(\S+?)\s*-->/g;
const NUMBERED = /^[0-9A-Z]{1,3}(\.[0-9A-Za-z]{1,3})*$/;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sectionPath(key: string): string {
  if (!NUMBERED.test(key)) return key;
  const parts = key.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join(".")).join(" > ");
}

export function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*(?:<!--(?:(?!-->)[\s\S])*-->\s*)+$/.test(l))
    .map((l) => l.replace(/\s*<!--[\s\S]*?-->/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseSections(md: string): Section[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let body: string[] = [];
  // ponytail: a heading without a section number (a requirement id, a title's slug) sits where its heading level
  // puts it: under the nearest heading above it of a lower level — its path and its place in the header say so
  const open: { level: number; s: Pick<Section, "anchor" | "path" | "where"> }[] = [];
  const close = () => {
    if (current) sections.push({ ...current, body: body.join("\n").trim() });
    current = null;
    body = [];
  };
  lines.forEach((line, i) => {
    const h = line.match(HEADING);
    if (h) {
      close();
      const a = h[2].match(SECTION_ANCHOR);
      if (!a) return;
      const key = a[1].trim();
      let title = h[2].replace(/\s*<!--[\s\S]*?-->/g, "").trim();
      if (title.startsWith(`${key} `)) title = title.slice(key.length + 1).trim();
      const level = h[1].length;
      while (open.length && open[open.length - 1].level >= level) open.pop();
      const above = open[open.length - 1]?.s;
      const number = NUMBERED.test(key) ? key : "";
      const path = number || !above ? sectionPath(key) : `${above.path} > ${key}`;
      current = {
        anchor: `§${key}`,
        number,
        title,
        path,
        parent: above?.anchor ?? "",
        where: number ? `${path} ${title}` : above ? `${above.where} > ${title}` : title,
        line: i,
        body: "",
      };
      open.push({ level, s: current });
      return;
    }
    if (current) body.push(line);
  });
  close();
  return sections;
}

export function docFigures(md: string, entries: FigureEntry[]): DocFigure[] {
  const out = new Map<string, DocFigure>();
  for (const m of md.matchAll(FIGURE_IMAGE))
    out.set(m[3], { n: m[3], anchor: `fig:${m[3]}`, file: m[2], caption: m[1], description: "" });
  // ponytail: a caption pasted without its picture keeps its marker on the caption paragraph (§4); it is still a
  // figure, with no file, whose caption is the « Figure N – … » part of that paragraph. A caption right under (or
  // over) a table of the text captions that table: the figure is the table, there is no picture to miss or describe
  const ls = lines(md);
  ls.forEach((line, i) => {
    const m = line.match(/<!--\s*fig\s+(\S+?)\s*-->/);
    if (!m || out.has(m[1])) return;
    const text = stripComments(line);
    const caption = text.match(/\b(?:Figure|Fig\.)\s*\S+\s*[–—:-][\s\S]*$/i)?.[0] ?? text;
    const table = tableBeside(ls, i);
    out.set(m[1], {
      n: m[1],
      anchor: `fig:${m[1]}`,
      file: "",
      caption: caption.trim(),
      description: "",
      ...(table ? { table } : {}),
    });
  });
  for (const e of entries) {
    const n = e.anchor.replace(/^fig:/, "");
    const known = out.get(n);
    // ponytail: an images or video document's pictures (img:, frame:) are not figures of a text
    if (!e.anchor.startsWith("fig:")) continue;
    const file = e.file || known?.file || "";
    out.set(n, {
      n,
      anchor: `fig:${n}`,
      file,
      caption: e.caption || known?.caption || "",
      description: e.description,
      ...(e.labels?.length ? { labels: e.labels } : {}),
      ...(e.kind ? { kind: e.kind } : {}),
      ...(!file && known?.table ? { table: known.table } : {}),
    });
  }
  const at = new Map(ls.flatMap((l, i) => [...l.matchAll(FIG)].map((m) => [m[1], i] as const)));
  return [...out.values()].sort((a, b) => (at.get(a.n) ?? Infinity) - (at.get(b.n) ?? Infinity));
}

const isRow = (l: string | undefined) => !!l && /^\s*\|/.test(l);

// ponytail: the table whose last row is just above the caption line (blank lines between), else whose first row is
// just below it — its rows, as doc.md has them
function tableBeside(ls: string[], i: number): string | undefined {
  const near = (step: number) => {
    let j = i + step;
    while (ls[j] !== undefined && !ls[j].trim()) j += step;
    return j;
  };
  let end = near(-1);
  let start = end;
  if (isRow(ls[end])) while (isRow(ls[start - 1])) start--;
  else {
    start = near(1);
    end = start;
    if (!isRow(ls[start])) return undefined;
    while (isRow(ls[end + 1])) end++;
  }
  return ls
    .slice(start, end + 1)
    .map((l) => l.trim())
    .join("\n");
}

function ids(text: string, re: RegExp): string[] {
  return [...new Set([...text.matchAll(re)].map((m) => m[1]))];
}

function defaultHeader(doc: DocJson, s: Pick<Section, "where">): string {
  return `${doc.code} ${doc.title} — ${s.where}`.trim();
}

// ponytail: a paragraph above the budget is a big table or list — cut it by lines, and repeat a table's
// header rows at the top of every part so each part still reads as the table it comes from
function splitLong(para: string): string[] {
  if (approxTokens(para) <= MAX_TOKENS) return [para];
  const lines = para.split("\n");
  const head = /^\s*\|/.test(lines[0] ?? "") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1] ?? "") ? lines.slice(0, 2) : [];
  const parts: string[] = [];
  let cur: string[] = [];
  for (const line of lines.slice(head.length)) {
    if (cur.length && approxTokens([...head, ...cur, line].join("\n")) > MAX_TOKENS) {
      parts.push([...head, ...cur].join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) parts.push([...head, ...cur].join("\n"));
  return parts;
}

function split(body: string): string[] {
  if (approxTokens(body) <= MAX_TOKENS) return [body];
  const parts: string[] = [];
  let cur = "";
  for (const para of body.split(/\n\s*\n/).flatMap(splitLong)) {
    if (cur && approxTokens(`${cur}\n\n${para}`) > MAX_TOKENS) {
      parts.push(cur);
      cur = para;
    } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) parts.push(cur);
  return parts;
}

// ponytail: a line of an images or video document — a picture (img, frame) or a transcript line — is chunked by its
// own kind, never as a section's text
const MEDIA_LINE = /<!--\s*(img|frame|t)\s+(\S+?)\s*-->/;

export function chunkDoc(doc: DocJson, md: string, entries: FigureEntry[]): Chunk[] {
  const sections = parseSections(md);
  const chunks: Chunk[] = [];
  for (const s of sections) {
    const body = s.body
      .split("\n")
      .filter((l) => !MEDIA_LINE.test(l))
      .join("\n");
    const parts = split(body).filter((p) => stripComments(p));
    parts.forEach((raw, i) => {
      chunks.push({
        id: `${doc.id}#${s.anchor}${parts.length > 1 ? `~${i + 1}` : ""}`,
        docId: doc.id,
        anchor: s.anchor,
        path: s.path,
        figureIds: ids(raw, FIG),
        header: defaultHeader(doc, s),
        text: stripComments(raw),
        kind: "section",
      });
    });
  }
  for (const f of docFigures(md, entries)) {
    const s = sectionAt(sections, markerLine(md, f.n));
    chunks.push({
      id: `${doc.id}#${f.anchor}`,
      docId: doc.id,
      anchor: f.anchor,
      path: s?.path ?? "",
      figureIds: [f.n],
      header: s ? defaultHeader(doc, s) : `${doc.code} ${doc.title}`,
      text: figureText(f),
      kind: "figure",
    });
  }
  chunks.push(...mediaChunks(doc, md, entries, sections));
  return chunks;
}

// ponytail: an image or a key frame is a chunk like a figure (caption, what Claude saw, the text it shows); the
// transcript of a video is cut into passages of whole lines under the token budget, each anchored by its first line
function mediaChunks(doc: DocJson, md: string, entries: FigureEntry[], sections: Section[]): Chunk[] {
  const byAnchor = new Map(entries.map((e) => [e.anchor, e]));
  const out: Chunk[] = [];
  let run: { anchor: string; text: string[]; s?: Section } | null = null;
  const head = (s?: Section) => (s ? defaultHeader(doc, s) : `${doc.code} ${doc.title}`);
  const flush = () => {
    if (!run) return;
    out.push({
      id: `${doc.id}#${run.anchor}`,
      docId: doc.id,
      anchor: run.anchor,
      path: run.s?.path ?? "",
      figureIds: [],
      header: head(run.s),
      text: run.text.join("\n"),
      kind: "transcript",
    });
    run = null;
  };
  lines(md).forEach((line, i) => {
    const m = MEDIA_LINE.exec(line);
    if (!m) return;
    const anchor = `${m[1]}:${m[2]}`;
    const s = sectionAt(sections, i);
    if (m[1] === "t") {
      const text = stripComments(line);
      if (run && (run.s !== s || approxTokens([...run.text, text].join("\n")) > MAX_TOKENS)) flush();
      run ??= { anchor, text: [], s };
      run.text.push(text);
      return;
    }
    const e = byAnchor.get(anchor);
    const caption = e?.caption || /!\[([^\]]*)\]/.exec(line)?.[1] || "";
    out.push({
      id: `${doc.id}#${anchor}`,
      docId: doc.id,
      anchor,
      path: s?.path ?? "",
      figureIds: [],
      header: head(s),
      text: figureText({ caption, description: e?.description ?? "", labels: e?.labels }),
      kind: m[1] === "img" ? "image" : "frame",
    });
  });
  flush();
  return out;
}

// ponytail: the words visible in the picture (descriptions v2) go into the figure chunk so BM25 finds a button or a
// symbol by its label; like the description they are Claude's reading, never quotable (the check reads doc.md only)
export const LABELS_PREFIX = "Visible text:";

function figureText(f: Pick<DocFigure, "caption" | "description" | "labels">): string {
  const labels = (f.labels ?? []).map((l) => l.trim()).filter(Boolean);
  return [f.caption, f.description, labels.length ? `${LABELS_PREFIX} ${labels.join(" · ")}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function markerLine(md: string, figure: string): number {
  return lines(md).findIndex((l) => l.match(/<!--\s*fig\s+(\S+?)\s*-->/)?.[1] === figure);
}

export function lines(md: string): string[] {
  return md.replace(/\r\n/g, "\n").split("\n");
}

export function sectionAt(sections: Section[], line: number): Section | undefined {
  if (line < 0) return undefined;
  let found: Section | undefined;
  for (const s of sections) if (s.line <= line) found = s;
  return found;
}
