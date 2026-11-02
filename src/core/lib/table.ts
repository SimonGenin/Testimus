import type { Row, Table } from "../types.ts";

// ponytail: a Jira wiki table is text and it stays text. Nothing here ever regenerates the markup from
// a model — the parser only says where every cell sits, so editing one is the same single splice into
// the field string that every other block does, and everything Xray wrote around it survives untouched.

type Line = { at: number; end: number; text: string };

const EMBED = /![^!\n]*!/y;

const rowAt = (text: string, at: number, end: number): Row => {
  const s = text.slice(at, end);
  const head = s.startsWith("||");
  const sep = head ? "||" : "|";
  const from = sep.length;
  const to = s.length > from && s.endsWith(sep) ? s.length - sep.length : s.length;
  const cells = [];
  let start = from;
  for (let p = from; p < to; ) {
    EMBED.lastIndex = p;
    if (EMBED.exec(s)) {
      p = EMBED.lastIndex;
    } else if (s.startsWith(sep, p)) {
      cells.push({ text: s.slice(start, p), at: at + start, end: at + p });
      start = p += sep.length;
    } else {
      p++;
    }
  }
  cells.push({ text: s.slice(start, to), at: at + start, end: at + to });
  return { head, cells, at, end };
};

export function tablesIn(text: string): Table[] {
  const lines: Line[] = [];
  let at = 0;
  for (const t of text.split("\n")) {
    lines.push({ at, end: at + t.length, text: t });
    at += t.length + 1;
  }
  const pipe = (i: number) => lines[i].text.startsWith("|");
  const out: Table[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!pipe(i)) continue;
    let last = i;
    while (last + 1 < lines.length && lines[last + 1].text.trim() !== "") last++;
    const rows: Row[] = [];
    for (let k = i; k <= last; k++) {
      if (!pipe(k)) continue;
      let end = k;
      while (end + 1 <= last && !pipe(end + 1)) end++;
      rows.push(rowAt(text, lines[k].at, lines[end].end));
      k = end;
    }
    out.push({ rows, at: lines[i].at, end: lines[last].end });
    i = last;
  }
  return out;
}

export const width = (t: Table) => Math.max(...t.rows.map((r) => r.cells.length));

const cut = (text: string, at: number, end: number) => text.slice(0, at) + text.slice(end);

export const addRow = (text: string, t: Table) => {
  const at = t.rows[t.rows.length - 1].end;
  return text.slice(0, at) + "\n|" + " |".repeat(width(t)) + text.slice(at);
};

export const dropRow = (text: string, t: Table, i: number) => {
  if (t.rows.length === 1) return cut(text, t.at, t.end);
  const r = t.rows[i];
  return i === 0 ? cut(text, r.at, t.rows[1].at) : cut(text, t.rows[i - 1].end, r.end);
};

export const addCol = (text: string, t: Table) => {
  for (const r of [...t.rows].reverse()) {
    const at = r.cells[r.cells.length - 1].end;
    text = text.slice(0, at) + (r.head ? "|| " : "| ") + text.slice(at);
  }
  return text;
};

export const dropCol = (text: string, t: Table, i: number) => {
  if (width(t) === 1) return cut(text, t.at, t.end);
  for (const r of [...t.rows].reverse()) {
    const c = r.cells[i];
    if (!c) continue;
    const sep = r.head ? 2 : 1;
    text = i === r.cells.length - 1 ? cut(text, c.at - sep, c.end) : cut(text, c.at, c.end + sep);
  }
  return text;
};

export const NEW_TABLE = "||Heading||Heading||\n| | |";
