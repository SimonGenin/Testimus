import type { Source, Step, TraceView, XrayJson } from "../../core/types.ts";
import { traceOfField, tracesNow } from "./traces.ts";

export type FieldView = { name: string; collapsed: boolean; requirements: boolean; trace?: TraceView };

export const DEFAULT_XRAY: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Data", "Expected Result"], collapsed: [], hidden: [], filled: ["Data"] },
};

// ponytail: an id column is one the project tracks (project.info traces); before the project is read, the
// requirement column is recognised by its usual names
const REQUIREMENT = /^(exigences?|requirements?|req)$/i;

export const isRequirementField = (name: string) =>
  tracesNow() ? !!traceOfField(name) : REQUIREMENT.test(name.trim());

// ponytail: the ids a test cites, one group per tracked kind, in the order of its steps
export function idsByKind(steps: Step[]): { label: string; ids: string[] }[] {
  const out: { label: string; ids: string[] }[] = [];
  for (const s of steps)
    for (const [k, v] of Object.entries(s.fields)) {
      if (!isRequirementField(k)) continue;
      const label = traceOfField(k)?.label ?? "Requirement";
      let g = out.find((x) => x.label === label);
      if (!g) {
        g = { label, ids: [] };
        out.push(g);
      }
      for (const id of splitIds(v)) if (!g.ids.includes(id)) g.ids.push(id);
    }
  return out.filter((g) => g.ids.length);
}

export function fieldViews(x: XrayJson, step?: Step): FieldView[] {
  const names = x.fields.map((f) => f.name);
  const ordered = x.prefs.order.filter((n) => names.includes(n));
  const all = [...ordered, ...names.filter((n) => !ordered.includes(n))];
  for (const k of Object.keys(step?.fields ?? {})) if (!all.includes(k)) all.push(k);
  for (const t of tracesNow() ?? []) if (!all.includes(t.field)) all.push(t.field);
  return all
    .filter((n) => !x.prefs.hidden.includes(n) || !!step?.fields[n]?.trim())
    .map((name) => {
      const trace = traceOfField(name);
      return {
        name,
        collapsed: x.prefs.collapsed.includes(name),
        requirements: isRequirementField(name),
        ...(trace ? { trace } : {}),
      };
    });
}

// ponytail: ids are listed with commas; a space separates ids only when every word looks like one (EXI_A EXI_B),
// so an id that holds a space (Figure 40, UC 12) stays whole
const idLike = (w: string) => /[\p{L}]/u.test(w) && /[\d_]/.test(w);

export const splitIds = (value: string) =>
  value
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .flatMap((piece) => {
      const words = piece.split(/\s+/);
      return words.length > 1 && words.every(idLike) ? words : [piece];
    });

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
