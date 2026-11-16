import { createHash } from "node:crypto";
import type { DocTable } from "../types.ts";
import { type Converted, guessDate, slug, uniqueKey } from "./convert.ts";
import { decodeText } from "./convert-text.ts";

export const TABLE_CONVERTER = "table 1";
// ponytail: a table is a .csv or .tsv, or an Excel workbook whose sheets are tables (rag/convert-xlsx.ts)
export const TABLE_FILE = /\.(csv|tsv|xlsx|xlsm)$/i;

type Delimiter = NonNullable<DocTable["delimiter"]>;
const DELIMITERS: Delimiter[] = [",", ";", "\t", "|"];
const SAMPLE = 64 * 1024;
const SAMPLES = 6;
const SAMPLE_CHARS = 80;
const KEY_CHARS = 60;

export type Table = {
  delimiter?: Delimiter;
  headerRow: number;
  preamble: string[][];
  header: string[];
  rows: string[][];
};

export type ColumnProfile = {
  name: string;
  filled: number;
  distinct: number;
  unique: boolean;
  longest: number;
  samples: string[];
};

export type TableProfile = {
  delimiter?: Delimiter;
  headerRow: number;
  rows: number;
  preamble: string[];
  columns: ColumnProfile[];
  guess: DocTable;
};

// ponytail: RFC 4180 — a cell between double quotes holds the delimiter, line breaks and "" for a quote; a quote
// inside an unquoted cell is text
function records(text: string, d: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let fresh = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (c === '"' && fresh) {
      quoted = true;
      fresh = false;
    } else if (c === d) {
      row.push(cell);
      cell = "";
      fresh = true;
    } else if (c === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      fresh = true;
    } else {
      cell += c;
      if (c !== " ") fresh = false;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

const filledOf = (r: string[]) => r.filter((c) => c.trim()).length;

// ponytail: the delimiter is the one that cuts the first lines into the same number of cells most often (Excel's
// « sep=; » first line says it outright)
function delimiterOf(text: string): Delimiter {
  let best: { d: Delimiter; score: number } = { d: ",", score: -1 };
  for (const d of DELIMITERS) {
    const widths = records(text.slice(0, SAMPLE), d)
      .slice(0, 50)
      .filter((r) => filledOf(r))
      .map((r) => r.length);
    const counts = new Map<number, number>();
    for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
    const [width, n] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [1, 0];
    const score = width > 1 ? n * 1000 + width : 0;
    if (score > best.score) best = { d, score };
  }
  return best.d;
}

// ponytail: the header is the first line that fills most of the table's width — an export's title or date lines
// above it are its preamble
function headerOf(rs: string[][]): number {
  const width = Math.max(1, ...rs.slice(0, 50).map(filledOf));
  const at = rs.findIndex((r) => filledOf(r) >= Math.max(2, Math.ceil(width * 0.6)));
  return Math.max(at, 0);
}

function names(cells: string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, i) => {
    const base = (cells[i] ?? "").replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
}

// ponytail: the lines of a table (a CSV's records, a sheet's rows) cut into its preamble, its header and its rows, each
// row as wide as the widest
export function tableOf(rs: string[][], headerRow?: number): Table {
  const at = headerRow && headerRow <= rs.length ? headerRow - 1 : headerOf(rs);
  const body = rs.slice(at + 1).filter(filledOf);
  const width = Math.max(rs[at]?.length ?? 0, ...body.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  return {
    headerRow: at + 1,
    preamble: rs.slice(0, at).filter(filledOf),
    header: names(rs[at] ?? [], width),
    rows: body.map(pad),
  };
}

export function readTable(
  bytes: Uint8Array,
  o: { delimiter?: Delimiter; headerRow?: number; tsv?: boolean } = {},
): Table & { delimiter: Delimiter } {
  let text = decodeText(bytes).replace(/\r\n?/g, "\n");
  const sep = /^"?sep=(.)"?\n/i.exec(text);
  if (sep) text = text.slice(sep[0].length);
  const delimiter = o.delimiter ?? (sep && DELIMITERS.find((d) => d === sep[1])) ?? (o.tsv ? "\t" : delimiterOf(text));
  return { ...tableOf(records(text, delimiter), o.headerRow), delimiter };
}

const short = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SAMPLE_CHARS ? `${t.slice(0, SAMPLE_CHARS)}…` : t;
};

const KEYISH = /(^|\b)(id|code|ref|r[ée]f[ée]rence|key|cl[ée]|n°|no|num[ée]ro|number|identifi)/i;

// ponytail: what Testimus does alone: the rows are named by a column filled on every row, each value its own and short —
// one whose name says it is an identifier first; a column empty on every row is left out
export function guessTable(t: Table, columns: ColumnProfile[] = profileColumns(t)): DocTable {
  const keys = columns.filter((c) => t.rows.length && c.filled === t.rows.length && c.unique && c.longest <= KEY_CHARS);
  const key = keys.find((c) => KEYISH.test(c.name)) ?? keys[0];
  const empty = columns.filter((c) => !c.filled);
  return {
    ...(key ? { key: key.name } : {}),
    ...(empty.length ? { columns: empty.map((c) => ({ name: c.name, skip: true })) } : {}),
  };
}

function profileColumns(t: Table): ColumnProfile[] {
  return t.header.map((name, i) => {
    const values = t.rows.map((r) => r[i].trim()).filter(Boolean);
    const distinct = new Set(values);
    return {
      name,
      filled: values.length,
      distinct: distinct.size,
      unique: distinct.size === values.length,
      longest: Math.max(0, ...values.map((v) => v.length)),
      samples: [...distinct].slice(0, SAMPLES).map(short),
    };
  });
}

// ponytail: what Claude is given to read a table — its shape, each column's fill and a few of its values, and what
// Testimus would do alone
export function profileTable(t: Table): TableProfile {
  const columns = profileColumns(t);
  return {
    ...(t.delimiter ? { delimiter: t.delimiter } : {}),
    headerRow: t.headerRow,
    rows: t.rows.length,
    preamble: t.preamble.map((r) => r.filter((c) => c.trim()).join(" · ")),
    columns,
    guess: guessTable(t, columns),
  };
}

const defuse = (s: string) => s.replace(/<!--/g, "<! --").replace(/-->/g, "-- >");
export const oneLine = (s: string) => defuse(s.replace(/\s+/g, " ").trim());
const anchorOf = (value: string) =>
  value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);

// ponytail: a cell's lines under its column, the lines after the first indented so none reads as a heading
function field(name: string, value: string): string {
  const [first, ...more] = defuse(value.trim()).split("\n");
  return [`- **${name}** : ${first.trim()}`, ...more.map((l) => `  ${l.trim()}`)].join("\n");
}

export const notRead = (conf: DocTable, where = "") =>
  `${where}The columns were not read by Claude: ${conf.key ? `rows are named by « ${conf.key} »` : "no column names the rows, they are anchored by what they hold"}`;

// ponytail: a table is one section a row — its anchor the row's key (§ALM-012), stable while the key is; a table
// without a key names its rows by their title, else by what they hold (row-<hash>). What the table is and its columns
// come first, what Claude read beside each name in a comment: shown and searched, never quotable. `level` is the depth
// of its Columns and its rows (## for a table alone, ### for a sheet of a workbook); anchors are unique in the document
export function drawTable(
  t: Table,
  conf: DocTable,
  o: { used: Set<string>; level: number; columns: string; where?: string },
): { lines: string[]; warnings: string[] } {
  const where = o.where ?? "";
  const warnings: string[] = [];
  const has = (name?: string, what?: string) => {
    if (!name) return -1;
    const i = t.header.indexOf(name);
    if (i < 0) warnings.push(`${where}The ${what} column « ${name} » is not in the table: left aside`);
    return i;
  };
  const key = has(conf.key, "key");
  const titleAt = has(conf.title, "title");
  const group = has(conf.group, "group");
  const told = new Map((conf.columns ?? []).map((c) => [c.name, c]));
  for (const name of told.keys())
    if (!t.header.includes(name)) warnings.push(`${where}The column « ${name} » is not in the table`);
  const skipped = new Set(t.header.flatMap((n, i) => (told.get(n)?.skip ? [i] : [])));
  const shown = t.header.map((_, i) => i).filter((i) => !skipped.has(i) && i !== key && i !== titleAt && i !== group);
  const h = (depth: number) => "#".repeat(depth);

  const out: string[] = [];
  if (conf.about?.trim()) out.push(`<!-- = ${oneLine(conf.about)} -->`, "");
  for (const r of t.preamble) out.push(oneLine(r.filter((c) => c.trim()).join(" · ")), "");
  out.push(`${h(o.level)} Columns <!-- § ${uniqueKey(o.used, o.columns)} -->`, "");
  t.header.forEach((name, i) => {
    if (skipped.has(i)) return;
    const meaning = told.get(name)?.meaning?.trim();
    out.push(`- **${oneLine(name)}**${meaning ? ` <!-- = ${oneLine(meaning)} -->` : ""}`);
  });
  out.push("");

  const groups = new Map<string, string[][]>();
  for (const r of t.rows) {
    const g = group < 0 ? "" : r[group].replace(/\s+/g, " ").trim();
    const rows = groups.get(g);
    if (rows) rows.push(r);
    else groups.set(g, [r]);
  }
  let shared = 0;
  const level = h(group < 0 ? o.level : o.level + 1);
  for (const [g, rows] of groups) {
    if (group >= 0) {
      const head = g || `(${t.header[group]} empty)`;
      out.push(`${h(o.level)} ${oneLine(head)} <!-- § ${uniqueKey(o.used, slug(head))} -->`, "");
    }
    for (const r of rows) {
      const k = key < 0 ? "" : r[key].trim();
      const named = titleAt < 0 ? "" : r[titleAt].replace(/\s+/g, " ").trim();
      const hash = createHash("sha256").update(r.join("\u0001")).digest("hex").slice(0, 8);
      const base = anchorOf(k) || (named && slug(named)) || `row-${hash}`;
      if (k && o.used.has(base)) shared++;
      const anchor = uniqueKey(o.used, base);
      const heading = [k, named === k ? "" : named].filter(Boolean).join(" ") || `Row ${hash}`;
      out.push(`${level} ${oneLine(heading)} <!-- § ${anchor} -->`, "");
      const fields = shown.filter((i) => r[i].trim()).map((i) => field(t.header[i], r[i]));
      if (fields.length) out.push(...fields, "");
    }
  }
  if (shared) warnings.push(`${where}${shared} rows share their key with a row above: anchored with -2, -3…`);
  if (!t.rows.length) warnings.push(`${where}The table has no row under its header`);
  return { lines: out, warnings };
}

// ponytail: the document's title line, then its tables
export function tableDoc(title: string, anchor: string, lines: string[]): string {
  const head = `# ${oneLine(title)} <!-- § ${anchor} -->`;
  return `${[head, "", ...lines]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

export function convertTable(bytes: Uint8Array, o: { title: string; table?: DocTable; tsv?: boolean }): Converted {
  const t = readTable(bytes, { delimiter: o.table?.delimiter, headerRow: o.table?.headerRow, tsv: o.tsv });
  const conf = o.table ?? guessTable(t);
  const title = o.title.trim() || "Table";
  const used = new Set<string>();
  const anchor = uniqueKey(used, slug(title));
  const d = drawTable(t, conf, { used, level: 2, columns: "columns" });
  return {
    md: tableDoc(title, anchor, d.lines),
    figures: [],
    warnings: [...(o.table ? [] : [notRead(conf)]), ...d.warnings],
    meta: { title, date: guessDate(t.preamble.flat().join(" ")) },
    convertedWith: TABLE_CONVERTER,
  };
}
