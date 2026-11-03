import { useContext } from "react";
import type { Source, TraceView } from "../../core/types.ts";
import { call } from "../api.ts";
import { AppContext } from "./app.ts";
import { errorToast, toast } from "./toast.ts";

// ponytail: the open project's tracked ids, set by App with project.info — the field helpers read them so
// every screen that shows step fields adapts without being handed the list
let current: TraceView[] | null = null;

export function setTraces(t: TraceView[] | null): void {
  current = t;
}

export const tracesNow = (): TraceView[] | null => current;

export const traceOfField = (name: string): TraceView | undefined =>
  current?.find((t) => t.field.trim().toLowerCase() === name.trim().toLowerCase());

export const REQUIREMENT = "requirement";

export function idPattern(t: Pick<TraceView, "patterns"> | undefined): RegExp | null {
  const ok = (t?.patterns ?? []).filter((p) => {
    try {
      return !new RegExp(p).test("");
    } catch {
      return false;
    }
  });
  return ok.length ? new RegExp(ok.map((p) => `(?:${p})`).join("|"), "g") : null;
}

// ponytail: an id in a step column is a link to where the documents write it, highlighted in the passage
export async function sourceOfId(id: string): Promise<Source | null> {
  try {
    const [at] = await call<{ id: string; doc: string; anchor: string }[]>("traces.locate", { ids: [id] });
    if (at) return { docId: at.doc, anchor: at.anchor, quote: id };
    toast({ kind: "info", title: `${id} is in no document`, detail: "No imported document writes this id." });
  } catch (e) {
    errorToast(e, `Could not look up ${id}`);
  }
  return null;
}

export function useOpenId(): ((id: string) => void) | undefined {
  const open = useContext(AppContext)?.openSource;
  return open ? (id) => void sourceOfId(id).then((s) => s && open(s)) : undefined;
}

// ponytail: « Generate tests for the missing ids » hands its ids to the Generate screen it opens
let handed: { trace: string; ids: string[] } | null = null;

export function handOff(trace: string, ids: string[]): void {
  handed = { trace, ids };
}

export function takeHandoff(): Record<string, string[]> {
  const h = handed;
  handed = null;
  return h ? { [h.trace]: h.ids } : {};
}

export function exampleOf(t: Pick<TraceView, "patterns" | "label">): string {
  const p = t.patterns[0] ?? "";
  const lit = p
    .replace(/\\b/g, "")
    .replace(/\[[^\]]*\][*+?]?|\\d[*+?]?|\{[^}]*\}|[()?:|]/g, "")
    .replace(/\\(.)/g, "$1");
  return lit.trim() ? `${lit.trim()}…` : t.label;
}
