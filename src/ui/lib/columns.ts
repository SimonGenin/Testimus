import type { ColumnLayout, ColumnMode, ColumnModes, Step } from "../../core/types.ts";
import { fieldViews } from "./fields.ts";

// One column of the step card. A built-in one is a field of blocks (text, screenshots, tables); a project
// one is plain text — `line` for Xray's single-line type, `text` for the rest — or `readonly` when Xray
// holds something other than text there, which this app draws but never edits
export type Column = {
  name: string;
  kind: "blocks" | "text" | "line" | "readonly";
  known: boolean;
  off?: boolean;
};

const kindOf = (type: string): Column["kind"] =>
  type === "text-single" ? "line" : type === "text" || type === "" ? "text" : "readonly";

// ponytail: with Jira not connected, or its step fields never read, no column can be said « not in Xray »
export function columnsOf(x: ColumnLayout, step?: Step, linked = true): Column[] {
  const types = new Map(x.fields.map((f) => [f.name, f.type]));
  const off = new Set(x.fields.filter((f) => f.disabled).map((f) => f.name));
  const builtin = new Set([...x.fields, ...x.columns].filter((f) => f.builtin).map((f) => f.name));
  return fieldViews(x, step).map((v): Column => {
    const known = !linked || types.has(v.name);
    const flag = off.has(v.name) ? { off: true } : {};
    if (builtin.has(v.name)) return { name: v.name, kind: "blocks", known: true, ...flag };
    return { name: v.name, kind: known ? kindOf(types.get(v.name) ?? "") : "text", known, ...flag };
  });
}

// Action and Expected Result are the test itself and never fold away; every other column can
export const collapsible = (c: Pick<Column, "name">) => c.name !== "Action" && c.name !== "Expected Result";

// ponytail: every column says its mode in columns.list; a hidden one, shown because a step holds text, is open
export const projectModes = (x: ColumnLayout): ColumnModes => {
  const out: ColumnModes = {};
  for (const c of x.columns) if (c.mode !== "hidden") out[c.name] = c.mode;
  return out;
};

// a column switched off in Xray folds away unless a step holds something (Xray Editor's default)
export const defaultMode = (c: Pick<Column, "name" | "off">): ColumnMode => (c.off ? "filled" : "open");

// ponytail: three layers, most specific first — the test's own choice, the project's, the default — and
// the step's own toggle sits on top of the result, in the card, for the session only
export const modeOf = (c: Pick<Column, "name" | "off">, project: ColumnModes, test: ColumnModes | null): ColumnMode =>
  !collapsible(c) ? "open" : (test?.[c.name] ?? project[c.name] ?? defaultMode(c));

export const openByDefault = (mode: ColumnMode, value: string) =>
  mode === "open" || (mode === "filled" && value.trim() !== "");

export const MODES: Array<{ value: ColumnMode; label: string; title: string }> = [
  { value: "open", label: "open", title: "Shown on every step" },
  { value: "filled", label: "when filled", title: "Shown only on a step where it holds something" },
  {
    value: "collapsed",
    label: "collapsed",
    title: "Folded on every step — its toggle shows a dot when it holds something",
  },
];

// ponytail: the split layout gives each open column a track — a field 1fr, Expected 1.25fr while it is one of only
// two fields shown (project columns beside them do not count, as in Xray Editor), a line column .6fr, a text one .8fr
export function splitTracks(cols: Column[]): string {
  const alone = cols.filter((c) => c.kind === "blocks").length === 2;
  return cols
    .map((c) =>
      c.kind === "blocks"
        ? `minmax(0, ${alone && c.name === "Expected Result" ? 1.25 : 1}fr)`
        : `minmax(0, ${c.kind === "line" ? 0.6 : 0.8}fr)`,
    )
    .join(" ");
}
