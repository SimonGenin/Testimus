import { join, resolve } from "node:path";
import { CancelledError, scope } from "../../shared/run/work.ts";
import { readLedger } from "../claude/ledger.ts";
import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { writeJson } from "../lib/project.ts";
import { readCheck } from "../lib/store.ts";
import type { ActiveChoice, Effort, FindingKind, RagChoice } from "../types.ts";
import { activeChoice, setActiveChoice } from "./activation.ts";
import { allChunks, withIndex } from "./db.ts";
import { APP_VERSION } from "./eval.ts";
import { chunkResolver, type Item, itemMatches } from "./eval-score.ts";
import { defaultSet, readBehaviors } from "./eval-set.ts";

type Invoke = (name: string, input: unknown, opts: { project: string; signal?: AbortSignal }) => Promise<unknown>;

const registryInvoke: Invoke = async (name, input, opts) =>
  (await import("../commands/index.ts")).invoke(name, input, opts);

// ponytail: activating a configuration writes this PC's settings and gen.tests runs Claude — tests swap these four
// (env is no seam for them); invoke reaches the registry lazily, since the registry imports this file
export const benchHooks = {
  current: (project: string): ActiveChoice | null => activeChoice(project),
  activate: (project: string, choice: RagChoice | ActiveChoice | null): void => setActiveChoice(project, choice),
  prepare: async (project: string, ctx: Ctx): Promise<void> => {
    await registryInvoke("rag.index", {}, { project, signal: ctx.signal });
  },
  invoke: registryInvoke,
};

export const QUOTE_KINDS: FindingKind[] = ["quote-not-found", "quote-not-at-anchor"];

export type BenchInput = {
  set?: string;
  behaviors: string[];
  configs: RagChoice[];
  runs: number;
  model?: string;
  effort?: Effort;
  check?: boolean;
  keep?: boolean;
};
export type BenchRow = {
  config: string;
  behavior: string;
  run: number;
  ok: boolean;
  agenticRecall: number | null;
  consulted: number | null;
  tests: number;
  findings: { errors: number; warnings: number };
  quoteErrors: number;
  costUsd?: number;
  durationMs: number;
  runId?: string;
  error?: string;
};
export type BenchSummary = {
  config: string;
  runs: number;
  failed: number;
  agenticRecall: number | null;
  tests: number;
  errors: number;
  quoteErrors: number;
  costUsd: number;
  durationMs: number;
};
export type BenchReport = {
  report: string;
  provisional: boolean;
  notes: string[];
  summary: BenchSummary[];
  rows: BenchRow[];
};

export function configLabel(c: RagChoice): string {
  return "pack" in c ? `pack:${c.pack}` : `${c.embedding}+${c.reranker ?? "none"}`;
}

export function agenticRecall(must: string[], consulted: Item[]): number {
  return must.filter((m) => consulted.some((i) => itemMatches(i, m))).length / must.length;
}

type GenOut = {
  runId: string;
  generation?: string;
  ok: boolean;
  tests: string[];
  costUsd?: number;
  durationMs: number;
};

function resolver(project: string): (ref: string) => Item {
  return withIndex(
    project,
    (ref: string): Item => ({ ref, chunks: [] }),
    (db) => chunkResolver(allChunks(db)),
  );
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);

export async function runBench(project: string, ctx: Ctx, input: BenchInput): Promise<BenchReport> {
  const set = readBehaviors(resolve(project, input.set ?? defaultSet(project)));
  const unknown = input.behaviors.filter((id) => !set.behaviors.some((b) => b.id === id));
  if (unknown.length)
    throw new UserError(`Unknown behavior ${unknown.join(", ")} in ${set.file}.`, "Give ids from the behavior set.");
  const behaviors = input.behaviors.map((id) => set.behaviors.find((b) => b.id === id) as (typeof set.behaviors)[0]);
  const total = input.configs.length * behaviors.length * input.runs;
  const rows: BenchRow[] = [];
  const notes: string[] = [];
  let before: ActiveChoice | null | undefined;
  try {
    before = benchHooks.current(project);
  } catch {
    before = undefined;
  }
  await scope(async (s) => {
    s.defer(() => {
      if (before !== undefined) benchHooks.activate(project, before);
    });
    for (const config of input.configs) {
      const label = configLabel(config);
      ctx.progress({ message: `Activating ${label}`, done: rows.length, total });
      benchHooks.activate(project, config);
      await benchHooks.prepare(project, ctx);
      const resolveRef = resolver(project);
      for (const b of behaviors)
        for (let run = 1; run <= input.runs; run++) {
          if (ctx.signal.aborted) throw new CancelledError("Benchmark cancelled.");
          ctx.progress({ message: `${label} · ${b.id} · run ${run}`, done: rows.length, total });
          const t0 = Date.now();
          let r: GenOut;
          try {
            r = (await benchHooks.invoke(
              "gen.tests",
              {
                request: b.question,
                ...(input.model ? { model: input.model } : {}),
                ...(input.effort ? { effort: input.effort } : {}),
                check: input.check ?? true,
              },
              { project, signal: ctx.signal },
            )) as GenOut;
          } catch (e) {
            rows.push({
              config: label,
              behavior: b.id,
              run,
              ok: false,
              agenticRecall: null,
              consulted: null,
              tests: 0,
              findings: { errors: 0, warnings: 0 },
              quoteErrors: 0,
              durationMs: Date.now() - t0,
              error: e instanceof Error ? e.message : String(e),
            });
            continue;
          }
          const consulted = readLedger(project, r.generation)?.consulted ?? null;
          const must = b.evidence.filter((e) => e.must).map((e) => e.ref);
          const findings = r.tests.flatMap((id) => readCheck(project, id)?.findings ?? []);
          rows.push({
            config: label,
            behavior: b.id,
            run,
            ok: r.ok,
            agenticRecall: consulted ? agenticRecall(must, consulted.map(resolveRef)) : null,
            consulted: consulted?.length ?? null,
            tests: r.tests.length,
            findings: {
              errors: findings.filter((f) => f.severity === "error").length,
              warnings: findings.filter((f) => f.severity === "warning").length,
            },
            quoteErrors: findings.filter((f) => QUOTE_KINDS.includes(f.kind)).length,
            ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
            durationMs: r.durationMs,
            runId: r.runId,
          });
          if (!input.keep && r.tests.length)
            try {
              await benchHooks.invoke("claude.revert", { runId: r.runId, force: true }, { project });
            } catch (e) {
              notes.push(`Could not remove the tests of ${r.runId}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }
  });
  if (rows.some((r) => r.ok && r.agenticRecall === null))
    notes.push(
      "The evidence ledger (.testimus/gen/<job>.json) has no consulted list: agentic recall is not measured (null).",
    );
  const provisional = set.behaviors.some((b) => b.validated === false);
  if (provisional) notes.push("Provisional: the behavior set is not validated by the testers.");
  const summary = input.configs.map((c): BenchSummary => {
    const of = rows.filter((r) => r.config === configLabel(c));
    const recalls = of.map((r) => r.agenticRecall).filter((x): x is number => x !== null);
    return {
      config: configLabel(c),
      runs: of.length,
      failed: of.filter((r) => !r.ok).length,
      agenticRecall: recalls.length ? mean(recalls) : null,
      tests: mean(of.map((r) => r.tests)),
      errors: mean(of.map((r) => r.findings.errors)),
      quoteErrors: mean(of.map((r) => r.quoteErrors)),
      costUsd: of.reduce((a, r) => a + (r.costUsd ?? 0), 0),
      durationMs: mean(of.map((r) => r.durationMs)),
    };
  });
  const stamp = env.now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const report = join(project, ".testimus", "eval", `${stamp}-bench.json`);
  const out: BenchReport = { report, provisional, notes, summary, rows };
  writeJson(report, {
    version: 2,
    kind: "bench",
    config: {
      set: { file: set.file, hash: set.hash, validated: !provisional },
      behaviors: input.behaviors,
      configs: input.configs,
      runs: input.runs,
      model: input.model ?? null,
      effort: input.effort ?? null,
      check: input.check ?? true,
      app: APP_VERSION,
    },
    ...out,
  });
  return out;
}
