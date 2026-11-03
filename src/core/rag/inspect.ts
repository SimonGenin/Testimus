import { OPS, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readZip } from "../lib/zip.ts";
import { CAPTION_RE } from "./convert.ts";
import { chain, docxStyles } from "./convert-docx.ts";
import { cleanSpaces } from "./convert-html.ts";
import { NUMBER_RE, outlineEntries, readRuns, TOC_RE } from "./convert-pdf-tags.ts";
import { openPdf } from "./pdf.ts";

export type CaptionStyle = { style: string; count: number; sample: string; figure: boolean };

export type PdfProfile = {
  pages: number;
  producer: string;
  creator: string;
  title: string;
  tagged: boolean;
  tagShare: number | null;
  reader: "tagged" | "layout";
  headings: number;
  headingsNumbered: number;
  bookmarks: number;
  bookmarksNumbered: number;
  toc: number;
  tocNumbered: number;
  textless: number[];
  pictures: number;
  figureTags: number;
  tables: number;
  captions: CaptionStyle[];
};

export type DocxProfile = {
  paragraphs: number;
  headings: number;
  headingsNumbered: number;
  headingsTyped: number;
  headingStyles: { style: string; level: number; count: number; numbered: boolean }[];
  tables: number;
  pictures: number;
  media: Record<string, number>;
  shapes: number;
  charts: number;
  objects: number;
  comments: number;
  changes: number;
  captions: CaptionStyle[];
};

const CAPTION_WORDS =
  /^(Figure|FIGURE|Fig\.|FIG\.|Tableau|TABLEAU|Table|TABLE|Illustration|Image|Sch[ée]ma|Photo)\s*(\d+(?:[.-]\d+)*)\s*([-‐‑–—:.])?\s*(\S.{0,200})?$/u;
const isTocLine = (t: string) => /\.{4,}\s*\d+$/.test(t);

// ponytail: « Figure 30 – Aspect » is the style « Figure N – … »; the converter takes only the Figure ones as figures
function captionStyles(lines: string[]): CaptionStyle[] {
  const by = new Map<string, CaptionStyle>();
  for (const raw of lines) {
    const line = cleanSpaces(raw).trim();
    if (line.length > 260 || isTocLine(line)) continue;
    const m = line.match(CAPTION_WORDS);
    if (!m?.[4]) continue;
    const style = `${m[1]} ${m[2].replace(/\d+/g, "N")}${m[3] ? ` ${m[3]}` : ""} …`;
    const s = by.get(style) ?? { style, count: 0, sample: line.slice(0, 120), figure: CAPTION_RE.test(line) };
    s.count++;
    by.set(style, s);
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, 8);
}

type SNode = { role?: string; type?: string; id?: string; children?: SNode[] };

async function pictureCount(page: PDFPageProxy): Promise<number> {
  const ops = await page.getOperatorList();
  let n = 0;
  for (const fn of ops.fnArray) if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) n++;
  return n;
}

export async function inspectPdf(buf: Uint8Array, signal?: AbortSignal): Promise<PdfProfile> {
  const loading = openPdf(buf);
  const doc = await loading.promise;
  try {
    const info = (await doc.getMetadata()).info as { Producer?: string; Creator?: string; Title?: string };
    const outline = outlineEntries((await doc.getOutline()) as { title: string; items: unknown[] }[] | null);
    const p: PdfProfile = {
      pages: doc.numPages,
      producer: info.Producer ?? "",
      creator: info.Creator ?? "",
      title: info.Title ?? "",
      tagged: false,
      tagShare: null,
      reader: "layout",
      headings: 0,
      headingsNumbered: 0,
      bookmarks: outline.length,
      bookmarksNumbered: outline.filter((e) => e.number).length,
      toc: 0,
      tocNumbered: 0,
      textless: [],
      pictures: 0,
      figureTags: 0,
      tables: 0,
      captions: [],
    };
    let inTags = 0;
    let outside = 0;
    const lines: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.aborted) throw new Error("Cancelled.");
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let line = "";
      let chars = 0;
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        chars += it.str.replace(/\s/g, "").length;
        line += it.str;
        if (it.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      if (chars < 20) p.textless.push(n);
      p.pictures += await pictureCount(page);
      const tree = (await page.getStructTree()) as SNode | null;
      if (tree) {
        p.tagged = true;
        const { runs, tagged, loose } = await readRuns(page);
        inTags += tagged;
        outside += loose;
        const ids = (x: SNode, out: string[] = []): string[] => {
          if (x.type === "content" && x.id) out.push(x.id);
          for (const c of x.children ?? []) ids(c, out);
          return out;
        };
        const textOf = (x: SNode) =>
          cleanSpaces(
            ids(x)
              .map((id) => runs.get(id)?.text ?? "")
              .join(" "),
          ).trim();
        const walk = (x: SNode) => {
          const role = x.role ?? "";
          if (/^H[1-6]?$/.test(role)) {
            const t = textOf(x);
            if (t) {
              p.headings++;
              if (NUMBER_RE.test(t)) p.headingsNumbered++;
            }
            return;
          }
          if (role === "TOCI") {
            const m = textOf(x).match(TOC_RE);
            if (m && !/^(figure|fig\.|tableau|table)\s/i.test(m[2])) {
              p.toc++;
              if (m[1]) p.tocNumbered++;
            }
            return;
          }
          if (role === "Figure") p.figureTags++;
          if (role === "Table") p.tables++;
          for (const c of x.children ?? []) walk(c);
        };
        walk(tree);
      }
      page.cleanup();
    }
    if (p.tagged) {
      p.tagShare = inTags + outside ? Math.round((inTags / (inTags + outside)) * 1000) / 1000 : 0;
      p.reader = outside <= 0.02 * (inTags + outside) && p.headings > 0 ? "tagged" : "layout";
    }
    p.captions = captionStyles(lines);
    return p;
  } finally {
    await loading.destroy();
  }
}

const count = (xml: string, re: RegExp) => xml.match(re)?.length ?? 0;
const textOfXml = (xml: string) =>
  cleanSpaces([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("")).trim();

export function inspectDocx(buf: Uint8Array): DocxProfile {
  const zip = readZip(buf);
  const part = (name: string) => {
    const b = zip.get(name);
    return b ? new TextDecoder().decode(b) : "";
  };
  const xml = part("word/document.xml");
  if (!xml) throw new Error("Not a Word document (word/document.xml is missing).");
  const { styles, linked, levelOf } = docxStyles(part("word/styles.xml"), part("word/numbering.xml"));
  const byStyle = new Map<string, DocxProfile["headingStyles"][number]>();
  const p: DocxProfile = {
    paragraphs: 0,
    headings: 0,
    headingsNumbered: 0,
    headingsTyped: 0,
    headingStyles: [],
    tables: count(xml, /<w:tbl>/g),
    pictures: count(xml, /<a:blip\b/g) + count(xml, /<v:imagedata\b/g),
    media: {},
    shapes: 0,
    charts: count(xml, /<c:chart\b/g),
    objects: count(xml, /<w:object\b/g),
    comments: count(part("word/comments.xml"), /<w:comment\b/g),
    changes: count(xml, /<w:(?:ins|del)\b/g),
    captions: [],
  };
  const main = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  p.shapes =
    count(main, /<wps:wsp\b/g) +
    Math.max(0, count(main, /<v:(?:shape|rect|oval|roundrect|line|polyline)\b/g) - count(main, /<v:imagedata\b/g));
  for (const name of zip.keys()) {
    const m = name.match(/^word\/media\/[^/]+\.([a-z0-9]+)$/i);
    if (m) p.media[m[1].toLowerCase()] = (p.media[m[1].toLowerCase()] ?? 0) + 1;
  }
  const captions: string[] = [];
  for (const m of main.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    p.paragraphs++;
    const body = m[1];
    const text = textOfXml(body);
    const styleId = body.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? null;
    const name = styleId ? (styles.get(styleId)?.name ?? styleId) : "";
    if (/caption|l[ée]gende/i.test(name) || /SEQ\s+(Figure|Tableau|Table)/i.test(body)) captions.push(text);
    else if (CAPTION_RE.test(text)) captions.push(text);
    const level = levelOf(styleId);
    if (!level || !text) continue;
    const own = body.match(/<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/)?.[1];
    const numbered =
      own !== undefined
        ? own !== "0"
        : linked.has(styleId!) || !!chain(styles, styleId!, (s) => (s.numId && s.numId !== "0" ? s.numId : undefined));
    p.headings++;
    if (numbered) p.headingsNumbered++;
    if (/^\d{1,3}(?:\.\d{1,3}){0,8}\.?\s+\S/.test(text)) p.headingsTyped++;
    const s = byStyle.get(name) ?? { style: name, level, count: 0, numbered };
    s.count++;
    s.numbered ||= numbered;
    byStyle.set(name, s);
  }
  p.headingStyles = [...byStyle.values()].sort((a, b) => a.level - b.level || b.count - a.count);
  p.captions = captionStyles(captions);
  return p;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pageList = (ns: number[]) => (ns.length > 12 ? `${ns.slice(0, 12).join(", ")}…` : ns.join(", "));

// ponytail: what the profile means for the conversion, in the converter's own terms — the facts Claude weighs
export function hintsOf(o: {
  docx?: DocxProfile;
  pdf?: PdfProfile;
  twin?: string | null;
  converts: "docx" | "pdf";
}): string[] {
  const h: string[] = [];
  const { docx, pdf } = o;
  if (docx && pdf)
    h.push(
      o.converts === "docx"
        ? 'Both copies are here: the .docx is converted and the .pdf lends it the pictures it lacks (conversion.from "pdf" converts the .pdf instead).'
        : 'Both copies are here: the .pdf is converted (conversion.from "docx" converts the .docx instead).',
    );
  if (o.twin)
    h.push(
      `The original's other copy sits beside it, not attached yet: ${o.twin} (docs_convert ${o.twin.toLowerCase().endsWith(".docx") ? "docx" : "pdf"}).`,
    );
  if (pdf && (o.converts === "pdf" || !docx)) {
    if (!pdf.tagged)
      h.push(
        "The PDF is not tagged: the layout reader guesses headings from their numbering and font size, and flattens tables to text.",
      );
    else if (pdf.reader === "tagged")
      h.push(
        `The PDF is tagged (${pct(pdf.tagShare ?? 0)} of the text in the tags, ${plural(pdf.headings, "heading")}): the tagged reader reads its real headings, tables, lists and figures.`,
      );
    else
      h.push(
        `The PDF is tagged but ${pdf.headings ? `${pct(1 - (pdf.tagShare ?? 0))} of its text is outside the tags` : "has no heading tag"}: the layout reader is used (conversion.reader "tagged" forces the tags).`,
      );
    const unnumbered = pdf.headings - pdf.headingsNumbered;
    if (pdf.reader === "tagged" && unnumbered > 0) {
      const back = pdf.bookmarksNumbered
        ? "numbered bookmarks give them back"
        : pdf.tocNumbered
          ? "the tagged table of contents gives them back"
          : "neither bookmarks nor a numbered table of contents give them back: if the pages show numbers, read them (docs_page) and give them as conversion.numbers, or attach the .docx";
      h.push(`${plural(unnumbered, "heading")} carry no number in the PDF text; ${back}.`);
    }
    if (pdf.textless.length)
      h.push(
        pdf.textless.length >= pdf.pages / 2
          ? `${pdf.textless.length} of ${pdf.pages} pages carry no text: a scan. They are kept as page pictures that the figure descriptions read; nothing on them can be quoted — ask for the source document.`
          : `Pages without text (a scan, or only a picture): ${pageList(pdf.textless)}. They are kept as pictures; nothing on them can be quoted.`,
      );
  }
  if (docx && (o.converts === "docx" || !pdf)) {
    if (docx.headings && docx.headingsNumbered + docx.headingsTyped === 0)
      h.push(
        `The .docx has ${plural(docx.headings, "heading")} and none is numbered: they are anchored by their titles.`,
      );
    const meta = (docx.media.emf ?? 0) + (docx.media.wmf ?? 0);
    if (meta)
      h.push(
        `${plural(meta, "EMF/WMF picture")}: ${pdf ? "the .pdf rendering lends them as pictures" : "add the .pdf rendering of the same document to get them"}.`,
      );
    if (docx.shapes)
      h.push(
        `${plural(docx.shapes, "shape")} drawn in Word: the .docx conversion keeps only their labels${pdf ? '; the .pdf shows them drawn (conversion.from "pdf" if they matter more than the .docx structure)' : ""}.`,
      );
    if (docx.charts) h.push(`${plural(docx.charts, "chart")}: not converted from the .docx.`);
    if (docx.comments) h.push(`${plural(docx.comments, "Word comment")}: dropped by the conversion.`);
    if (docx.changes) h.push(`${plural(docx.changes, "tracked change")}: the text is read as if they were accepted.`);
  }
  const caps = [...(o.converts === "pdf" || !docx ? (pdf?.captions ?? []) : (docx?.captions ?? []))];
  const others = caps.filter((c) => !c.figure);
  if (caps.length)
    h.push(
      `Captions: ${caps.map((c) => `« ${c.style} » ×${c.count}`).join(", ")}${others.length ? ` — only Figure captions anchor figures; ${others.map((c) => `« ${c.style} »`).join(", ")} stay text` : ""}.`,
    );
  return h;
}
