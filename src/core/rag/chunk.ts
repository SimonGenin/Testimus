import type { Chunk, ClaudeRun, DocJson, FigureEntry } from "../types.ts";

export type Section = {
  anchor: string;
  number: string;
  title: string;
  path: string;
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
};

export type DescribeChunks = (
  doc: DocJson,
  chunks: Chunk[],
  signal: AbortSignal,
  project?: string,
  run?: ClaudeRun,
) => Promise<string[]>;

export const hooks: { describeChunks: DescribeChunks | null } = { describeChunks: null };

export const MAX_TOKENS = 800;

const HEADING = /^#{1,6}\s+(.*)$/;
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
    .filter((l) => !/^\s*<!--[\s\S]*?-->\s*$/.test(l))
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
  const close = () => {
    if (current) sections.push({ ...current, body: body.join("\n").trim() });
    current = null;
    body = [];
  };
  lines.forEach((line, i) => {
    const h = line.match(HEADING);
    if (h) {
      close();
      const a = h[1].match(SECTION_ANCHOR);
      if (!a) return;
      const key = a[1].trim();
      let title = h[1].replace(/\s*<!--[\s\S]*?-->/g, "").trim();
      if (title.startsWith(`${key} `)) title = title.slice(key.length + 1).trim();
      current = {
        anchor: `§${key}`,
        number: NUMBERED.test(key) ? key : "",
        title,
        path: sectionPath(key),
        line: i,
        body: "",
      };
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
  // figure, with no file, whose caption is the « Figure N – … » part of that paragraph
  for (const line of lines(md)) {
    const m = line.match(/<!--\s*fig\s+(\S+?)\s*-->/);
    if (!m || out.has(m[1])) continue;
    const text = stripComments(line);
    const caption = text.match(/\b(?:Figure|Fig\.)\s*\S+\s*[–—:-][\s\S]*$/i)?.[0] ?? text;
    out.set(m[1], { n: m[1], anchor: `fig:${m[1]}`, file: "", caption: caption.trim(), description: "" });
  }
  for (const e of entries) {
    const n = e.anchor.replace(/^fig:/, "");
    const known = out.get(n);
    out.set(n, {
      n,
      anchor: `fig:${n}`,
      file: e.file || known?.file || "",
      caption: e.caption || known?.caption || "",
      description: e.description,
      ...(e.labels?.length ? { labels: e.labels } : {}),
      ...(e.kind ? { kind: e.kind } : {}),
    });
  }
  return [...out.values()];
}

function ids(text: string, re: RegExp): string[] {
  return [...new Set([...text.matchAll(re)].map((m) => m[1]))];
}

export function defaultHeader(doc: DocJson, s: Pick<Section, "path" | "title" | "number">): string {
  const where = s.number ? `${s.path} ${s.title}` : s.title;
  return `${doc.code} ${doc.title} — ${where}`.trim();
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

export function chunkDoc(doc: DocJson, md: string, entries: FigureEntry[]): Chunk[] {
  const sections = parseSections(md);
  const chunks: Chunk[] = [];
  for (const s of sections) {
    const parts = split(s.body).filter((p) => stripComments(p));
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
  return chunks;
}

// ponytail: the words visible in the picture (descriptions v2) go into the figure chunk so BM25 finds a button or a
// symbol by its label; like the description they are Claude's reading, never quotable (the check reads doc.md only)
export const LABELS_PREFIX = "Visible text:";

export function figureText(f: Pick<DocFigure, "caption" | "description" | "labels">): string {
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
