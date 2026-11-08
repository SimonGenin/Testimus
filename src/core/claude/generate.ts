import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { agentPool, agentsSetting, loadLine } from "../lib/agents.ts";
import { loadCorpus, runMechanical } from "../lib/check.ts";
import { fieldOrder } from "../lib/columns.ts";
import { quoted, testName } from "../lib/names.ts";
import { readProject } from "../lib/project.ts";
import {
  holdNewTests,
  listLocalTests,
  markGenerated,
  readTest,
  removeTest,
  testExists,
  writeTest,
} from "../lib/store.ts";
import { awaitsReview, type ClaudeEvent, type Diagnosis, type Tokens } from "../types.ts";
import { checkTests } from "./check.ts";
import { proposeGenActions } from "./gen-actions.ts";
import { genBoard, type Lane } from "./gen-board.ts";
import { checkGenInput, type GenInput, genPrompt, indexGate, plannedInput } from "./gen-prompt.ts";
import { type GenReport, parseGenReport, parsePlan, type Skipped, STOPPED, type TestPlan } from "./gen-reply.ts";
import { ledgerOf, readLedger, type Searched, writeLedger } from "./ledger.ts";
import { newRunId, type RunResult, runClaude } from "./run.ts";
import { absorbRun, markLeft, readRun } from "./snapshot.ts";

export { prompts } from "./gen-prompt.ts";

export type GenCheck = { id: string; ok: boolean; review: string; errors: number; warnings: number };

export type GenResult = {
  runId: string;
  ok: boolean;
  summary: string;
  tests: string[];
  checks: GenCheck[];
  changed: string[];
  discarded: string[];
  skipped: Skipped[];
  reportFound: boolean;
  consulted: number;
  planned: number;
  generation: string;
  remaining: number;
  costUsd?: number;
  tokens?: Tokens;
  durationMs: number;
  diagnosis?: Diagnosis;
};

export type ToolStep = { kind: "read" } | { kind: "write"; testId: string } | null;

const TEST_PATH = /tests[\\/]+(local-[0-9a-f]{8})[\\/]+test\.md/i;

export function toolStep(e: ClaudeEvent): ToolStep {
  if (e.type !== "tool") return null;
  if (/(^|_)rag_(search|passage|figure|mentions|related)$/.test(e.name)) return { kind: "read" };
  if (/^(Write|Edit|MultiEdit)$/.test(e.name)) {
    const id = e.input.match(TEST_PATH)?.[1];
    return id ? { kind: "write", testId: id.toLowerCase() } : null;
  }
  if (/(^|_)tests_(save|edit)$/.test(e.name)) {
    const id = e.input.match(/"id"\s*:\s*"(local-[0-9a-f]{8})"/i)?.[1];
    return id ? { kind: "write", testId: id.toLowerCase() } : null;
  }
  if ((e.name === "Read" || e.name === "Grep") && /docs[\\/]+[^\\/]+[\\/]+doc\.md/.test(e.input))
    return { kind: "read" };
  return null;
}

export function stampTest(project: string, id: string, generatedBy: string, folder?: string): void {
  const { test } = readTest(project, id);
  const jira = readProject(project).jiraProject;
  const want = {
    ...test,
    generatedBy,
    review: "draft" as const,
    project: test.project || jira,
    folder: folder && (!test.folder || test.folder === "/") ? folder : test.folder || "/",
  };
  if (
    want.generatedBy === test.generatedBy &&
    test.review === "draft" &&
    want.project === test.project &&
    want.folder === test.folder
  )
    return;
  writeTest(project, id, want, fieldOrder(project));
}

// ponytail: what a new generation replaces — Claude's tests still waiting in review, never the ones pushed to Jira
export const discardable = (project: string) =>
  listLocalTests(project)
    .filter((t) => awaitsReview(t) && !t.key)
    .map((t) => t.id);

type GenRun = { run: RunResult; tests: string[]; changed: string[]; report: GenReport };

async function genRun(
  ctx: Ctx,
  project: string,
  input: GenInput,
  o: { runId: string; by: string; contexts: string[]; prompt: string; label: string; title?: string; lane: Lane },
): Promise<GenRun> {
  const p = readProject(project);
  let reads = 0;
  const written: string[] = [];
  const texts: string[] = [];
  const run = await runClaude({
    project,
    runId: o.runId,
    label: o.label,
    ...(o.title ? { title: o.title } : {}),
    prompt: o.prompt,
    model: input.model || p.claude.model,
    effort: input.effort || p.claude.effort,
    kind: "generate",
    scope: { kind: "project" },
    contexts: o.contexts,
    signal: ctx.signal,
    onEvent: (e) => {
      ctx.claude(e);
      if (e.type === "text") texts.push(e.text);
      const s = toolStep(e);
      if (s?.kind === "read") ctx.progress({ message: `Reading passages (${++reads})` });
      if (s?.kind === "write") {
        const fresh = !written.includes(s.testId);
        if (fresh) written.push(s.testId);
        if (o.lane.wrote(s.testId) || fresh) ctx.progress({ message: `Writing ${s.testId} (${written.length})` });
      }
    },
  });
  o.lane.end();
  const before = readRun(project, run.runId).before;
  // ponytail: a test is this generation's only when it did not exist before the run, a call of this run
  // wrote it, and no other generation stamped it — a test made by hand meanwhile is never claimed
  const tests = run.changedTests.filter(
    (id) =>
      before[id] === null &&
      run.written.includes(id) &&
      testExists(project, id) &&
      [undefined, "", o.by].includes(readTest(project, id).test.generatedBy),
  );
  const changed = run.changedTests.filter((id) => before[id] !== null && run.written.includes(id));
  const report = parseGenReport(run.summary);
  return { run, tests, changed, report: report.found ? report : parseGenReport(texts.join("")) };
}

const union = (xs: string[][]) => [...new Set(xs.flat())];

type Prior = {
  input: GenInput;
  runId: string;
  tests: string[];
  consulted: string[];
  searched: Searched[];
  plan: TestPlan;
  done: number[];
};

function readPrior(project: string, generation: string): Prior {
  const l = readLedger(project, generation);
  if (!l?.input || !l.runId || !l.plan?.tests?.length)
    throw new UserError(
      `No plan to resume under ${generation}.`,
      "Only a generation written from a plan can be resumed: its result names it (generation).",
    );
  return {
    input: l.input,
    runId: l.runId,
    tests: l.tests ?? [],
    consulted: l.consulted ?? [],
    searched: l.searched ?? [],
    plan: l.plan,
    done: l.done ?? [],
  };
}

// ponytail: into = an earlier generation this run adds to (gen.revise): its tests are stamped with that generation,
// its ledger keeps what the generation asked first and gains the new tests
export async function generateTests(project: string, asked: GenInput, ctx: Ctx, into?: string): Promise<GenResult> {
  const release = holdNewTests(project);
  try {
    return await generate(project, asked, ctx, into);
  } finally {
    release();
  }
}

async function generate(project: string, asked: GenInput, outer: Ctx, into?: string): Promise<GenResult> {
  let said = "";
  const board = genBoard((gen) => outer.progress({ message: said, gen }));
  const ctx: Ctx = {
    ...outer,
    progress: (p) => {
      said = p.message;
      const gen = board.tests();
      outer.progress({ ...p, ...(gen.length ? { gen } : {}) });
    },
  };
  const prior = asked.resume?.trim() ? readPrior(project, asked.resume.trim()) : null;
  const base = into ? readLedger(project, into) : null;
  const input = prior
    ? { ...prior.input, model: asked.model || prior.input.model, effort: asked.effort || prior.input.effort }
    : asked;
  if (!prior) checkGenInput(input, project);
  const stale = indexGate(project, input);
  if (stale.length)
    ctx.log(
      "warn",
      `Index not up to date for ${stale.join(", ")}: what changed since the last index is not searched. Reindex to include it.`,
    );
  const p = readProject(project);
  const discarded = input.discard && !prior ? discardable(project) : [];
  for (const id of discarded) removeTest(project, id);
  if (discarded.length)
    ctx.log("info", `Deleted ${discarded.length} test(s) not validated yet: ${discarded.join(", ")}.`);
  const contexts = input.contexts ?? p.claude.contexts;
  ctx.steps?.([
    ...(prior ? [] : [{ id: "read", label: "Read the sources" }]),
    { id: "write", label: "Write the tests" },
    ...(input.check !== false ? [{ id: "check", label: "Check the new tests" }] : []),
  ]);
  if (!prior) ctx.step?.("read");
  ctx.progress({ message: "Reading passages" });
  const runId = prior?.runId ?? newRunId();
  const by = into || asked.resume?.trim() || ctx.jobId || runId;
  const first = prior
    ? null
    : await genRun(ctx, project, input, {
        runId,
        by,
        contexts,
        prompt: genPrompt(project, input, contexts, runId),
        label: "generate",
        title: "read and write",
        lane: board.run(),
      });
  const plan = prior?.plan ?? (first && !first.tests.length && first.run.ok ? parsePlan(first.run.summary) : null);
  const of = plan?.found ? plan.tests.length : 0;
  const done = new Set(prior?.done ?? []);
  const todo = plan?.found ? plan.tests.map((t, k) => ({ t, k })).filter(({ k }) => !done.has(k)) : [];
  const slots = board.plan(todo.map(({ t }) => t.summary));
  if (todo.length) ctx.step?.("write");
  if (prior) ctx.log("info", `Resuming the plan: ${todo.length} of ${of} test(s) left.`);
  const set = agentsSetting();
  if (todo.length && !prior)
    ctx.log(
      "info",
      `Plan: ${of} test(s), one run each, ${set.adaptive ? `up to ${set.max} at a time as the PC allows` : `${set.max} at a time`}.`,
    );
  const pool = agentPool({
    onLimit: (n, load) => ctx.log("info", `Agents: ${n} at a time (${loadLine(load)}).`),
  });
  let finished = 0;
  let stop = false;
  // ponytail: a failed run stops the runs not started yet (a credit or login failure would fail them all); a planned
  // test counts as written once its run wrote a test, so a resume never writes it twice
  const parts = await Promise.all(
    todo.map(({ t, k }, n) =>
      pool.run(async () => {
        if (stop || ctx.signal.aborted) return null;
        ctx.progress({
          message: `Test ${k + 1} of ${of}: ${t.summary} (${pool.active()} running)`,
          done: finished,
          total: todo.length,
        });
        const id = newRunId();
        const part = plannedInput(input, t);
        const r = await genRun(ctx, project, part, {
          runId: id,
          by,
          contexts,
          prompt: genPrompt(project, part, contexts, id, { n: k + 1, of, request: input.request.trim() }),
          label: `generate ${k + 1}/${of}`,
          title: t.summary,
          lane: board.start(slots[n]),
        });
        absorbRun(project, runId, id);
        finished++;
        if (r.run.ok || r.tests.length) done.add(k);
        if (!r.run.ok) stop = true;
        return r;
      }),
    ),
  );
  const planned = parts.filter((r): r is GenRun => !!r);
  const runs = first ? [first, ...planned] : planned;
  const left = plan?.found ? plan.tests.filter((_, k) => !done.has(k)) : [];
  const tests = union(runs.map((r) => r.tests));
  const changed = union(runs.map((r) => r.changed));
  // ponytail: the evidence ledger is on disk before the new tests are checked, so their first check already
  // knows what the generation opened; the full report replaces it below
  const ledger = ledgerOf(
    project,
    runs.flatMap((r) => r.run.calls),
  );
  const consulted = union([prior?.consulted ?? [], base?.consulted ?? [], ledger.consulted]);
  const searched = [...(prior?.searched ?? []), ...(base?.searched ?? []), ...ledger.searched];
  const asked0 = base?.input ?? input;
  const at = base?.at ?? env.now().toISOString();
  const kept = {
    tests: union([prior?.tests ?? [], base?.tests ?? [], tests]),
    consulted,
    searched,
    ...(plan?.found ? { plan, done: [...done].sort((a, b) => a - b) } : {}),
  };
  writeLedger(project, by, { at, input: asked0, runId, ...kept });
  for (const id of tests) stampTest(project, id, by, input.folder?.trim() || undefined);
  const checks: GenCheck[] = [];
  if (tests.length && input.check !== false && !ctx.signal.aborted) {
    ctx.step?.("check");
    ctx.progress({ message: `Checking ${tests.length} new test(s)` });
    for (const r of await checkTests(ctx, project, tests, true)) {
      const n = (s: string) => r.check.findings.filter((f) => f.severity === s).length;
      checks.push({
        id: r.id,
        ok: r.ok,
        review: r.review,
        errors: n("error"),
        warnings: n("warning"),
      });
    }
  } else if (tests.length) {
    const corpus = loadCorpus(project);
    for (const id of tests) runMechanical(project, id, corpus);
  }
  markLeft(project, runId, tests);
  for (const id of tests) markGenerated(project, id);
  for (const id of changed)
    ctx.log("warn", `The generation changed the existing test ${quoted(testName(project, id))} — Revert puts it back.`);
  const reports = planned.length || !first ? planned.map((r) => r.report) : [first.report];
  const reportFound = reports.every((r) => r.found);
  const failed = runs.find((r) => !r.run.ok)?.run;
  if (!reportFound && !failed) ctx.log("warn", "The generation reply has no gen-report block: skipped items unknown.");
  if (failed) ctx.log("error", failed.summary);
  if (left.length)
    ctx.log("warn", `${left.length} planned test(s) not written — resume with gen.tests --resume ${by}.`);
  const why = `not written: the generation ${ctx.signal.aborted ? "was cancelled" : "stopped on a failed run"} — resume it`;
  const sum = (f: (r: RunResult) => number | undefined) =>
    runs.some((r) => f(r.run) !== undefined) ? runs.reduce((a, r) => a + (f(r.run) ?? 0), 0) : undefined;
  const tokensIn = sum((r) => r.tokens?.input);
  const output = sum((r) => r.tokens?.output);
  const costUsd = sum((r) => r.costUsd);
  const diagnosis = failed?.diagnosis;
  const result: GenResult = {
    runId,
    ok: !failed,
    summary:
      planned.length || !first
        ? [`Plan: ${of} test(s).`, ...planned.map((r) => r.run.summary)].join("\n\n")
        : first.run.summary,
    tests,
    checks,
    changed,
    discarded,
    skipped: [
      ...(first ? (plan?.skipped ?? []) : []),
      ...reports.flatMap((r) => r.skipped),
      ...left.map((t) => ({ item: t.summary, category: STOPPED, why })),
    ],
    reportFound,
    consulted: consulted.length,
    planned: planned.length,
    generation: by,
    remaining: left.length,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(tokensIn !== undefined && output !== undefined ? { tokens: { input: tokensIn, output } } : {}),
    durationMs: runs.reduce((a, r) => a + r.run.durationMs, 0),
    ...(diagnosis ? { diagnosis } : {}),
  };
  writeLedger(project, by, {
    at,
    input: asked0,
    ...result,
    ...kept,
    reportedConsulted: union(reports.map((r) => r.consulted)),
  });
  proposeGenActions(
    project,
    by,
    {
      tests,
      skipped: result.skipped,
      by: { runId, model: input.model || p.claude.model, effort: input.effort || p.claude.effort },
    },
    ctx.log,
  );
  ctx.progress({ message: `${tests.length} test(s) written`, done: tests.length, total: tests.length });
  return result;
}
