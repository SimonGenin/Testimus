import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { anchorsOf, type Converted, type ConvertOpts, guessFromName } from "../rag/convert.ts";
import { convertDocx } from "../rag/convert-docx.ts";
import { convertPdf, pdfFigures } from "../rag/convert-pdf.ts";
import { docContent, readState } from "../rag/indexer.ts";
import type { DocJson, DocKind, DocRef, FigureEntry } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { sha256 } from "./hash.ts";
import { readJson, writeJson } from "./project.ts";

export type TocEntry = { anchor: string; title: string; level: number };
export type Stats = NonNullable<DocJson["stats"]>;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function docDir(project: string, id: string): string {
  if (!ID_RE.test(id)) throw new UserError(`Invalid document id "${id}".`, "Use letters, digits, '_', '-' and '.'.");
  return join(project, "docs", id);
}

export function readDoc(project: string, id: string): DocJson {
  const file = join(docDir(project, id), "doc.json");
  if (!existsSync(file)) throw new UserError(`No document ${id}.`, "testimus docs list shows the project's documents.");
  return { ...(JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as DocJson), id };
}

export function writeDoc(project: string, doc: DocJson): void {
  writeJson(join(docDir(project, doc.id), "doc.json"), doc);
}

// ponytail: a folder of docs/ that is not a document (no doc.json, or a name no id can have) is no document
export function findDoc(project: string, id: string): DocJson | null {
  return ID_RE.test(id) && existsSync(join(project, "docs", id, "doc.json")) ? readDoc(project, id) : null;
}

export function docIds(project: string): string[] {
  const root = join(project, "docs");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((id) => ID_RE.test(id) && existsSync(join(root, id, "doc.json")))
    .sort();
}

export function indexState(project: string): Record<string, string> {
  return readState(project)?.docs ?? {};
}

export function listDocs(project: string): DocRef[] {
  const root = join(project, "docs");
  const state = indexState(project);
  const out: DocRef[] = [];
  for (const id of docIds(project)) {
    const doc = readDoc(project, id);
    const at = state[id];
    const content = docContent(join(root, id), doc);
    out.push({ ...doc, indexed: at === undefined ? "missing" : at === content ? "fresh" : "stale" });
  }
  return out;
}

export const isConverted = (doc: Pick<DocJson, "convertedAt">) => !!doc.convertedAt;

const stemOf = (doc: Pick<DocJson, "source">) => {
  const name = doc.source.path.replace(/^upload: /, "");
  return basename(name, extname(name));
};

export function readFigures(project: string, id: string): FigureEntry[] {
  return readJson<FigureEntry[]>(join(docDir(project, id), "figures.json"), []);
}

export function writeFigures(project: string, id: string, figures: FigureEntry[]): void {
  writeJson(join(docDir(project, id), "figures.json"), figures);
}

export function readContext(project: string, id: string): string {
  const file = join(docDir(project, id), "context.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function writeContext(project: string, id: string, text: string): void {
  writeAtomic(join(docDir(project, id), "context.md"), text.endsWith("\n") || !text ? text : `${text}\n`);
}

export function readDocMd(project: string, id: string): string {
  const file = join(docDir(project, id), "doc.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function tocOf(md: string): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const m of md.matchAll(/^(#{1,6}) (.*?) <!-- § ([^ ]+) -->$/gm))
    toc.push({
      anchor: `§${m[3]}`,
      title: m[2].startsWith(`${m[3]} `) ? m[2].slice(m[3].length + 1) : m[2],
      level: m[1].length - 1,
    });
  return toc;
}

export function normalizeAnchor(anchor: string): { kind: "§" | "fig" | "page"; id: string } {
  const a = anchor.trim().replace(/^[^#\s]*#/, "");
  const m = a.match(/^(§|fig|page)\s*:?\s*(.+)$/);
  return m ? { kind: m[1] as "§", id: m[2].trim() } : { kind: "§", id: a };
}

export function sectionOf(md: string, anchor: string): string | null {
  const { kind, id } = normalizeAnchor(anchor);
  const lines = md.split("\n");
  const marker = `<!-- ${kind} ${id} -->`;
  const start = lines.findIndex((l) => l.includes(marker));
  if (start < 0) return null;
  const heading = (l: string) => l.match(/^(#{1,6}) .*<!-- § /)?.[1].length ?? 0;
  let end = lines.length;
  if (kind === "fig") end = start + 1;
  else
    for (let i = start + 1; i < lines.length; i++) {
      const h = heading(lines[i]);
      if (kind === "§" && h && h <= heading(lines[start])) end = i;
      else if (kind === "page" && (lines[i].startsWith("<!-- page ") || h === 1)) end = i;
      if (end !== lines.length) break;
    }
  return lines.slice(start, end).join("\n").trim();
}

export function headingAt(md: string, anchor: string): string | null {
  const { kind, id } = normalizeAnchor(anchor);
  if (kind === "§") return `§${id}`;
  const lines = md.split("\n");
  const marker = `<!-- ${kind} ${id} -->`;
  for (let i = lines.findIndex((l) => l.includes(marker)); i >= 0; i--) {
    const m = lines[i].match(/^#{1,6} .*<!-- § ([^ ]+) -->$/);
    if (m) return `§${m[1]}`;
  }
  return null;
}

export async function convertSource(file: string, opts: ConvertOpts & { pdf?: string }): Promise<Converted> {
  const ext = extname(file).toLowerCase();
  if (ext === ".docx") {
    const pdf = opts.pdf && existsSync(opts.pdf) ? await pdfFigures(readFileSync(opts.pdf), opts.signal) : undefined;
    return convertDocx(readFileSync(file), { ...opts, pdfFigures: pdf });
  }
  if (ext === ".pdf") return convertPdf(readFileSync(file), opts);
  throw new UserError(`Cannot convert ${ext || "a file without extension"}.`, "Give a .docx (preferred) or a .pdf.");
}

export function writeConverted(dir: string, c: Converted): { figures: FigureEntry[]; stats: Stats } {
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
  return {
    figures,
    stats: {
      sections: a.sections.length,
      figures: figures.length,
      chars: c.md.length,
    },
  };
}

type Progress = (message: string) => void;

export async function addDoc(
  project: string,
  input: { file: string; id?: string; pdf?: string; kind?: DocKind; convert?: boolean },
  signal?: AbortSignal,
  progress: Progress = () => {},
): Promise<DocJson> {
  const file = resolve(input.file);
  const ext = extname(file).toLowerCase();
  if (!existsSync(file)) throw new UserError(`File not found: ${file}`, "Give the path of a .docx or .pdf file.");
  if (ext !== ".docx" && ext !== ".pdf")
    throw new UserError(`Cannot add ${ext || "a file without extension"}.`, "Give a .docx (preferred) or a .pdf.");
  if (input.pdf && extname(input.pdf).toLowerCase() !== ".pdf")
    throw new UserError(`--pdf must be a .pdf file: ${input.pdf}`, "Give the PDF rendering of the same document.");
  // ponytail: the .docx saved beside a .pdf under the same name is the same document with its structure intact
  // (numbering, styles); it is converted, and the .pdf kept beside it lends its pictures
  const twin = join(dirname(file), `${basename(file, extname(file))}.docx`);
  if (ext === ".pdf" && !input.pdf && existsSync(twin))
    return addDoc(project, { ...input, file: twin, pdf: file }, signal, progress);
  const guess = guessFromName(file);
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
    writeAtomic(target, readFileSync(file));
    if (input.pdf && ext === ".docx") writeAtomic(pdfTarget, readFileSync(resolve(input.pdf)));
    const bytes = readFileSync(target);
    const source = { path: file, sha256: sha256(bytes), file: `source${ext}` };
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
        convertedWith: "",
        convertedAt: "",
        warnings: [],
      };
      writeDoc(project, doc);
      return doc;
    }
    progress(`Converting ${ext.slice(1)}`);
    const c = await convertSource(target, {
      code: guess.code,
      pdf: existsSync(pdfTarget) && ext === ".docx" ? pdfTarget : undefined,
      signal,
    });
    if (signal?.aborted) throw new Error("Cancelled.");
    progress("Writing doc.md and figures");
    const { stats } = writeConverted(dir, c);
    const doc: DocJson = {
      id,
      code: guess.code,
      title: c.meta.title || guess.code,
      version: guess.version,
      date: c.meta.date,
      kind: input.kind ?? "spec",
      status: "draft",
      source,
      convertedWith: c.convertedWith,
      convertedAt: env.now().toISOString(),
      warnings: c.warnings,
      stats,
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
    throw new UserError(`${id} was added from a .pdf: it has no .docx to complete.`);
  if (extname(file).toLowerCase() !== ".pdf" || !existsSync(file))
    throw new UserError(`Not a .pdf file: ${file}`, "Give the PDF rendering of the same document.");
  writeAtomic(join(docDir(project, id), "source.pdf"), readFileSync(file));
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
  const bytes = readFileSync(file);
  writeAtomic(join(docDir(project, id), "source.docx"), bytes);
  const next: DocJson = { ...doc, source: { path: file, sha256: sha256(bytes), file: "source.docx" } };
  writeDoc(project, next);
  return next;
}

// ponytail: the original's other copy — the .docx saved beside a .pdf under the same name, or the reverse
export function twinOf(path: string): string | null {
  if (path.startsWith("upload: ")) return null;
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
  const c = await convertSource(file, {
    code: doc.code,
    pdf: extname(file).toLowerCase() === ".docx" && existsSync(pdf) ? pdf : undefined,
    reader: o.reader,
    numbers: o.numbers,
    signal,
  });
  if (signal?.aborted) throw new Error("Cancelled.");
  progress("Writing doc.md and figures");
  const { stats } = writeConverted(dir, c);
  // ponytail: a document added without conversion carries its file name as title until its first conversion
  // reads the real one; a title the team typed is kept
  const named = !isConverted(doc) && doc.title === stemOf(doc);
  const next: DocJson = {
    ...doc,
    ...(named && c.meta.title ? { title: c.meta.title } : {}),
    date: doc.date || c.meta.date,
    source: { ...doc.source, sha256: sha256(readFileSync(source)) },
    convertedWith: c.convertedWith,
    convertedAt: env.now().toISOString(),
    warnings: c.warnings,
    stats,
  };
  writeDoc(project, next);
  return next;
}

export function removeDoc(project: string, id: string): string[] {
  readDoc(project, id);
  rmSync(docDir(project, id), { recursive: true, force: true });
  const touched: string[] = [];
  for (const other of listDocs(project)) {
    const { indexed: _, ...doc } = other;
    if (!doc.amends?.includes(id)) continue;
    const amends = doc.amends.filter((a) => a !== id);
    if (amends.length) doc.amends = amends;
    else delete doc.amends;
    writeDoc(project, doc);
    touched.push(doc.id);
  }
  return touched;
}
