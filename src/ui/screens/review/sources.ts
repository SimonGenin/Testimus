import type { CheckFile, Finding, Source, Test } from "../../../core/types.ts";
import { plural } from "../../lib/format.ts";

export type Placed = { source: Source; step: number | null };

export const refKey = (s: Pick<Source, "docId" | "anchor">) => `${s.docId}#${s.anchor}`;

export function findingSummary(fs: Finding[]): { tone: "error" | "warning" | "info" | "ok"; text: string } {
  const e = fs.filter((f) => f.severity === "error").length;
  const w = fs.filter((f) => f.severity === "warning").length;
  const i = fs.filter((f) => f.severity === "info").length;
  if (e) return { tone: "error", text: plural(e, "error") };
  if (w) return { tone: "warning", text: plural(w, "warning") };
  if (i) return { tone: "info", text: `${i} info` };
  return { tone: "ok", text: "No findings" };
}

export const kindLabel = (k: string) => {
  const s = k.replace(/-/g, " ");
  return s[0].toUpperCase() + s.slice(1);
};

export function notAtAnchor(findings: Finding[], ref: string, step: number | null): Finding | undefined {
  return findings.find(
    (f) => f.kind === "quote-not-at-anchor" && f.sources[0] === ref && (step === null || f.step === step),
  );
}

const refSource = (r: string): Source | null => {
  const [docId, anchor] = r.split("#");
  return anchor ? { docId, anchor, quote: "" } : null;
};

const RANK = { error: 0, warning: 1, info: 2 } as const;

// ponytail: where the reviewer's eye goes first when a test opens — the worst finding that names a passage
export function firstFinding(test: Test, check: CheckFile | null): (Placed & { label: string }) | null {
  const fs = (check?.findings ?? [])
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i);
  for (const { f } of fs) {
    const source = f.sources.map(refSource).find((s) => s !== null);
    if (!source) continue;
    const step = f.step && f.step <= test.steps.length ? f.step : null;
    return { source, step, label: `${step ? `Finding on step ${step}` : "Whole-test finding"} · ${kindLabel(f.kind)}` };
  }
  return null;
}

// ponytail: the order the source panel walks — the whole-test findings' sources, then each step's own sources and its
// findings' sources; a source shows once per step
export function placedSources(test: Test, check: CheckFile | null): Placed[] {
  const out: Placed[] = [];
  const seen = new Set<string>();
  const add = (source: Source | null, step: number | null) => {
    if (!source) return;
    const k = refKey(source) + (step ?? "");
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ source, step });
  };
  const findings = check?.findings ?? [];
  for (const f of findings) if (!f.step) for (const r of f.sources) add(refSource(r), null);
  test.steps.forEach((s, i) => {
    for (const src of s.sources) add(src, i + 1);
    for (const f of findings) if (f.step === i + 1) for (const r of f.sources) add(refSource(r), i + 1);
  });
  return out;
}

export const firstLine = (s: string) =>
  s
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0] ?? "";
