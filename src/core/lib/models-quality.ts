import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { compare, evalDir, readReport } from "../rag/compare.ts";
import type { EvalReport, PolicyName } from "../rag/eval.ts";

export const QUALITY_K = 10;
export const NOT_MEASURED = "quality not measured yet";

export type QualityKey = { embedding: string; reranker: string | null; space?: string | null };
export type Measured = { file: string; report: EvalReport; mtime: number };
export type Recall = {
  recall: number;
  n: number;
  k: number;
  policy: PolicyName;
  provisional: boolean;
  file: string;
};
export type QualityDiff = {
  diff: number;
  low: number;
  high: number;
  n: number;
  k: number;
  policy: PolicyName;
  provisional: boolean;
  from: string;
  to: string;
};

// ponytail: a run with --retrieval overrides measures other settings than the pack's; its setting ends in -r<hex>
const OVERRIDDEN = /-r[0-9a-f]{6}$/;

export function evalReports(project: string): Measured[] {
  const dir = evalDir(project);
  if (!existsSync(dir)) return [];
  const out: Measured[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const file = join(dir, f);
    try {
      const report = readReport(file);
      if (report.config.mode === "bm25" || OVERRIDDEN.test(report.setting)) continue;
      out.push({ file, report, mtime: statSync(file).mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file));
}

export function matches(r: EvalReport, key: QualityKey): boolean {
  if ((r.config.reranker ?? null) !== key.reranker) return false;
  if (key.space) return r.config.space?.id === key.space;
  return r.config.embedding === key.embedding;
}

export function reportFor(key: QualityKey, reports: Measured[]): Measured | null {
  return reports.find((m) => matches(m.report, key)) ?? null;
}

function policyOf(...reports: EvalReport[]): PolicyName {
  const has = (r: EvalReport, p: PolicyName) => !!r.policies.find((x) => x.name === p && x.available && x.totals);
  return reports.every((r) => has(r, "search+graph")) ? "search+graph" : "search";
}

export function measuredRecall(key: QualityKey, reports: Measured[]): Recall | null {
  const hit = reportFor(key, reports);
  if (!hit) return null;
  const policy = policyOf(hit.report);
  const totals = hit.report.policies.find((p) => p.name === policy)?.totals;
  const at = totals?.atK[String(QUALITY_K)];
  if (!totals || !at) return null;
  return {
    recall: at.recall,
    n: totals.n,
    k: QUALITY_K,
    policy,
    provisional: hit.report.provisional,
    file: hit.file,
  };
}

export function qualityDiff(
  from: QualityKey,
  to: QualityKey,
  reports: Measured[],
  samples = 10000,
): QualityDiff | null {
  const cand = reportFor(to, reports);
  if (!cand) return null;
  const bases = reports.filter((m) => matches(m.report, from) && m.file !== cand.file);
  const same = (m: Measured) =>
    m.report.config.set.hash === cand.report.config.set.hash && m.report.config.corpus === cand.report.config.corpus;
  const base = bases.find(same) ?? bases[0];
  if (!base) return null;
  try {
    const c = compare(base.report, [cand.report], { k: QUALITY_K, samples });
    const row = c.rows[0];
    return {
      diff: row.diff,
      low: row.low,
      high: row.high,
      n: row.n,
      k: QUALITY_K,
      policy: c.policy,
      provisional: row.provisional,
      from: base.file,
      to: cand.file,
    };
  } catch {
    return null;
  }
}

export function points(x: number): string {
  const p = Math.round(x * 1000) / 10;
  if (p === 0) return "0";
  return `${p < 0 ? "−" : "+"}${Math.abs(p)}`;
}

function evalCommand(key: QualityKey): string {
  return `rag.eval --embedding ${key.embedding}${key.reranker ? ` --reranker ${key.reranker}` : ""}`;
}

export function diffText(d: QualityDiff): string {
  const range = `${points(d.low)}…${points(d.high)}`.replace(/^\+/, "").replace(/…\+/, "…");
  return `${points(d.diff)} points of evidence recall, interval ${range} (recall@${d.k}, ${d.n} behaviors${d.provisional ? "; provisional: the behavior set is not validated" : ""})`;
}

export function adviceQuality(from: QualityKey, to: QualityKey, reports: Measured[]): string {
  const d = qualityDiff(from, to, reports);
  if (d) return diffText(d);
  const haveTo = !!reportFor(to, reports);
  const haveFrom = reports.some((m) => matches(m.report, from));
  const run = !haveTo
    ? `run ${evalCommand(to)} on the candidate`
    : !haveFrom
      ? "run rag.eval on the current models"
      : "the two reports could not be paired";
  return `quality difference not measured — ${run} before switching`;
}

export function packQuality(key: QualityKey, reports: Measured[]): string {
  const r = measuredRecall(key, reports);
  if (!r) return NOT_MEASURED;
  return `evidence recall ${Math.round(r.recall * 1000) / 10} % on this project (recall@${r.k}, ${r.n} behaviors${r.provisional ? ", provisional" : ""})`;
}
