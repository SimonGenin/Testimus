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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordOf = (id: string) => new RegExp(`(?<![A-Za-z0-9_])${escapeRe(id)}(?![A-Za-z0-9_])`);

// ponytail: a block that names requirements and says nothing else (RATP `**EXI_A**`, `**EXI_A** et **EXI_B**`,
// `**EXI_A,**`) — it is a label, never a statement
export function onlyIdsBlock(block: string, re: RegExp): boolean {
  const t = stripComments(block).replace(/[*`]/g, "");
  if (t.search(re) < 0) return false;
  return !t.replace(re, " ").replace(/\b(?:et|and)\b|[\s,;/&+:.–—-]/gi, "");
}

const nextFilled = (ls: string[], from: number) => {
  let k = from;
  while (k < ls.length && !ls[k].trim()) k++;
  return k;
};

// ponytail: a bold line without final punctuation is a RATP sub-title (`**Structure d'un onglet**`), not a rule
const subTitle = (line: string) =>
  /^\s*\*\*[^*]+\*\*\s*$/.test(line) && !/[.:;!?]\s*\*\*\s*$/.test(line) && line.trim().length <= 150;

function following(ls: string[], from: number, re: RegExp): number {
  let end = from;
  for (;;) {
    const k = nextFilled(ls, end);
    if (k >= ls.length || MARKER_ONLY.test(ls[k]) || HEADING.test(ls[k]) || FIGURE_START.test(ls[k])) return end;
    const next = blockEnd(ls, k);
    if (onlyIdsBlock(ls.slice(k, next).join("\n"), re)) return end;
    end = next;
    if (ls.slice(k, next).some((l) => FIG_MARK.test(l))) return end;
  }
}

// ponytail: RATP writes the id alone in bold and the rule in the next paragraphs — the statement runs from
// the id to the next requirement marker, id label, heading or figure (a sub-title right after the id is not its rule)
function bodyStatement(ls: string[], start: number, re: RegExp): number {
  const end = blockEnd(ls, start);
  if (!onlyIdsBlock(ls.slice(start, end).join("\n"), re)) return end;
  const k = nextFilled(ls, end);
  return k < ls.length && subTitle(ls[k]) ? end : following(ls, end, re);
}

function headingStatement(ls: string[], k: number, re: RegExp): { text: string; end: number } {
  const title = stripComments(ls[k])
    .replace(/^#+\s*/, "")
    .trim();
  const end = following(ls, k + 1, re);
  return { text: [title, stripComments(ls.slice(k + 1, end).join("\n"))].filter(Boolean).join("\n\n"), end };
}

// ponytail: an id with no text of its own at its marker is read where the document first says something about
// it — a table row, an id list followed by text (RATP repeats `**EXI_A, EXI_B**` above the rule), a heading,
// or the paragraph that names it
function mentionedElsewhere(ls: string[], tables: MdTable[], id: string, re: RegExp, skip: [number, number]) {
  const word = wordOf(id);
  for (let k = 0; k < ls.length; k++) {
    if ((k >= skip[0] && k < skip[1]) || MARKER_ONLY.test(ls[k]) || !word.test(stripComments(ls[k]))) continue;
    const table = tables.find((t) => k >= t.start && k < t.end);
    let text: string;
    if (table) {
      const cells = k === table.start ? table.header : (table.rows.find((r) => r.line === k)?.cells ?? []);
      text = cells.map(cellText).filter(Boolean).join(" | ");
    } else if (HEADING.test(ls[k])) text = headingStatement(ls, k, re).text;
    else {
      let b = k;
      while (b > 0 && ls[b - 1].trim() && !MARKER_ONLY.test(ls[b - 1]) && !HEADING.test(ls[b - 1])) b--;
      text = stripComments(ls.slice(b, bodyStatement(ls, b, re)).join("\n"));
    }
    if (text && !onlyIdsBlock(text, re)) return text;
  }
  return null;
}

// ponytail: a list of ids, one per paragraph (`**EXI_A,**` `**EXI_B,**` `**EXI_C**`), shares the text after it —
// only when the id's own label says the list goes on (a trailing comma, « et »)
function afterIdList(ls: string[], label: string, from: number, re: RegExp): string | null {
  const t = stripComments(label).replace(/[*`]/g, "").trim();
  if (!/(?:[,;&+]|\bet|\band)$/i.test(t)) return null;
  let k = from;
  for (;;) {
    while (k < ls.length && (!ls[k].trim() || MARKER_ONLY.test(ls[k]))) k++;
    if (k >= ls.length || HEADING.test(ls[k]) || FIGURE_START.test(ls[k])) return null;
    const e = blockEnd(ls, k);
    if (onlyIdsBlock(ls.slice(k, e).join("\n"), re)) {
      k = e;
      continue;
    }
    return subTitle(ls[k]) ? null : stripComments(ls.slice(k, following(ls, k, re)).join("\n"));
  }
}

export function statementsOf(docId: string, md: string, opts: EvidenceOpts = {}): Map<string, Statement> {
  const ls = lines(md);
  const re = idRegex(opts);
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
    // ponytail: never the id alone — its matrix row, else what the document says of it elsewhere, else the text
    // an id list shares; the id itself only when the document says nothing more
    const lacking = (from: number, to: number) => {
      if (row) {
        out.set(id, { ...base, source: "matrix", section: sectionOf(from), text: row.statement, start: from, end: to });
        return;
      }
      const label = ls.slice(from, to).join("\n");
      const text = mentionedElsewhere(ls, tables, id, re, [i, to]) ?? afterIdList(ls, label, to, re) ?? id;
      out.set(id, { ...base, section: sectionOf(from), text, start: from, end: to });
    };
    if (j >= ls.length || (HEADING.test(ls[j]) && !wordOf(id).test(stripComments(ls[j])))) {
      lacking(i, i + 1);
      return;
    }
    if (HEADING.test(ls[j])) {
      const h = headingStatement(ls, j, re);
      out.set(id, { ...base, section: sectionOf(j), text: h.text, start: j, end: h.end });
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
    const end = bodyStatement(ls, j, re);
    const text = stripComments(ls.slice(j, end).join("\n"));
    if (onlyIdsBlock(text, re)) lacking(j, end);
    else out.set(id, { ...base, section: sectionOf(j), text, start: j, end });
  });
  for (const r of firstRow.values()) if (!out.has(r.id)) out.set(r.id, fromRow(r));
  return out;
}

export function sectionByNumber(sections: Section[], n: string): Section | undefined {
  return sections.find((s) => s.number === n);
}
