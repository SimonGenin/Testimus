import type { ColumnLayout, Source, Step } from "../../core/types.ts";

export type FieldView = { name: string; collapsed: boolean };

const builtin = (name: string, id: string) =>
  ({ name, id, origin: "xray", builtin: true, status: "ok", description: "" }) as const;

export const DEFAULT_LAYOUT: ColumnLayout = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  columns: [
    { ...builtin("Action", "action"), mode: "open" },
    { ...builtin("Data", "data"), mode: "filled" },
    { ...builtin("Expected Result", "result"), mode: "open" },
  ],
};

// ponytail: the project's columns in their order (columns.list), then any heading a step holds that no column names
export function fieldViews(x: ColumnLayout, step?: Step): FieldView[] {
  const all = x.columns.map((c) => c.name);
  for (const k of Object.keys(step?.fields ?? {})) if (!all.includes(k)) all.push(k);
  const mode = (n: string) => x.columns.find((c) => c.name === n)?.mode;
  return all
    .filter((n) => mode(n) !== "hidden" || !!step?.fields[n]?.trim())
    .map((name) => ({ name, collapsed: mode(name) === "collapsed" }));
}

export const sourcePlace = (anchor: string) => {
  if (anchor.startsWith("fig:")) return `Figure ${anchor.slice(4)}`;
  if (anchor.startsWith("img:")) return `Image ${anchor.slice(4)}`;
  if (anchor.startsWith("frame:")) return `Frame ${anchor.slice(6)}`;
  if (anchor.startsWith("t:")) return anchor.slice(2).replace("..", " → ");
  if (anchor.startsWith("v:")) return `Seen ${anchor.slice(2).replace("..", " → ")}`;
  return anchor;
};

export const sourceLabel = (s: Pick<Source, "docId" | "anchor">) => `${s.docId} ${sourcePlace(s.anchor)}`;

export type ItemLink = { item: string; sources: Source[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

export const referencesSources = (x: ColumnLayout, column: string) =>
  x.columns.some((c) => c.referenceSource && same(c.name, column));

// ponytail: an item is a link only while its column links its items and the cell still holds it — any other
// source stays with the step's sources, so none is ever out of sight
export function itemLinks(x: ColumnLayout, step: Step, column: string): ItemLink[] {
  const cell = flat(step.fields[column] ?? "");
  if (!cell || !referencesSources(x, column)) return [];
  const out: ItemLink[] = [];
  for (const s of step.sources) {
    if (!s.column || !same(s.column, column) || (s.item && !cell.includes(flat(s.item)))) continue;
    const item = s.item ?? "";
    const at = out.find((l) => l.item === item);
    if (at) at.sources.push(s);
    else out.push({ item, sources: [s] });
  }
  return out;
}

export function stepSources(x: ColumnLayout, step: Step, columns: string[]): Source[] {
  const linked = new Set(columns.flatMap((c) => itemLinks(x, step, c).flatMap((l) => l.sources)));
  return step.sources.filter((s) => !linked.has(s));
}

export function parseSourceRef(ref: string): Source | null {
  const m = /^\s*([^#\s]+)#(\S+)(?:\s+"([^"]*)")?\s*$/.exec(ref);
  return m ? { docId: m[1], anchor: m[2], quote: m[3] ?? "" } : null;
}
