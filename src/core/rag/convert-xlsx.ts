import { readZip } from "../lib/zip.ts";
import type { DocSheet } from "../types.ts";
import { type Converted, guessDate, slug, uniqueKey } from "./convert.ts";
import { decodeEntities } from "./convert-html.ts";
import {
  drawTable,
  guessTable,
  notRead,
  oneLine,
  profileTable,
  TABLE_CONVERTER,
  type Table,
  type TableProfile,
  tableDoc,
  tableOf,
} from "./convert-table.ts";

export const WORKBOOK_FILE = /\.(xlsx|xlsm)$/i;

export type Sheet = { name: string; hidden: boolean; records: string[][] };
export type SheetProfile = TableProfile & { name: string };
export type WorkbookProfile = { sheets: SheetProfile[]; leftAside: { name: string; why: string }[] };

const DAY_MS = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
// ponytail: Excel's own number formats that show a date or a time (14–22, 27–36 and 50–58 for East Asian locales, 45–47)
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50]);
for (let i = 51; i <= 58; i++) DATE_IDS.add(i);

const text = (bytes?: Uint8Array) => (bytes ? new TextDecoder().decode(bytes) : "");
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1] ?? undefined;

// ponytail: Excel writes a control character it keeps in a cell as _xHHHH_ (a line break in a cell is often _x000D_
// before \n), _x005F_ escaping a literal underscore
const cellText = (s: string) =>
  decodeEntities(s)
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\r\n?/g, "\n");

// ponytail: a cell's text is every <t> of it, the phonetic runs (rPh) left out
function runsText(xml: string): string {
  return cellText(
    [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""),
  );
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => runsText(m[1] ?? ""));
}

// ponytail: the number format of each cell style — a date or a time is told by its format, never by its value
function formats(xml: string): { id: number; code: string }[] {
  const codes = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g))
    codes.set(Number(attr(m[1], "numFmtId")), decodeEntities(attr(m[1], "formatCode") ?? ""));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map((m) => {
    const id = Number(attr(m[1], "numFmtId") ?? 0);
    return { id, code: codes.get(id) ?? "" };
  });
}

const TIME_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);

// ponytail: whether a format shows a date (with or without its time), a time alone, or a number
function timeKind(f?: { id: number; code: string }): "date" | "time" | null {
  if (!f) return null;
  if (TIME_IDS.has(f.id)) return "time";
  if (DATE_IDS.has(f.id)) return "date";
  const bare = f.code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  if (!f.code || /^(general|@)$/i.test(bare) || !/[dmyhs]/i.test(bare)) return null;
  return /[dy]/i.test(bare) ? "date" : "time";
}

const pad = (n: number) => String(n).padStart(2, "0");

// ponytail: a date as ISO (2025-03-12), with its time when it has one (2025-03-12 14:30); a time alone as 14:30
function dateOf(serial: number, date1904: boolean, kind: "date" | "time"): string {
  const ms = Math.round(((date1904 ? EPOCH_1904 : EPOCH_1900) + serial * DAY_MS) / 1000) * 1000;
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const s = d.getUTCSeconds();
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${s ? `:${pad(s)}` : ""}`;
  if (kind === "time") return time;
  return ms % DAY_MS ? `${day} ${time}` : day;
}

// ponytail: a number as Excel holds it, rid of binary noise (0.1 + 0.2 is 0.3); a percentage as it shows (12.5%)
function numberOf(v: string, f?: { id: number; code: string }): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const clean = (x: number) => String(Number(x.toPrecision(15)));
  return f && (f.id === 9 || f.id === 10 || f.code.includes("%")) ? `${clean(n * 100)}%` : clean(n);
}

const column = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};
const rowOf = (ref: string) => Number(/\d+$/.exec(ref)?.[0] ?? 0) - 1;

function readSheet(xml: string, shared: string[], styles: { id: number; code: string }[], date1904: boolean) {
  const grid: string[][] = [];
  let r = -1;
  const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
  for (const row of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const at = attr(row[1], "r");
    r = at ? Number(at) - 1 : r + 1;
    let c = -1;
    for (const cell of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], "r");
      c = ref ? column(ref) : c + 1;
      const body = cell[2] ?? "";
      const t = attr(cell[1], "t");
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const f = styles[Number(attr(cell[1], "s") ?? 0)];
      let value = "";
      if (t === "inlineStr") value = runsText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (v === undefined) value = "";
      else if (t === "s") value = shared[Number(v)] ?? "";
      else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (t === "str" || t === "e") value = cellText(v);
      else if (t === "d") value = v.replace(/T00:00:00(?:\.0+)?Z?$/, "").replace("T", " ");
      else {
        const kind = timeKind(f);
        value = kind ? dateOf(Number(v), date1904, kind) : numberOf(v, f);
      }
      if (!value) continue;
      grid[r] ??= [];
      grid[r][c] = value;
    }
  }
  // ponytail: a merged range reads as its first cell in each of its cells — a sub-system written once over ten rows
  // names each of them
  for (const m of xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const [c1, r1, c2, r2] = [column(m[1]), rowOf(m[1]), column(m[2]), rowOf(m[2])];
    const value = grid[r1]?.[c1];
    if (!value) continue;
    for (let y = r1; y <= r2; y++)
      for (let x = c1; x <= c2; x++) {
        grid[y] ??= [];
        grid[y][x] ??= value;
      }
  }
  return Array.from({ length: grid.length }, (_, y) => Array.from(grid[y] ?? [], (v) => v ?? ""));
}

const target = (t: string) => (t.startsWith("/") ? t.slice(1) : `xl/${t}`).replace(/\/[^/]+\/\.\.\//g, "/");

// ponytail: an .xlsx is a zip of XML parts: the workbook names its sheets in order and points at each one's part; the
// cells hold shared strings, inline strings, numbers (a date is a number with a date format), booleans, errors and the
// last value of their formula
export function readWorkbook(bytes: Uint8Array): Sheet[] {
  let zip: Map<string, Uint8Array>;
  try {
    zip = readZip(bytes);
  } catch {
    throw new Error("Not an Excel workbook (.xlsx): save it again from Excel as an Excel workbook.");
  }
  const book = text(zip.get("xl/workbook.xml"));
  if (!book) throw new Error("Not an Excel workbook (.xlsx): it has no xl/workbook.xml.");
  const rels = new Map(
    [...text(zip.get("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [
      attr(m[1], "Id") ?? "",
      attr(m[1], "Target") ?? "",
    ]),
  );
  const shared = sharedStrings(text(zip.get("xl/sharedStrings.xml")));
  const styles = formats(text(zip.get("xl/styles.xml")));
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(book);
  return [...book.matchAll(/<sheet\b([^>]*?)\/?>/g)].flatMap((m) => {
    const part = rels.get(attr(m[1], "r:id") ?? "") ?? "";
    const xml = part && text(zip.get(target(part)));
    if (!xml || !/<worksheet\b/.test(xml)) return [];
    const state = attr(m[1], "state");
    return [
      {
        name: cellText(attr(m[1], "name") ?? ""),
        hidden: state === "hidden" || state === "veryHidden",
        records: readSheet(xml, shared, styles, date1904),
      },
    ];
  });
}

const filled = (s: Sheet) => s.records.some((r) => r.some((c) => c.trim()));

// ponytail: the sheets read as tables — a hidden sheet, an empty one and one Claude left aside are not
export function workbookTables(
  bytes: Uint8Array,
  sheets?: DocSheet[],
): { tables: { name: string; table: Table }[]; leftAside: { name: string; why: string }[] } {
  const told = new Map((sheets ?? []).map((s) => [s.name, s]));
  const tables: { name: string; table: Table }[] = [];
  const leftAside: { name: string; why: string }[] = [];
  for (const s of readWorkbook(bytes)) {
    if (s.hidden) leftAside.push({ name: s.name, why: "hidden" });
    else if (!filled(s)) leftAside.push({ name: s.name, why: "empty" });
    else if (told.get(s.name)?.skip) leftAside.push({ name: s.name, why: "left aside by Claude" });
    else tables.push({ name: s.name, table: tableOf(s.records, told.get(s.name)?.headerRow) });
  }
  return { tables, leftAside };
}

export function profileWorkbook(bytes: Uint8Array): WorkbookProfile {
  const { tables, leftAside } = workbookTables(bytes);
  return { sheets: tables.map((t) => ({ name: t.name, ...profileTable(t.table) })), leftAside };
}

// ponytail: a workbook of one sheet is a table alone; of several, a section a sheet (§<sheet>), its Columns
// (§<sheet>-columns) and its rows under it — a row's anchor its key, unique in the whole document
export function convertWorkbook(bytes: Uint8Array, o: { title: string; sheets?: DocSheet[] }): Converted {
  const { tables, leftAside } = workbookTables(bytes, o.sheets);
  const title = o.title.trim() || "Workbook";
  const used = new Set<string>();
  const anchor = uniqueKey(used, slug(title));
  const warnings: string[] = [];
  const names = new Set([...tables.map((t) => t.name), ...leftAside.map((s) => s.name)]);
  for (const s of o.sheets ?? [])
    if (!names.has(s.name)) warnings.push(`The sheet « ${s.name} » is not in the workbook`);
  for (const s of leftAside)
    if (s.why === "hidden") warnings.push(`The sheet « ${s.name} » is hidden in Excel: left aside`);
  if (!tables.length) warnings.push("The workbook has no sheet with data");
  const alone = tables.length === 1;
  const lines: string[] = [];
  for (const { name, table } of tables) {
    const read = o.sheets?.find((s) => s.name === name);
    const conf = read ?? guessTable(table);
    const where = alone ? "" : `Sheet « ${name} »: `;
    if (!read) warnings.push(notRead(conf, where));
    let columns = "columns";
    if (!alone) {
      const key = uniqueKey(used, slug(name));
      lines.push(`## ${oneLine(name)} <!-- § ${key} -->`, "");
      columns = `${key}-columns`;
    }
    const d = drawTable(table, conf, { used, level: alone ? 2 : 3, columns, where });
    lines.push(...d.lines);
    warnings.push(...d.warnings);
  }
  return {
    md: tableDoc(title, anchor, lines),
    figures: [],
    warnings,
    meta: { title, date: guessDate(tables.flatMap((t) => t.table.preamble.flat()).join(" ")) },
    convertedWith: TABLE_CONVERTER,
  };
}
