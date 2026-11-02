import { createHash } from "node:crypto";
import type { Advice, Budgets, CatalogEntry, Fit, MachineProfile, Pack, PackVariant, RagChoice } from "../types.ts";
import { catalog, catalogEntry } from "./models-catalog.ts";
import { fitOf } from "./models-fit.ts";
import { memoryFailures, type PerfRecord, type PerfStat, perfStats } from "./models-perf.ts";
import { adviceQuality, evalReports, type Measured } from "./models-quality.ts";

export const PACK_ORDER = ["quality", "balanced", "performance", "light"];
export const MIN_OPS = 5;
export const WINDOW = 50;
export const NOT_MEASURED = "quality difference not measured — run rag.eval on the candidate before switching";

export type AdviceInput = {
  choice: RagChoice;
  variant: PackVariant;
  machine: MachineProfile;
  lines: PerfRecord[];
  budgets: Budgets;
  dismissed?: Record<string, string>;
  packs?: Pack[];
  project?: string;
  reports?: Measured[];
};
export type AdviceOut = Advice & { metric: number };

function entries(v: PackVariant): CatalogEntry[] {
  return [v.embedding, v.reranker]
    .filter((m): m is string => !!m)
    .map((m) => catalogEntry(m))
    .filter((e): e is CatalogEntry => !!e);
}

export function fitsVariant(v: PackVariant, input: AdviceInput): Fit {
  return fitOf(entries(v), input.machine, { headroom: input.budgets.headroom, lines: input.lines });
}

export function packVariantThatFits(p: Pack, input: AdviceInput): { v: PackVariant; i: number; fit: Fit } | null {
  for (const [i, v] of p.variants.entries()) {
    const fit = fitsVariant(v, input);
    if (fit.verdict === "fits") return { v, i, fit };
  }
  return null;
}

const key = (c: RagChoice) => ("pack" in c ? `pack:${c.pack}` : `${c.embedding}+${c.reranker ?? "none"}`);

export function adviceId(direction: string, from: RagChoice, to: RagChoice): string {
  return createHash("sha1")
    .update(`${direction}|${key(from)}|${key(to)}`)
    .digest("hex")
    .slice(0, 12);
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const labelOf = (id: string | null) => (id ? (catalogEntry(id)?.label ?? id) : "no reranker");
const variantLabel = (v: PackVariant) => `${labelOf(v.embedding)}${v.reranker ? ` + ${labelOf(v.reranker)}` : ""}`;

function stat(stats: PerfStat[], op: string, model: string | null): PerfStat | undefined {
  if (!model) return undefined;
  const all = stats.filter((s) => s.op === op && s.model === model);
  return all.sort((a, b) => b.count - a.count)[0];
}

export function changed(old: string | undefined, now: number): boolean {
  if (old === undefined) return true;
  const was = Number(old);
  if (!Number.isFinite(was) || was === 0) return now !== was;
  return Math.abs(now - was) / Math.abs(was) > 0.25;
}

export function advise(input: AdviceInput): AdviceOut[] {
  const packs = input.packs ?? catalog().packs;
  const stats = perfStats({ last: WINDOW, lines: input.lines });
  const { embedding: e, reranker: r } = input.variant;
  const q = stat(stats, "embed.query", e);
  const rr = stat(stats, "rerank", r);
  const idx = stat(stats, "embed.index", e);
  const queryP95 = (q?.p95 ?? 0) + (rr?.p95 ?? 0);
  const loads = [stat(stats, "model.load", e), stat(stats, "model.load", r)];
  const partial = [q, rr, idx, ...loads].find((s) => s?.partialOffload);
  const oom = [e, r]
    .filter((m): m is string => !!m)
    .map((m) => ({ m, n: memoryFailures(m, input.lines, WINDOW) }))
    .find((x) => x.n > 0);
  const reasons: string[] = [];
  let metric = queryP95;
  if (q && q.count >= MIN_OPS && queryP95 > input.budgets.queryMs)
    reasons.push(`queries take ${ms(queryP95)} at p95 here (budget ${ms(input.budgets.queryMs)})`);
  else if (idx && idx.count >= MIN_OPS && idx.perSecond < input.budgets.indexPassagesPerSec) {
    reasons.push(
      `indexing runs at ${idx.perSecond} passages/s here (budget ${input.budgets.indexPassagesPerSec} passages/s)`,
    );
    metric = idx.perSecond;
  }
  if (partial) {
    reasons.push(`${labelOf(partial.model)} ran partly on the processor`);
    if (!reasons[1]) metric = metric || 1;
  }
  if (oom) {
    const times = oom.n === 1 ? "once" : `${oom.n} times`;
    reasons.push(`${labelOf(oom.m)} ran out of memory on this PC (${times} in its last ${WINDOW} operations)`);
    if (reasons.length === 1) metric = oom.n;
  }
  const out: AdviceOut[] = [];
  let reports = input.reports;
  const quality = (to: PackVariant): string => {
    if (!input.project && !reports) return NOT_MEASURED;
    reports ??= evalReports(input.project as string);
    return adviceQuality(input.variant, to, reports);
  };
  const push = (direction: "upgrade" | "downgrade", to: RagChoice, v: PackVariant, reason: string) => {
    const id = adviceId(direction, input.choice, to);
    if (!changed(input.dismissed?.[id], metric)) return;
    out.push({
      id,
      direction,
      from: input.choice,
      to,
      reason,
      quality: quality(v),
      metric: Math.round(metric * 10) / 10,
    });
  };
  const current =
    "pack" in input.choice ? packs.find((p) => "pack" in input.choice && p.id === input.choice.pack) : undefined;
  const at = current ? current.variants.findIndex((v) => v.embedding === e && v.reranker === r) : -1;

  if (reasons.length) {
    const why = reasons.join("; ");
    if (current) {
      for (const v of current.variants.slice(at + 1)) {
        const fit = fitsVariant(v, input);
        if (fit.verdict !== "fits") continue;
        push(
          "downgrade",
          { embedding: v.embedding, reranker: v.reranker },
          v,
          `Use ${current.label}'s lighter variant (${variantLabel(v)}): ${why}.`,
        );
        return out;
      }
      for (const id of PACK_ORDER.slice(PACK_ORDER.indexOf(current.id) + 1)) {
        const p = packs.find((x) => x.id === id);
        const hit = p ? packVariantThatFits(p, input) : null;
        if (!p || !hit) continue;
        push("downgrade", { pack: p.id }, hit.v, `Move to ${p.label} (${variantLabel(hit.v)}): ${why}.`);
        return out;
      }
      return out;
    }
    for (let id = catalogEntry(e)?.lighter; id; id = catalogEntry(id)?.lighter) {
      const v = { embedding: id, reranker: r };
      if (fitsVariant(v, input).verdict !== "fits") continue;
      push("downgrade", v, v, `Use ${labelOf(id)}: ${why}.`);
      return out;
    }
    return out;
  }

  if (!q || q.count < WINDOW || queryP95 >= input.budgets.queryMs * 0.2) return out;
  const fast = `queries take ${ms(queryP95)} at p95 here, under 20 % of the ${ms(input.budgets.queryMs)} budget`;
  if (current) {
    for (let i = at - 1; i >= 0; i--) {
      const v = current.variants[i];
      const fit = fitsVariant(v, input);
      if (fit.verdict !== "fits") continue;
      push(
        "upgrade",
        { embedding: v.embedding, reranker: v.reranker },
        v,
        `${current.label}'s heavier variant fits (${variantLabel(v)}): ${fast}.`,
      );
      return out;
    }
    for (const id of PACK_ORDER.slice(0, Math.max(0, PACK_ORDER.indexOf(current.id))).reverse()) {
      const p = packs.find((x) => x.id === id);
      const hit = p ? packVariantThatFits(p, input) : null;
      if (!p || !hit) continue;
      push("upgrade", { pack: p.id }, hit.v, `Move to ${p.label} (${variantLabel(hit.v)}), it fits: ${fast}.`);
      return out;
    }
    return out;
  }
  const heavier = catalogEntry(e)?.heavier;
  if (heavier) {
    const v = { embedding: heavier, reranker: r };
    if (fitsVariant(v, input).verdict === "fits")
      push("upgrade", v, v, `${labelOf(heavier)} fits with the reranker in place: ${fast}.`);
  }
  return out;
}
