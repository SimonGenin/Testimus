import type { CheckFile, Finding, Source, Test } from "../../../core/types.ts";
import { parseSourceRef } from "../../lib/fields.ts";
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

const LABELS: Record<string, string> = { "column-unsourced": "Items without a source" };

export const kindLabel = (k: string) => {
  if (LABELS[k]) return LABELS[k];
  const s = k.replace(/-/g, " ");
  return s[0].toUpperCase() + s.slice(1);
};

export function notAtAnchor(findings: Finding[], ref: string, step: number | null): Finding | undefined {
  return findings.find(
    (f) => f.kind === "quote-not-at-anchor" && f.sources[0] === ref && (step === null || f.step === step),
  );
}

const RANK = { error: 0, warning: 1, info: 2 } as const;

// ponytail: what the source panel shows and the one element that opened it — a step's chip, a finding (its card when
// the test opens on it, its chip when clicked) or a passage the generation read; the panel's arrows walk `list`, the
// sources of that step or of that finding
export type Opened = Placed & { label?: string; mark: string; list: Source[]; finding?: number };

const same = (a: Source, b: Source) => refKey(a) === refKey(b) && a.quote === b.quote;

export const chipMark = (step: number, s: Source) => `s${step}:${refKey(s)}|${s.quote}`;
export const findingMark = (i: number, s?: Source) => (s ? `f${i}:${refKey(s)}` : `f${i}`);
export const findingRefs = (f: Finding) => f.sources.map(parseSourceRef).filter((s): s is Source => !!s);

const unique = (list: Source[]) => list.filter((s, i) => list.findIndex((x) => same(x, s)) === i);

export function chipOpened(test: Test, step: number, source: Source): Opened {
  const list = unique(test.steps[step - 1]?.sources ?? []);
  return { source, step, mark: chipMark(step, source), list: list.some((x) => same(x, source)) ? list : [source] };
}

export function findingOpened(test: Test, check: CheckFile | null, i: number, source?: Source): Opened | null {
  const f = check?.findings[i];
  if (!f) return null;
  const list = unique(findingRefs(f));
  const shown = source ?? list[0];
  if (!shown) return null;
  const step = f.step && f.step <= test.steps.length ? f.step : null;
  return {
    source: shown,
    step,
    mark: findingMark(i, source),
    list: list.some((x) => same(x, shown)) ? list : [shown],
    finding: i,
    ...(source ? {} : { label: `${step ? `Finding on step ${step}` : "Whole-test finding"} · ${kindLabel(f.kind)}` }),
  };
}

export const openedIndex = (p: Opened) =>
  Math.max(
    0,
    p.list.findIndex((s) => same(s, p.source)),
  );

export function moveOpened(test: Test, check: CheckFile | null, p: Opened, by: 1 | -1): Opened | null {
  const next = p.list[openedIndex(p) + by];
  if (!next) return null;
  if (p.finding !== undefined) return findingOpened(test, check, p.finding, next);
  return p.step ? chipOpened(test, p.step, next) : { ...p, source: next };
}

// ponytail: where the reviewer's eye goes first when a test opens — the worst finding that names a passage
export function firstFinding(test: Test, check: CheckFile | null): Opened | null {
  const fs = (check?.findings ?? [])
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i);
  for (const { i } of fs) {
    const opened = findingOpened(test, check, i);
    if (opened) return opened;
  }
  return null;
}

// ponytail: the panel follows ↑/↓ to the step's first own source, else to the source of one of its findings
export function stepOpened(test: Test, check: CheckFile | null, step: number): Opened | null {
  const own = test.steps[step - 1]?.sources[0];
  if (own) return chipOpened(test, step, own);
  const i = (check?.findings ?? []).findIndex((f) => f.step === step && findingRefs(f).length > 0);
  return i >= 0 ? findingOpened(test, check, i) : null;
}

export const firstLine = (s: string) =>
  s
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0] ?? "";
