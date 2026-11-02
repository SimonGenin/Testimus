import { join } from "node:path";
import { readJson } from "../lib/project.ts";
import type { ProjectJson, ReqStatement, RequirementMatrixSpec } from "../types.ts";
import { lines, parseSections, type Section, sectionAt, stripComments } from "./chunk.ts";
import { REQ_PATTERN } from "./convert.ts";

export type EvidenceOpts = { patterns?: string[]; matrix?: RequirementMatrixSpec };
export type MdTable = { start: number; end: number; header: string[]; rows: { line: number; cells: string[] }[] };
export type MatrixColumns = { id: number; section: number; text: number };
export type Matrix = { table: MdTable; cols: MatrixColumns };
export type MatrixRow = {
  id: string;
  anchor: string;
  line: number;
  matrix: Matrix;
  text: string;
  statement: string;
  traced: string[];
};
export type Statement = ReqStatement & { anchor: string; start: number; end: number };

const ID_HEADERS = new Set([
  "code exigence",
  "code exigences",
  "exigence",
  "exigences",
  "id exigence",
  "requirement",
  "requirements",
  "requirement id",
  "id",
]);
const SECTION_HEADERS = new Set(["section", "sections", "chapitre", "chapitres", "§", "paragraphe", "paragraphes"]);
const TEXT_HEADERS = /^(objet|libelle|texte|texte exigence|text|description|intitule|enonce|exigence|requirement)s?$/;
const MARKER_ONLY = /^\s*<!--\s*req\s+(\S+?)\s*-->\s*$/;
const HEADING = /^#{1,6}\s/;
const FIG_MARK = /<!--\s*fig\s/;
const FIGURE_START = /^\s*(!\[|(?:\*\*)?(?:Figure|Fig\.)\s*\d)/i;
const NUMBER = /\d+(?:\.\d+)*/g;

export function evidenceOptions(project: string): EvidenceOpts {
  const p = readJson<Partial<ProjectJson>>(join(project, "project.json"), {});
  return { patterns: p.requirementPatterns ?? [], matrix: p.requirementMatrix };
}

export function idRegex(opts: EvidenceOpts = {}): RegExp {
  const ok = [REQ_PATTERN, ...(opts.patterns ?? [])].filter((p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  });
  return new RegExp(ok.map((p) => `(?:${p})`).join("|"), "g");
}

export function idsIn(text: string, opts: EvidenceOpts = {}): string[] {
  return [...new Set([...text.matchAll(idRegex(opts))].map((m) => m[0]))];
}

export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function cellText(cell: string): string {
  return cell
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\\\|/g, "|")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normHeader(cell: string): string {
  return cellText(cell)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^#+\s*/, "")
    .replace(/[:.]+$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const isSeparator = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");

export function tablesOf(md: string): MdTable[] {
  const ls = lines(md);
  const out: MdTable[] = [];
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].startsWith("|")) continue;
    let end = i;
    while (end < ls.length && ls[end].startsWith("|")) end++;
    if (end - i >= 2 && isSeparator(ls[i + 1]))
      out.push({
        start: i,
        end,
        header: splitRow(ls[i]),
        rows: ls.slice(i + 2, end).map((l, k) => ({ line: i + 2 + k, cells: splitRow(l) })),
      });
    i = end;
  }
  return out;
}

function onlyIds(cell: string, re: RegExp): string[] {
  const t = cellText(cell);
  const ids = [...t.matchAll(re)].map((m) => m[0]);
  if (!ids.length) return [];
  const rest = t.replace(re, " ").replace(/\bet\b|\band\b|[\s,;/&+-]/gi, "");
  return rest ? [] : [...new Set(ids)];
}

export function tracedOf(cell: string): string[] {
  return [...new Set([...cellText(cell).matchAll(NUMBER)].map((m) => m[0]))];
}

const isSectionCell = (cell: string) => {
  const t = cellText(cell);
  return /\d/.test(t) && !t.replace(NUMBER, "").replace(/\b(et|and|p)\b|[§\s,;/.()-]/gi, "");
};

const most = (count: number, total: number) => total > 0 && count > 0 && count * 2 >= total;

// ponytail: a requirement matrix is told by its content (ids on most rows) and by a section column, named or
// numbered — the RATP header words are the defaults, project.json.requirementMatrix names others
export function matrixColumns(t: MdTable, opts: EvidenceOpts = {}): MatrixColumns | null {
  const re = idRegex(opts);
  const width = Math.max(t.header.length, ...t.rows.map((r) => r.cells.length));
  const head = t.header.map(normHeader);
  const named = (name: string | undefined) => (name ? head.indexOf(normHeader(name)) : -1);
  const rows = t.rows.filter((r) => r.cells.some((c) => cellText(c)));
  const idCount = (c: number) => rows.filter((r) => onlyIds(r.cells[c] ?? "", re).length).length;
  let id = named(opts.matrix?.idColumn);
  if (opts.matrix?.idColumn && id < 0) return null;
  if (id < 0) {
    let best = 0;
    for (let c = 0; c < width; c++) {
      const n = idCount(c);
      if (n > best || (n === best && n > 0 && ID_HEADERS.has(head[c]) && !ID_HEADERS.has(head[id] ?? ""))) {
        best = n;
        id = c;
      }
    }
  }
  if (id < 0 || !most(idCount(id), rows.length)) return null;
  let section = named(opts.matrix?.sectionColumn);
  if (opts.matrix?.sectionColumn && section < 0) return null;
  if (section < 0) section = head.findIndex((h, c) => c !== id && SECTION_HEADERS.has(h));
  if (section < 0)
    for (let c = 0; c < width && section < 0; c++)
      if (c !== id && most(rows.filter((r) => isSectionCell(r.cells[c] ?? "")).length, rows.length)) section = c;
  if (section < 0 || section === id) return null;
  let text = named(opts.matrix?.textColumn);
  if (text < 0) text = head.findIndex((h, c) => c !== id && c !== section && TEXT_HEADERS.test(h));
  if (text < 0) {
    let longest = 0;
    for (let c = 0; c < width; c++) {
      if (c === id || c === section) continue;
      const len = rows.reduce((n, r) => n + cellText(r.cells[c] ?? "").length, 0);
      if (len > longest) {
        longest = len;
        text = c;
      }
    }
  }
  return { id, section, text };
}

export function matricesOf(md: string, opts: EvidenceOpts = {}): Matrix[] {
  return tablesOf(md).flatMap((table) => {
    const cols = matrixColumns(table, opts);
    return cols ? [{ table, cols }] : [];
  });
}

export function renderStatement(id: string, objet: string, traced: string[]): string {
  const where = traced.length ? ` (section${traced.length > 1 ? "s" : ""} ${traced.join(", ")})` : "";
  return `${id} — ${objet}${where}`.trim();
}

export function matrixRows(md: string, opts: EvidenceOpts = {}): MatrixRow[] {
  const re = idRegex(opts);
  const seen = new Map<string, number>();
  const out: MatrixRow[] = [];
  for (const matrix of matricesOf(md, opts)) {
    const { table, cols } = matrix;
    const headerIsRow = onlyIds(table.header[cols.id] ?? "", re).length > 0;
    const rows = headerIsRow ? [{ line: table.start, cells: table.header }, ...table.rows] : table.rows;
    for (const r of rows) {
      const traced = tracedOf(r.cells[cols.section] ?? "");
      const objet = cols.text >= 0 ? cellText(r.cells[cols.text] ?? "") : "";
      const text = r.cells.map(cellText).filter(Boolean).join(" | ");
      for (const id of onlyIds(r.cells[cols.id] ?? "", re)) {
        const n = (seen.get(id) ?? 0) + 1;
        seen.set(id, n);
        out.push({
          id,
          anchor: `req:${id}@matrix${n > 1 ? `~${n}` : ""}`,
          line: r.line,
          matrix,
          text,
          statement: renderStatement(id, objet, traced),
          traced,
        });
      }
    }
  }
  return out;
}

function blockEnd(ls: string[], from: number): number {
  let k = from;
  while (k < ls.length && ls[k].trim() && !MARKER_ONLY.test(ls[k]) && !(k > from && HEADING.test(ls[k]))) k++;
  return k;
}

const idOnly = (block: string, id: string) =>
  stripComments(block)
    .replace(/[*`]/g, "")
    .replace(/[\s:.–—-]+$/, "")
    .trim() === id;

// ponytail: RATP writes the id alone in bold and the rule in the next paragraphs — the statement runs from
// the id to the next requirement marker, heading or figure
function bodyStatement(ls: string[], start: number, id: string): number {
  let end = blockEnd(ls, start);
  if (!idOnly(ls.slice(start, end).join("\n"), id)) return end;
  for (;;) {
    let k = end;
    while (k < ls.length && !ls[k].trim()) k++;
    if (k >= ls.length || MARKER_ONLY.test(ls[k]) || HEADING.test(ls[k]) || FIGURE_START.test(ls[k])) return end;
    const next = blockEnd(ls, k);
    end = next;
    if (ls.slice(k, next).some((l) => FIG_MARK.test(l))) return end;
  }
}

export function statementsOf(docId: string, md: string, opts: EvidenceOpts = {}): Map<string, Statement> {
  const ls = lines(md);
  const sections = parseSections(md);
  const rows = matrixRows(md, opts);
  const firstRow = new Map<string, MatrixRow>();
  for (const r of rows) if (!firstRow.has(r.id)) firstRow.set(r.id, r);
  const tables = tablesOf(md);
  const sectionOf = (line: number) => sectionAt(sections, line)?.anchor ?? "";
  const traced = (id: string) => (firstRow.get(id)?.traced ?? []).map((t) => `§${t}`);
  const fromRow = (r: MatrixRow): Statement => ({
    id: r.id,
    docId,
    source: "matrix",
    section: sectionOf(r.line),
    text: r.statement,
    traced: traced(r.id),
    anchor: r.anchor,
    start: r.line,
    end: r.line + 1,
  });
  const out = new Map<string, Statement>();
  ls.forEach((line, i) => {
    const m = line.match(MARKER_ONLY);
    if (!m || out.has(m[1])) return;
    const id = m[1];
    let j = i + 1;
    while (j < ls.length && (MARKER_ONLY.test(ls[j]) || !ls[j].trim())) j++;
    const row = firstRow.get(id);
    if (row && row.matrix.table.start === j) {
      out.set(id, fromRow(row));
      return;
    }
    const base = { id, docId, source: "body" as const, traced: traced(id), anchor: `req:${id}` };
    if (j >= ls.length || HEADING.test(ls[j])) {
      out.set(id, { ...base, section: sectionOf(i), text: id, start: i, end: i + 1 });
      return;
    }
    const table = tables.find((t) => t.start === j);
    if (table) {
      const hit = [table.header, ...table.rows.map((r) => r.cells)].findIndex((cells) => cells.join(" ").includes(id));
      const at = hit <= 0 ? table.start : table.rows[hit - 1].line;
      const cells = hit <= 0 ? table.header : table.rows[hit - 1].cells;
      out.set(id, {
        ...base,
        section: sectionOf(at),
        text: cells.map(cellText).filter(Boolean).join(" | "),
        start: at,
        end: at + 1,
      });
      return;
    }
    const end = bodyStatement(ls, j, id);
    const text = stripComments(ls.slice(j, end).join("\n"));
    if (row && idOnly(text, id))
      out.set(id, { ...base, source: "matrix", section: sectionOf(j), text: row.statement, start: j, end });
    else out.set(id, { ...base, section: sectionOf(j), text, start: j, end });
  });
  for (const r of firstRow.values()) if (!out.has(r.id)) out.set(r.id, fromRow(r));
  return out;
}

export function sectionByNumber(sections: Section[], n: string): Section | undefined {
  return sections.find((s) => s.number === n);
}
