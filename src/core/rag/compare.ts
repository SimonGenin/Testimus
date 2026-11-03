import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { UserError } from "../command.ts";
import type { EvalReport, PolicyName } from "./eval.ts";
import { ROLES } from "./eval-score.ts";

const SEED = 20261102;
const EPS = 1e-9;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrap(diffs: number[], samples: number, seed = SEED): { low: number; high: number } {
  const n = diffs.length;
  if (!n) return { low: 0, high: 0 };
  const rand = mulberry32(seed);
  const means = new Float64Array(samples);
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rand() * n)];
    means[s] = sum / n;
  }
  means.sort();
  return { low: means[Math.floor(0.025 * samples)], high: means[Math.ceil(0.975 * samples) - 1] };
}

export function evalDir(project: string): string {
  return join(project, ".testimus", "eval");
}

function reportFile(project: string, name: string): string {
  const tries = isAbsolute(name)
    ? [name]
    : [resolve(project, name), join(evalDir(project), name), join(evalDir(project), `${name}.json`)];
  const found = tries.find((f) => existsSync(f) && statSync(f).isFile());
  if (!found) throw new UserError(`No report ${name}.`, "rag.eval writes its reports under .testimus/eval/.");
  return found;
}

export function readReport(file: string): EvalReport {
  let r: EvalReport;
  try {
    r = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as EvalReport;
  } catch {
    throw new UserError(`${file} is not a report.`, "Give a JSON report written by rag.eval.");
  }
  if (r?.version !== 2 || !Array.isArray(r.behaviors))
    throw new UserError(`${basename(file)} is not a v2 benchmark report.`, "Run rag.eval again to get one.");
  return r;
}

export function latestReport(project: string, except: string): string | null {
  const dir = evalDir(project);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f))
    .filter((f) => resolve(f) !== resolve(except))
    .filter((f) => {
      try {
        readReport(f);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs || b.localeCompare(a));
  return files[0] ?? null;
}

type RoleDiff = { recall: number; baseline: number; diff: number; n: number };
type CompareRow = {
  report: string;
  setting: string;
  n: number;
  recall: number;
  baseline: number;
  diff: number;
  low: number;
  high: number;
  byRole: Record<string, RoleDiff>;
  adopt: boolean;
  why: string;
  provisional: boolean;
  warnings: string[];
};
type Comparison = {
  baseline: string;
  policy: PolicyName;
  k: number;
  samples: number;
  provisional: boolean;
  rows: CompareRow[];
};

function usable(r: EvalReport, policy: PolicyName): boolean {
  return !!r.policies.find((p) => p.name === policy)?.available;
}

export function compare(
  base: EvalReport,
  others: EvalReport[],
  opts: { k?: number; samples?: number; policy?: PolicyName; names?: string[]; baseName?: string } = {},
): Comparison {
  const k = opts.k ?? 10;
  const samples = opts.samples ?? 10000;
  const all = [base, ...others];
  const policy = opts.policy ?? (all.every((r) => usable(r, "search+graph")) ? "search+graph" : "search");
  for (const r of all) {
    if (!usable(r, policy))
      throw new UserError(`The ${policy} policy is not available in ${basename(r.report)}.`, "Compare on search.");
    if (!r.config.ks.includes(k))
      throw new UserError(`${basename(r.report)} has no recall at k = ${k}.`, `Use one of ${r.config.ks.join(", ")}.`);
  }
  const baseBy = new Map(base.behaviors.map((b) => [b.id, b]));
  const rows = others.map((r, i): CompareRow => {
    const warnings: string[] = [];
    if (r.config.set.hash !== base.config.set.hash)
      warnings.push("The behavior sets differ: only the behaviors present in both are paired.");
    if (r.config.corpus !== base.config.corpus) warnings.push("The documents differ between the two reports.");
    const pairs = r.behaviors
      .filter((b) => baseBy.has(b.id))
      .map((b) => ({ now: b.policies[policy], was: baseBy.get(b.id)?.policies[policy] }))
      .filter((p) => p.now && p.was);
    if (!pairs.length)
      throw new UserError(`${basename(r.report)} shares no behavior with the baseline.`, "Run both on the same set.");
    const now = pairs.map((p) => p.now?.atK[k].recall ?? 0);
    const was = pairs.map((p) => p.was?.atK[k].recall ?? 0);
    const diffs = now.map((x, j) => x - was[j]);
    const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    const { low, high } = bootstrap(diffs, samples);
    const roleNames = [...ROLES, ...new Set(pairs.flatMap((p) => Object.keys(p.was?.roles ?? {})))].filter(
      (role, j, xs) => xs.indexOf(role) === j && pairs.some((p) => p.was?.roles[role]),
    );
    const byRole: Record<string, RoleDiff> = {};
    for (const role of roleNames) {
      let n = 0;
      let gotNow = 0;
      let gotWas = 0;
      for (const p of pairs) {
        const w = p.was?.roles[role];
        if (!w) continue;
        n += w.n;
        gotWas += w.found[k] ?? 0;
        gotNow += p.now?.roles[role]?.found[k] ?? 0;
      }
      if (!n) continue;
      byRole[role] = { recall: gotNow / n, baseline: gotWas / n, diff: (gotNow - gotWas) / n, n };
    }
    const down = Object.entries(byRole)
      .filter(([, d]) => d.diff < -EPS)
      .map(([role]) => role);
    const up = low > EPS;
    const why = !up
      ? `The 95 % interval [${low.toFixed(3)}, ${high.toFixed(3)}] does not exclude zero upwards.`
      : down.length
        ? `Recall goes down for: ${down.join(", ")}.`
        : "The interval is above zero and no role goes down.";
    const provisional = r.provisional || base.provisional;
    return {
      report: opts.names?.[i] ?? r.report,
      setting: r.setting,
      n: pairs.length,
      recall: mean(now),
      baseline: mean(was),
      diff: mean(diffs),
      low,
      high,
      byRole,
      adopt: up && !down.length,
      why: provisional ? `${why} Provisional: the behavior set is not validated by the testers.` : why,
      provisional,
      warnings,
    };
  });
  return {
    baseline: opts.baseName ?? base.report,
    policy,
    k,
    samples,
    provisional: all.some((r) => r.provisional),
    rows,
  };
}

export function compareFiles(
  project: string,
  input: { reports: string[]; k?: number; samples?: number; policy?: PolicyName },
): Comparison {
  const files = input.reports.map((n) => reportFile(project, n));
  if (files.length === 1) {
    const latest = latestReport(project, files[0]);
    if (!latest)
      throw new UserError("There is no other report to compare with.", "Run rag.eval with the setting to try.");
    files.push(latest);
  }
  const [base, ...others] = files.map(readReport);
  return compare(base, others, { ...input, names: files.slice(1), baseName: files[0] });
}
