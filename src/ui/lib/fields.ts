import type { Source, Step, XrayJson } from "../../core/types.ts";

export type FieldView = { name: string; collapsed: boolean; requirements: boolean };

export const DEFAULT_XRAY: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Data", "Expected Result"], collapsed: ["Data"], hidden: [] },
};

// ponytail: the requirement field is named by the team (Exigence for LFRPS12), so it is recognised by
// its name — a project.json setting can replace this guess when a second naming shows up
const REQUIREMENT = /^(exigences?|requirements?|req)$/i;

export const isRequirementField = (name: string) => REQUIREMENT.test(name.trim());

export function fieldViews(x: XrayJson, step?: Step): FieldView[] {
  const names = x.fields.map((f) => f.name);
  const ordered = x.prefs.order.filter((n) => names.includes(n));
  const all = [...ordered, ...names.filter((n) => !ordered.includes(n))];
  for (const k of Object.keys(step?.fields ?? {})) if (!all.includes(k)) all.push(k);
  return all
    .filter((n) => !x.prefs.hidden.includes(n) || !!step?.fields[n]?.trim())
    .map((name) => ({ name, collapsed: x.prefs.collapsed.includes(name), requirements: isRequirementField(name) }));
}

export const splitIds = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);

export const joinIds = (ids: string[]) => ids.join(", ");

export const sourceLabel = (s: Pick<Source, "docId" | "anchor">) => {
  if (s.anchor.startsWith("req:")) return `${s.docId} ${s.anchor.slice(4)}`;
  if (s.anchor.startsWith("fig:")) return `${s.docId} Figure ${s.anchor.slice(4)}`;
  return `${s.docId} ${s.anchor}`;
};

export function parseSourceRef(ref: string): Source | null {
  const m = /^\s*([^#\s]+)#(\S+)(?:\s+"([^"]*)")?\s*$/.exec(ref);
  return m ? { docId: m[1], anchor: m[2], quote: m[3] ?? "" } : null;
}
