import type { Source, Step, XrayJson } from "../../core/types.ts";

export type FieldView = { name: string; collapsed: boolean };

export const DEFAULT_XRAY: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Data", "Expected Result"], collapsed: [], hidden: [], filled: ["Data"] },
};

// ponytail: a local column is one the project keeps in test.md only — no Xray field has its id or its name
export function localColumns(x: XrayJson): string[] {
  const ids = new Set(x.fields.map((f) => f.id));
  const names = new Set(x.fields.map((f) => f.name.toLowerCase()));
  return (x.columns ?? [])
    .filter((c) => !(c.id && ids.has(c.id)) && !names.has(c.name.toLowerCase()))
    .map((c) => c.name);
}

export function fieldViews(x: XrayJson, step?: Step): FieldView[] {
  const names = [...x.fields.map((f) => f.name), ...localColumns(x)];
  const ordered = x.prefs.order.filter((n) => names.includes(n));
  const all = [...ordered, ...names.filter((n) => !ordered.includes(n))];
  for (const k of Object.keys(step?.fields ?? {})) if (!all.includes(k)) all.push(k);
  return all
    .filter((n) => !x.prefs.hidden.includes(n) || !!step?.fields[n]?.trim())
    .map((name) => ({ name, collapsed: x.prefs.collapsed.includes(name) }));
}

export const sourcePlace = (anchor: string) => {
  if (anchor.startsWith("fig:")) return `Figure ${anchor.slice(4)}`;
  return anchor;
};

export const sourceLabel = (s: Pick<Source, "docId" | "anchor">) => `${s.docId} ${sourcePlace(s.anchor)}`;

export function parseSourceRef(ref: string): Source | null {
  const m = /^\s*([^#\s]+)#(\S+)(?:\s+"([^"]*)")?\s*$/.exec(ref);
  return m ? { docId: m[1], anchor: m[2], quote: m[3] ?? "" } : null;
}
