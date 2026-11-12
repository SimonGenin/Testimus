import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { agentsSetting } from "../lib/agents.ts";
import { fileMtime, unchangedSince } from "../lib/atomic.ts";
import { readProject } from "../lib/project.ts";
import type { Effort } from "../types.ts";
import {
  asPlan,
  type Overlap,
  overlaps,
  type PlannedTest,
  type PlanQuestion,
  parsePlan,
  replanText,
  type Settled,
  settleAnswers,
  type TestPlan,
  writeCost,
} from "./gen-plan.ts";
import { type GenInput, genPrompt, scopeDocs, scopeIndex } from "./gen-prompt.ts";
import { dedupeSkipped, inCategoryOrder, PLAN_TAG } from "./gen-reply.ts";
import type { GenResult } from "./generate.ts";
import { given } from "./given.ts";
import { type GenLedger, ledgerOf, ledgerPath, readLedger, writeLedger } from "./ledger.ts";
import { askAgainLines } from "./parts.ts";

import { newRunId, type RunResult, runClaude } from "./run.ts";

export { prompts } from "./gen-prompt.ts";

// ponytail: the two times of a generation (decision 4 of WORKLOAD.md) — gen.tests { review } ends its job with the plan
// in the ledger, state planned; the user answers its questions and edits it on Generate (gen.planSet), asks Claude to
// revise it (gen.plan, its own session resumed) as many times as wanted, or the chat proposes one (gen.planPropose);
// gen.write then writes it, every run given the questions settled

const result = (
  by: string,
  runId: string,
  plan: TestPlan,
  run: Pick<RunResult, "summary" | "costUsd" | "tokens" | "durationMs" | "diagnosis"> & { ok: boolean },
  consulted: number,
): GenResult => ({
  runId,
  ok: run.ok,
  summary: run.summary,
  tests: [],
  checks: [],
  changed: [],
  discarded: [],
  skipped: plan.skipped,
  reportFound: true,
  consulted,
  planned: 0,
  generation: by,
  remaining: plan.tests.filter((t) => !t.off).length,
  ...(run.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
  ...(run.tokens ? { tokens: run.tokens } : {}),
  durationMs: run.durationMs,
  ...(run.diagnosis ? { diagnosis: run.diagnosis } : {}),
  state: "planned",
});

const themesOf = (plan: TestPlan) => new Set(plan.tests.map((t) => t.theme ?? "")).size;

function planLine(plan: TestPlan): string {
  const n = plan.tests.length;
  const q = plan.questions.length;
  return `Plan: ${n} test${n === 1 ? "" : "s"} in ${themesOf(plan)} theme${themesOf(plan) === 1 ? "" : "s"}${q ? `, ${q} question${q === 1 ? "" : "s"} to settle` : ""} — waiting for your go (gen.write).`;
}

export function stopAtPlan(
  project: string,
  ctx: Ctx,
  o: { by: string; runId: string; input: GenInput; first: RunResult; plan: TestPlan },
): GenResult {
  const ledger = ledgerOf(project, o.first.calls);
  const plan = { ...o.plan, skipped: inCategoryOrder(dedupeSkipped(o.plan.skipped)) };
  writeLedger(project, o.by, {
    at: env.now().toISOString(),
    input: o.input,
    runId: o.runId,
    tests: [],
    consulted: ledger.consulted,
    searched: ledger.searched,
    plan,
    done: [],
    state: "planned",
    ...(o.first.sessionId ? { session: o.first.sessionId } : {}),
    skipped: plan.skipped,
  });
  ctx.log("info", planLine(plan));
  ctx.progress({ message: "Plan ready", done: 1, total: 1 });
  return result(o.by, o.runId, plan, { ...o.first, ok: true }, ledger.consulted.length);
}

type Planned = GenLedger & { jobId: string; plan: TestPlan; input: GenInput };

export function plannedLedger(project: string, generation: string): Planned {
  const l = readLedger(project, generation);
  if (!l?.input || !l.plan)
    throw new UserError(
      `No plan under ${generation}.`,
      "A plan comes from gen.tests with review: its result names the generation.",
    );
  if (l.state !== "planned")
    throw new UserError(
      `The plan of ${generation} is already being written or written.`,
      "Ask for changes on its tests (gen.revise), or start a new request.",
      "not-planned",
    );
  return l as Planned;
}

// ponytail: a question asked again after the user answered it is not asked again
const stillOpen = (qs: PlanQuestion[], settled: Settled[]) => {
  const known = new Set(settled.map((s) => s.text.toLowerCase()));
  return qs.filter((q) => !known.has(q.text.toLowerCase()));
};

export async function revisePlan(
  project: string,
  ctx: Ctx,
  o: { generation: string; answers?: Record<string, string>; request?: string; model?: string; effort?: Effort },
): Promise<GenResult> {
  const l = plannedLedger(project, o.generation);
  const p = readProject(project);
  const who = {
    model: o.model || l.input.model || p.claude.model,
    effort: o.effort || l.input.effort || p.claude.effort,
  };
  const { settled } = settleAnswers(l.plan.questions, l.settled ?? [], o.answers ?? {});
  const kept: Planned = { ...l, settled };
  writeLedger(project, o.generation, { ...kept, jobId: undefined });
  const g = given(project, "generate", { kind: "project", docs: scopeDocs(l.input) }, l.input);
  ctx.steps?.([{ id: "plan", label: "Revise the plan" }]);
  ctx.step?.("plan");
  ctx.progress({ message: "Claude revises the plan" });
  const first = l.session ? undefined : genPrompt(project, { ...l.input, review: true }, g.lines);
  const runId = newRunId();
  const run = await runClaude({
    project,
    runId,
    label: "plan",
    title: "revise the plan",
    prompt: replanText({ settled, plan: l.plan, request: o.request ?? "", first }),
    ...who,
    kind: "generate",
    scope: { kind: "project" },
    given: g,
    ...(l.session ? { resume: l.session } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  let plan = run.ok ? parsePlan(run.summary) : null;
  if (run.ok && !plan?.found && run.sessionId && !ctx.signal.aborted) {
    ctx.log("warn", `The ${PLAN_TAG} block of the revised plan could not be read: Claude is asked again.`);
    const again = await runClaude({
      project,
      label: "plan: block",
      prompt: askAgainLines(PLAN_TAG, plan?.errors ?? []),
      ...who,
      kind: "generate",
      resume: run.sessionId,
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    if (again.ok) plan = parsePlan(again.summary);
  }
  const ledger = ledgerOf(project, run.calls);
  const consulted = [...new Set([...l.consulted, ...ledger.consulted])];
  if (!plan?.found) {
    const why = run.ok ? `its plan could not be read (${(plan?.errors ?? []).slice(0, 3).join("; ")})` : run.summary;
    ctx.log("error", `The plan was not revised: ${why}. The answers are kept; the plan stays as it was.`);
    return result(o.generation, runId, l.plan, { ...run, ok: false }, consulted.length);
  }
  const next: TestPlan = {
    ...plan,
    questions: stillOpen(plan.questions, settled),
    skipped: inCategoryOrder(dedupeSkipped(plan.skipped)),
  };
  writeLedger(project, o.generation, {
    ...kept,
    jobId: undefined,
    plan: next,
    consulted,
    searched: [...l.searched, ...ledger.searched],
    skipped: next.skipped,
    ...(run.sessionId ? { session: run.sessionId } : {}),
  });
  ctx.log("info", planLine(next));
  return result(o.generation, runId, next, run, consulted.length);
}

const ledgerFile = (project: string, generation: string) => join(project, ...ledgerPath(generation).split("/"));

export const ledgerMtime = (project: string, generation: string): number => fileMtime(ledgerFile(project, generation));

// ponytail: the plan as the page or an applied proposal leaves it — its tests (renamed, merged, unticked, moved to
// another theme) and, when given, its questions; what it left out stays
export function setPlan(
  project: string,
  generation: string,
  given: { tests: PlannedTest[]; questions?: PlanQuestion[] },
  ifMtime?: number,
): TestPlan {
  const l = plannedLedger(project, generation);
  unchangedSince(ledgerFile(project, generation), ifMtime, `The plan of ${generation}`);
  const read = asPlan({ tests: given.tests, questions: given.questions ?? l.plan.questions });
  if (!read?.tests.length)
    throw new UserError("A plan needs one test at least.", "Untick a test instead of removing them all.");
  const plan: TestPlan = { ...read, skipped: l.plan.skipped };
  writeLedger(project, generation, { ...l, jobId: undefined, plan });
  return plan;
}

// ponytail: what gen.write starts from — the answers settled, the unticked tests gone (the indexes of done are the
// plan's as it is written); the state stays planned until the writing records its first ledger
export function settleForWriting(project: string, generation: string, answers: Record<string, string> = {}): void {
  const l = plannedLedger(project, generation);
  const { questions, settled } = settleAnswers(l.plan.questions, l.settled ?? [], answers);
  const tests = l.plan.tests.filter((t) => !t.off);
  if (!tests.length) throw new UserError("Every test of the plan is unticked.", "Tick the tests to write.");
  writeLedger(project, generation, {
    ...l,
    jobId: undefined,
    plan: { ...l.plan, tests, questions },
    settled,
    done: [],
  });
}

// ponytail: a rough figure for « Reindex first (≈ N s) » — the documents' text over what an index run reads a second
// on an ordinary PC, and the start of the run
const INDEX_CHARS_PER_SECOND = 6000;
const INDEX_START_SECONDS = 5;

export function reindexSeconds(project: string, docs: string[]): number {
  if (!docs.length) return 0;
  let chars = 0;
  for (const d of docs) {
    const f = join(project, "docs", d, "doc.md");
    if (existsSync(f)) chars += statSync(f).size;
  }
  return INDEX_START_SECONDS + Math.ceil(chars / INDEX_CHARS_PER_SECOND);
}

export type PlanView = {
  state?: "planned";
  plan?: Pick<TestPlan, "tests" | "questions">;
  settled: Settled[];
  overlaps: Overlap[];
  cost?: { runs: number; seconds: number; agents: number };
  stale: string[];
  reindexSeconds: number;
  mtime: number;
};

// ponytail: what Generate shows of a plan — said by the core, without a model
export function planView(project: string, l: GenLedger & { jobId?: string }): PlanView {
  const agents = agentsSetting().max;
  const active = l.plan ? l.plan.tests.filter((t) => !t.off).length : 0;
  const stale = l.input && l.state === "planned" ? scopeIndex(project, l.input).stale : [];
  return {
    ...(l.state ? { state: l.state } : {}),
    ...(l.plan ? { plan: { tests: l.plan.tests, questions: l.plan.questions } } : {}),
    settled: l.settled ?? [],
    overlaps: l.plan ? overlaps(l.plan.tests) : [],
    ...(l.plan ? { cost: { ...writeCost(active, agents), agents } } : {}),
    stale,
    reindexSeconds: reindexSeconds(project, stale),
    mtime: l.jobId ? ledgerMtime(project, l.jobId) : 0,
  };
}
