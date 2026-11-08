import { basename, extname } from "node:path";
import type { DocConversion } from "../types.ts";
import type { Block } from "./convert-html.ts";

export const CAPTION_RE =
  /^(?:Figure|FIGURE|Fig\.|FIG\.)\s*(\d+(?:[.-]\d+)*)(?![.-]?\d)\s*(?:[-‐‑–—:.]\s*|\s+(?=\S)(?!\p{Ll}))(.{1,300})$/u;
export const TRAILING_CAPTION_RE =
  /(?:^|\s)((?:Figure|FIGURE|Fig\.|FIG\.)\s*(\d+(?:[.-]\d+)*)(?![.-]?\d)\s*[-‐‑–—:]\s*[^.!?]{3,160})$/u;

export type Figure = { key: string; caption: string; ext: string; data: Uint8Array };

export type Converted = {
  md: string;
  figures: Figure[];
  warnings: string[];
  meta: { title: string; date: string };
  convertedWith: string;
};

export type ConvertOpts = {
  code: string;
  /** the title a text file takes when it has no heading of its own (its file name, or the team's title) */
  title?: string;
  reader?: DocConversion["reader"];
  numbers?: DocConversion["numbers"];
  pdfFigures?: Figure[];
  /** pictures drawn from the PDF pages (conversion figures), by figure key: a caption without a picture takes its own */
  crops?: Map<string, Figure>;
  signal?: AbortSignal;
};

export function slug(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "section"
  );
}

// ponytail: a heading title as compared with a list of numbered titles (bookmarks, a table of contents, numbers
// read on the page): accents, case, spaces and punctuation do not count
export const titleKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export function uniqueKey(used: Set<string>, base: string): string {
  let key = base;
  for (let k = 2; used.has(key); k++) key = `${base}-${k}`;
  used.add(key);
  return key;
}

export function extOf(contentType: string): string {
  const t = contentType.toLowerCase().replace(/^image\//, "");
  if (t === "jpeg" || t === "pjpeg") return "jpg";
  if (t === "x-emf" || t === "emf") return "emf";
  if (t === "x-wmf" || t === "wmf") return "wmf";
  if (t === "svg+xml") return "svg";
  if (t === "tiff" || t === "x-tiff") return "tif";
  return /^[a-z0-9]+$/.test(t) ? t : "bin";
}

export function guessFromName(file: string): { code: string; version: string } {
  const stem = basename(file, extname(file));
  const m = stem.match(/^(.+)[_ -]v?(\d{1,2})[._](\d{1,2})(?:[_ -][A-Za-z]+)*$/i);
  if (m) return { code: m[1], version: `${m[2]}.${m[3]}` };
  return { code: stem.replace(/[^A-Za-z0-9_.-]+/g, "_"), version: "" };
}

export function guessDate(text: string): string {
  const m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso ? iso[0] : "";
}

export function guessTitle(lines: string[]): string {
  const clean = lines
    .map((l) =>
      l
        .replace(/[*_#|]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 2);
  return (
    clean.find((l) => /sp[ée]cification|specification|description|manuel|notice|dossier|cahier/i.test(l)) ??
    clean[0] ??
    ""
  );
}

export type Anchors = { sections: string[]; figures: string[] };

export function anchorsOf(md: string): Anchors {
  const a: Anchors = { sections: [], figures: [] };
  for (const m of md.matchAll(/<!-- (§|fig) ([^ ]+) -->/g)) (m[1] === "§" ? a.sections : a.figures).push(m[2]);
  return a;
}

const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)(?: <!--[^>]*-->)?$/;
const MARKER_LINE = /^(?:<!--(?:(?!-->)[\s\S])*-->\s*)+$/;

// ponytail: a body in which the conversion recognised no heading becomes one section under the document's title — its
// head line takes the anchor, a slug like any unnumbered heading — so its text is
// shown, indexed and quotable; a body with no text (a scan) stays as it is. The next conversion with headings drops it
export function wholeSection(c: Converted, title: string, from: "docx" | "pdf"): Converted {
  const [head, ...rest] = c.md.split("\n");
  if (!head.startsWith("# ") || anchorsOf(c.md).sections.length) return c;
  const text = rest.some((l) => l.trim() && !IMAGE_LINE.test(l.trim()) && !MARKER_LINE.test(l.trim()));
  if (!text) return c;
  const anchor = slug(title);
  const [why, fix] =
    from === "docx"
      ? [
          " (no paragraph in a heading style)",
          "Apply Word's heading styles (Heading 1, Titre 1…) and convert again to get sections.",
        ]
      : ["", "Add its .docx, or a PDF whose headings are numbered or tagged, and convert again to get sections."];
  return {
    ...c,
    md: [`# ${title} <!-- § ${anchor} -->`, ...rest].join("\n"),
    warnings: [
      ...c.warnings,
      `No heading recognised in the document${why}: all its text is one section « ${title} » (§${anchor}). ${fix}`,
    ],
  };
}

export function assemble(head: string, blocks: Block[]): string {
  return `${[head, ...blocks.map((b) => b.md)].join("\n\n")}\n`;
}

export function sameCaption(a: string, b: string): boolean {
  const body = (s: string) =>
    s
      .replace(CAPTION_RE, "$2")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const x = body(a);
  const y = body(b);
  const n = Math.min(x.length, y.length, 24);
  return n >= 6 && x.slice(0, n) === y.slice(0, n);
}
