import { basename, extname } from "node:path";
import type { Block } from "./convert-html.ts";

export const CAPTION_RE = /^(?:Figure|Fig\.)\s*(\d+)\s*(?:[-‐‑–—:.]\s*|\s+(?=\S))(.{0,300})$/i;
export const TRAILING_CAPTION_RE = /(?:^|\s)((?:Figure|Fig\.)\s*(\d+)\s*[-‐‑–—:]\s*[^.!?]{3,160})$/i;

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
  reqPatterns?: string[];
  pdfFigures?: Figure[];
  signal?: AbortSignal;
};

// ponytail: the requirement ids are the project's (its requirement trace); with none, nothing is a requirement
export function reqRegex(patterns: string[] = []): RegExp {
  return patterns.length ? new RegExp(patterns.map((p) => `(?:${p})`).join("|"), "g") : /(?!)/g;
}

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

export type Anchors = { sections: string[]; requirements: string[]; figures: string[] };

export function anchorsOf(md: string): Anchors {
  const a: Anchors = { sections: [], requirements: [], figures: [] };
  for (const m of md.matchAll(/<!-- (§|req|fig|page) ([^ ]+) -->/g)) {
    if (m[1] === "§") a.sections.push(m[2]);
    else if (m[1] === "req") a.requirements.push(m[2]);
    else if (m[1] === "fig") a.figures.push(m[2]);
  }
  return a;
}

export function assemble(head: string, blocks: Block[], reqs: RegExp): string {
  const owner = new Map<string, number>();
  const found = blocks.map((b) => [...new Set([...b.text.matchAll(reqs)].map((m) => m[0]))]);
  found.forEach((ids, i) => {
    const lead = blocks[i].text.replace(/^[\s*_|-]+/, "");
    for (const id of ids) if (!owner.has(id) && lead.startsWith(id)) owner.set(id, i);
  });
  found.forEach((ids, i) => {
    for (const id of ids) if (!owner.has(id)) owner.set(id, i);
  });
  const out = [head];
  blocks.forEach((b, i) => {
    const mine = found[i].filter((id) => owner.get(id) === i);
    out.push(mine.map((id) => `<!-- req ${id} -->\n`).join("") + b.md);
  });
  return `${out.join("\n\n")}\n`;
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
