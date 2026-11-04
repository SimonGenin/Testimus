import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { UserError } from "../command.ts";
import { parseAnchor } from "../rag/anchors.ts";
import { docContent, readState } from "../rag/indexer.ts";
import type { DocJson, DocRef, FigureEntry } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { readJson, writeJson } from "./project.ts";

export type TocEntry = { anchor: string; title: string; level: number };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function docDir(project: string, id: string): string {
  if (!ID_RE.test(id)) throw new UserError(`Invalid document id "${id}".`, "Use letters, digits, '_', '-' and '.'.");
  return join(project, "docs", id);
}

export function readDoc(project: string, id: string): DocJson {
  const file = join(docDir(project, id), "doc.json");
  if (!existsSync(file)) throw new UserError(`No document ${id}.`, "testimus docs list shows the project's documents.");
  const doc = { ...(JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as DocJson), id };
  // ponytail: a doc.json written before the source had a name kept its path (`source.path`): the name is its file
  const legacy = doc.source as DocJson["source"] & { path?: string };
  if (legacy && !legacy.name) doc.source = { ...legacy, name: basename(legacy.path ?? legacy.file ?? "") };
  return doc;
}

export function writeDoc(project: string, doc: DocJson): void {
  const { id, ...file } = doc;
  writeJson(join(docDir(project, id), "doc.json"), file);
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

// ponytail: whether search finds a document's current text (its passages, words and links) — the vectors aside;
// docs.list and rag.status add the vector space to it (lib/docs-index.ts)
export function listDocs(project: string): DocRef[] {
  const state = readState(project)?.docs ?? {};
  return docIds(project).map((id) => {
    const doc = readDoc(project, id);
    const at = state[id];
    const content = docContent(docDir(project, id), doc);
    return { ...doc, indexed: at === undefined ? "missing" : at === content ? "fresh" : "stale" };
  });
}

export const isConverted = (doc: Pick<DocJson, "converted">) => !!doc.converted?.at;

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

// ponytail: the version of context.md a page read (its mtime in ms), so a save can tell it moved on disk since; null
// while the file does not exist
export function contextMtime(project: string, id: string): number | null {
  const file = join(docDir(project, id), "context.md");
  return existsSync(file) ? statSync(file).mtimeMs : null;
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

export function sectionOf(md: string, anchor: string): string | null {
  const { kind, id } = parseAnchor(anchor);
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
  const { kind, id } = parseAnchor(anchor);
  if (kind === "§") return `§${id}`;
  const lines = md.split("\n");
  const marker = `<!-- ${kind} ${id} -->`;
  for (let i = lines.findIndex((l) => l.includes(marker)); i >= 0; i--) {
    const m = lines[i].match(/^#{1,6} .*<!-- § ([^ ]+) -->$/);
    if (m) return `§${m[1]}`;
  }
  return null;
}

// ponytail: the folder goes, and every other document that named it in amends forgets it
export function removeDoc(project: string, id: string): string[] {
  readDoc(project, id);
  rmSync(docDir(project, id), { recursive: true, force: true });
  const touched: string[] = [];
  for (const other of docIds(project)) {
    const doc = readDoc(project, other);
    if (!doc.amends?.includes(id)) continue;
    const amends = doc.amends.filter((a) => a !== id);
    if (amends.length) doc.amends = amends;
    else delete doc.amends;
    writeDoc(project, doc);
    touched.push(doc.id);
  }
  return touched;
}

export function amendedBy(project: string, id: string): string[] {
  return docIds(project).filter((other) => readDoc(project, other).amends?.includes(id));
}
