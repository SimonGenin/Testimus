import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import {
  anchorsOf,
  type Converted,
  type ConvertOpts,
  type Figure,
  guessFromName,
  wholeSection,
} from "../rag/convert.ts";
import { convertDocx } from "../rag/convert-docx.ts";
import { convertPdf, pdfFigures } from "../rag/convert-pdf.ts";
import { convertText } from "../rag/convert-text.ts";
import { renderPage } from "../rag/pdf.ts";
import type { DocConversion, DocJson, DocKind, DocStats, FigureEntry } from "../types.ts";
import { copyFileAtomic, writeAtomic } from "./atomic.ts";
import { docDir, isConverted, readDoc, writeDoc } from "./docs.ts";
import { idOf } from "./docs-folder.ts";
import { sha256 } from "./hash.ts";
import { readJson, writeJson } from "./project.ts";

type Progress = (message: string) => void;

const stemOf = (doc: Pick<DocJson, "source">) => basename(doc.source.name, extname(doc.source.name));

const copyOf = (dir: string, file: string) => ({ file, sha256: sha256(readFileSync(join(dir, file))) });

const fromOf = (file: string) => (extname(file).toLowerCase() === ".docx" ? "docx" : "pdf");

export const CONVERTED = /\.(docx|pdf|txt|md)$/i;
const isText = (ext: string) => ext === ".txt" || ext === ".md";

export async function convertSource(file: string, opts: ConvertOpts & { pdf?: string }): Promise<Converted> {
  const ext = extname(file).toLowerCase();
  if (ext === ".docx") {
    const pdf = opts.pdf && existsSync(opts.pdf) ? await pdfFigures(readFileSync(opts.pdf), opts.signal) : undefined;
    return convertDocx(readFileSync(file), { ...opts, pdfFigures: pdf });
  }
  if (ext === ".pdf") return convertPdf(readFileSync(file), opts);
  if (isText(ext)) return convertText(readFileSync(file), { markdown: ext === ".md", title: opts.title || opts.code });
  throw new UserError(
    `Cannot convert ${ext || "a file without extension"}.`,
    "Give a .docx (preferred), a .pdf or a .txt.",
  );
}

// ponytail: the pictures are written again under their anchors; a figure Claude described keeps its description
export function writeConverted(dir: string, c: Converted): { figures: FigureEntry[]; stats: DocStats } {
  const figDir = join(dir, "figures");
  const previous = new Map<string, FigureEntry>();
  for (const f of readJson<FigureEntry[]>(join(dir, "figures.json"), [])) if (f.description) previous.set(f.anchor, f);
  if (existsSync(figDir)) for (const f of readdirSync(figDir)) if (f.startsWith("fig-")) rmSync(join(figDir, f));
  if (c.figures.length) mkdirSync(figDir, { recursive: true });
  const figures: FigureEntry[] = c.figures.map((f) => {
    const file = `figures/fig-${f.key}.${f.ext}`;
    writeAtomic(join(dir, file), f.data);
    const anchor = `fig:${f.key}`;
    const p = previous.get(anchor);
    return {
      file,
      anchor,
      caption: f.caption,
      description: p?.description ?? "",
      ...(p?.labels ? { labels: p.labels } : {}),
      ...(p?.kind ? { kind: p.kind } : {}),
    };
  });
  writeAtomic(join(dir, "doc.md"), c.md);
  writeJson(join(dir, "figures.json"), figures);
  const a = anchorsOf(c.md);
  return { figures, stats: { sections: a.sections.length, figures: figures.length, chars: c.md.length } };
}

export async function addDoc(
  project: string,
  input: { file: string; id?: string; pdf?: string; kind?: DocKind; convert?: boolean },
  signal?: AbortSignal,
  progress: Progress = () => {},
): Promise<DocJson> {
  const file = resolve(input.file);
  const ext = extname(file).toLowerCase();
  if (!existsSync(file)) throw new UserError(`File not found: ${file}`, "Give the path of a .docx or .pdf file.");
  if (!CONVERTED.test(file))
    throw new UserError(
      `Cannot add ${ext || "a file without extension"} this way.`,
      "Give a .docx (preferred), a .pdf or a .txt; images and videos are added with docs.addFiles or media.add.",
    );
  if (input.pdf && extname(input.pdf).toLowerCase() !== ".pdf")
    throw new UserError(`--pdf must be a .pdf file: ${input.pdf}`, "Give the PDF rendering of the same document.");
  // ponytail: the .docx saved beside a .pdf under the same name is the same document with its structure intact
  // (numbering, styles); it is converted, and the .pdf kept beside it lends its pictures
  const twin = join(dirname(file), `${basename(file, extname(file))}.docx`);
  if (ext === ".pdf" && !input.pdf && existsSync(twin))
    return addDoc(project, { ...input, file: twin, pdf: file }, signal, progress);
  const guess = { ...guessFromName(file), code: idOf(file) };
  const id = input.id || guess.code;
  const dir = docDir(project, id);
  if (existsSync(join(dir, "doc.json")))
    throw new UserError(
      `Document ${id} already exists.`,
      `Use docs.convert ${id} to reconvert it, or --id for another id.`,
    );
  const target = join(dir, `source${ext}`);
  const pdfTarget = join(dir, "source.pdf");
  const docsRoot = resolve(project, "docs") + sep;
  for (const src of [file, input.pdf ? resolve(input.pdf) : ""])
    if (src.toLowerCase().startsWith(docsRoot.toLowerCase()))
      throw new UserError(
        "This file is already a copy inside the project's docs folder.",
        "Add the client's original from where it lives; Testimus copies it. To reconvert, use docs.convert.",
      );
  mkdirSync(dir, { recursive: true });
  try {
    progress("Copying the original");
    await copyFileAtomic(file, target);
    if (input.pdf && ext === ".docx") await copyFileAtomic(resolve(input.pdf), pdfTarget);
    const source = { name: file, ...copyOf(dir, `source${ext}`) };
    const twin = input.pdf && ext === ".docx" ? { twin: copyOf(dir, "source.pdf") } : {};
    if (input.convert === false) {
      const doc: DocJson = {
        id,
        code: guess.code,
        title: basename(file, extname(file)),
        version: guess.version,
        date: "",
        kind: input.kind ?? "spec",
        status: "draft",
        source,
        ...twin,
      };
      writeDoc(project, doc);
      return doc;
    }
    progress(`Converting ${ext.slice(1)}`);
    const converted = await convertSource(target, {
      code: guess.code,
      title: basename(file, extname(file)),
      pdf: existsSync(pdfTarget) && ext === ".docx" ? pdfTarget : undefined,
      signal,
    });
    if (signal?.aborted) throw new Error("Cancelled.");
    const title = converted.meta.title || guess.code;
    const c = isText(ext) ? converted : wholeSection(converted, title || id, fromOf(target));
    progress("Writing doc.md and figures");
    const { stats } = writeConverted(dir, c);
    const doc: DocJson = {
      id,
      code: guess.code,
      title,
      version: guess.version,
      date: c.meta.date,
      kind: input.kind ?? "spec",
      status: "draft",
      source,
      ...twin,
      converted: { with: c.convertedWith, at: env.now().toISOString(), warnings: c.warnings, stats },
    };
    writeDoc(project, doc);
    return doc;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

// ponytail: a PDF rendering added after the .docx is copied beside it, where the next conversion takes its figures from
export function attachPdf(project: string, id: string, pdf: string): void {
  const doc = readDoc(project, id);
  const file = resolve(pdf);
  if (extname(doc.source.file || "").toLowerCase() !== ".docx")
    throw new UserError(
      `${id} was added from a .pdf: it has no .docx to complete.`,
      `Give its Word file with --docx instead: testimus docs convert ${id} --docx <file.docx>`,
    );
  if (extname(file).toLowerCase() !== ".pdf" || !existsSync(file))
    throw new UserError(`Not a .pdf file: ${file}`, "Give the PDF rendering of the same document.");
  writeAtomic(join(docDir(project, id), "source.pdf"), readFileSync(file));
  writeDoc(project, { ...doc, twin: copyOf(docDir(project, id), "source.pdf") });
}

// ponytail: the .docx of a document added from its .pdf becomes its source — the .pdf stays beside it and lends
// its pictures, as when both were added together
export function attachDocx(project: string, id: string, docx: string): DocJson {
  const doc = readDoc(project, id);
  const file = resolve(docx);
  if (extname(doc.source.file || "").toLowerCase() !== ".pdf")
    throw new UserError(`${id} was added from a .docx already.`, "Give its PDF rendering with --pdf instead.");
  if (extname(file).toLowerCase() !== ".docx" || !existsSync(file))
    throw new UserError(`Not a .docx file: ${file}`, "Give the Word file of the same document.");
  writeAtomic(join(docDir(project, id), "source.docx"), readFileSync(file));
  const dir = docDir(project, id);
  const next: DocJson = {
    ...doc,
    source: { name: file, ...copyOf(dir, "source.docx") },
    twin: copyOf(dir, doc.source.file),
  };
  writeDoc(project, next);
  return next;
}

// ponytail: the original's other copy — the .docx saved beside a .pdf under the same name, or the reverse; an
// upload has no folder to look in
export function twinOf(source: DocJson["source"]): string | null {
  if (source.uploaded) return null;
  const path = source.name;
  const ext = extname(path).toLowerCase();
  const other = join(dirname(path), `${basename(path, extname(path))}${ext === ".pdf" ? ".docx" : ".pdf"}`);
  return existsSync(other) ? other : null;
}

// ponytail: when both copies are there, the one the study (or the team) chose is converted; else the source,
// a .docx lending the .pdf beside it its pictures
export function convertedCopy(project: string, doc: DocJson): string {
  const dir = docDir(project, doc.id);
  const from = doc.conversion?.from;
  const pick = from && join(dir, `source.${from}`);
  return pick && existsSync(pick) ? pick : join(dir, doc.source.file || "");
}

// ponytail: the options are kept in doc.json, so every later reconversion gives the same result; {} clears them
export function setConversion(project: string, id: string, conversion: DocConversion): DocJson {
  const { conversion: _, ...doc } = readDoc(project, id);
  const next: DocJson = Object.keys(conversion).length ? { ...doc, conversion } : doc;
  writeDoc(project, next);
  return next;
}

// ponytail: a figure the conversion finds no picture for is drawn from the region of the PDF page the conversion
// options name (Claude looked at the page and chose it) — every reconversion draws it again
async function cropsOf(pdf: string, figures: DocConversion["figures"] = []) {
  const crops = new Map<string, Figure>();
  const warnings: string[] = [];
  if (!figures.length) return { crops, warnings };
  if (!existsSync(pdf)) {
    const keys = figures.map((f) => f.key).join(", ");
    warnings.push(`Figure ${keys}: kept as a region of a PDF page, but the document has no PDF copy`);
    return { crops, warnings };
  }
  const buf = readFileSync(pdf);
  for (const f of figures)
    try {
      const { png } = await renderPage(buf, f.page, f.region);
      crops.set(f.key, { key: f.key, caption: "", ext: "png", data: png });
    } catch (e) {
      warnings.push(
        `Figure ${f.key}: page ${f.page} of the PDF could not be drawn (${e instanceof Error ? e.message : e})`,
      );
    }
  return { crops, warnings };
}

export async function reconvertDoc(
  project: string,
  id: string,
  signal?: AbortSignal,
  progress: Progress = () => {},
): Promise<DocJson> {
  const doc = readDoc(project, id);
  const dir = docDir(project, id);
  const source = join(dir, doc.source.file || "");
  if (!doc.source.file || !existsSync(source))
    throw new UserError(`The copy of the original is missing: ${source}`, "Remove the document and add it again.");
  const pdf = join(dir, "source.pdf");
  const o = doc.conversion ?? {};
  const file = convertedCopy(project, doc);
  progress(`Converting ${basename(file)}`);
  const { crops, warnings } = await cropsOf(pdf, o.figures);
  const converted = await convertSource(file, {
    code: doc.code,
    title: doc.title,
    pdf: extname(file).toLowerCase() === ".docx" && existsSync(pdf) ? pdf : undefined,
    reader: o.reader,
    numbers: o.numbers,
    crops,
    signal,
  });
  if (signal?.aborted) throw new Error("Cancelled.");
  const used = new Set(converted.figures.map((f) => f.data));
  for (const [key, crop] of crops)
    if (!used.has(crop.data))
      warnings.push(`Figure ${key}: drawn from the PDF page, but no caption of that number lacks a picture — unused`);
  converted.warnings.push(...warnings);
  // ponytail: a document added without conversion carries its file name as title until its first conversion
  // reads the real one; a title the team typed is kept
  const named = !isConverted(doc) && doc.title === stemOf(doc);
  const title = named && converted.meta.title ? converted.meta.title : doc.title;
  const c = isText(extname(file).toLowerCase()) ? converted : wholeSection(converted, title || id, fromOf(file));
  progress("Writing doc.md and figures");
  const { stats } = writeConverted(dir, c);
  const next: DocJson = {
    ...doc,
    title,
    date: doc.date || c.meta.date,
    source: { ...doc.source, sha256: sha256(readFileSync(source)) },
    ...(doc.twin && existsSync(join(dir, doc.twin.file)) ? { twin: copyOf(dir, doc.twin.file) } : {}),
    converted: { with: c.convertedWith, at: env.now().toISOString(), warnings: c.warnings, stats },
  };
  writeDoc(project, next);
  return next;
}
