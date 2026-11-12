import { resolve } from "node:path";
import { perKey } from "../../shared/run/work.ts";
import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { agentPool, agentsSetting, loadLine } from "../lib/agents.ts";
import { type Corpus, loadCorpus, runMechanical } from "../lib/check.ts";
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
import { isSkeleton } from "../lib/testfile.ts";
import { awaitsReview, type ClaudeEvent, type Diagnosis, type GenTestProgress, type Tokens } from "../types.ts";
import { checkTests } from "./check.ts";
import { addPart, mergeSkipped, readPrior } from "./gen-again.ts";
import { genBoard, type Lane } from "./gen-board.ts";
import { parsePlan, type TestPlan, themeFolder } from "./gen-plan.ts";
import {
  checkGenInput,
  type GenInput,
  genPrompt,
  indexGate,
  type PlanSibling,
  plannedInput,
  scopeDocs,
} from "./gen-prompt.ts";
import { stopAtPlan } from "./gen-replan.ts";
import {
  dedupeSkipped,
  type GenReport,
  inCategoryOrder,
  PLAN_TAG,
  parseGenReport,
  REPORT_TAG,
  type Skipped,
  STOPPED,
  skipDoubts,
} from "./gen-reply.ts";
import { applyReview, hasReview, proposeWritable, reviewPart } from "./gen-review.ts";
import { type Given, given } from "./given.ts";
import { type Ledger, ledgerOf, readLedger, writeLedger } from "./ledger.ts";
import { askAgainLines } from "./parts.ts";
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
  /** why the report of a run could not be read, when it could not: the items left without a test are then unknown */
  reportErrors?: string[];
  consulted: number;
  planned: number;
  generation: string;
  remaining: number;
  costUsd?: number;
  tokens?: Tokens;
  durationMs: number;
  diagnosis?: Diagnosis;
  /** planned: the job ended with the plan (review), nothing written — gen.write writes it */
  state?: "planned";
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

// ponytail: a test written for a planned test with a theme goes to <folder>/<theme> whatever folder its run wrote —
// it is its local folder, the Xray path is decided at the push; any other test keeps its own, else the folder asked
export function stampTest(project: string, id: string, generatedBy: string, folder?: string, theme?: string): void {
  const { test } = readTest(project, id);
  const jira = readProject(project).jiraProject;
  const want = {
    ...test,
    generatedBy,
    review: "draft" as const,
    project: test.project || jira,
    folder: theme
      ? themeFolder(folder, theme)
      : folder && (!test.folder || test.folder === "/")
        ? folder
        : test.folder || "/",
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

type GenRun = {
  run: RunResult;
  tests: string[];
  changed: string[];
  report: GenReport;
  plan: TestPlan | null;
  /** the tests it created and left as tests.create made them: removed, never counted written */
  skeletons: string[];
};

// ponytail: a run that threw is a failed run like any other — it stops the runs not started yet, and everything after
// the writing (the items left out, the ledger, the check) is still done for the others
export function thrownRun(runId: string, e: unknown): GenRun {
  const summary = `The run stopped on an error: ${e instanceof Error ? e.message : String(e)}`;
  return {
    run: {
      runId,
      ok: false,
      summary,
      durationMs: 0,
      changedTests: [],
      changedSteps: {},
      written: [],
      calls: [],
      raw: summary,
    },
    tests: [],
    changed: [],
    report: { found: false, tests: [], skipped: [], covered: [], errors: [summary] },
    plan: null,
    skeletons: [],
  };
}

// ponytail: what a reply's block could not give — absent, or there and refused, field by field
export const refusedLine = (label: string, tag: string, errors: string[]): string =>
  !errors.length || errors[0].startsWith("no ")
    ? `The reply of ${label} has no ${tag} block: Claude is asked for it again.`
    : `The ${tag} block of ${label} was refused (${errors.slice(0, 3).join("; ")}): Claude is asked again.`;

async function genRun(
  ctx: Ctx,
  project: string,
  input: GenInput,
  o: {
    runId: string;
    by: string;
    given: Given;
    prompt: string;
    label: string;
    title?: string;
    lane: Lane;
    mayPlan?: boolean;
    onWrite?: (testId: string) => void;
  },
): Promise<GenRun> {
  const p = readProject(project);
  let reads = 0;
  const written: string[] = [];
  const who = { model: input.model || p.claude.model, effort: input.effort || p.claude.effort };
  const run = await runClaude({
    project,
    runId: o.runId,
    label: o.label,
    ...(o.title ? { title: o.title } : {}),
    prompt: o.prompt,
    ...who,
    kind: "generate",
    scope: { kind: "project" },
    given: o.given,
    signal: ctx.signal,
    onEvent: (e) => {
      ctx.claude(e);
      const s = toolStep(e);
      if (s?.kind === "read") ctx.progress({ message: `Reading passages (${++reads})` });
      if (s?.kind === "write") {
        const fresh = !written.includes(s.testId);
        if (fresh) {
          written.push(s.testId);
          o.onWrite?.(s.testId);
        }
        if (o.lane.wrote(s.testId) || fresh) ctx.progress({ message: `Writing ${s.testId} (${written.length})` });
      }
    },
  });
  o.lane.end();
  const before = readRun(project, run.runId).before;
  // ponytail: a test is this generation's only when it did not exist before the run, a call of this run
  // wrote it, and no other generation stamped it — a test made by hand meanwhile is never claimed
  const made = run.changedTests.filter(
    (id) =>
      before[id] === null &&
      run.written.includes(id) &&
      testExists(project, id) &&
      [undefined, "", o.by].includes(readTest(project, id).test.generatedBy),
  );
  // ponytail: a run that ends — done, failed or cancelled — between tests.create and the writing leaves an empty
  // draft nobody asked for: it goes, and its planned test counts as not written
  const skeletons = made.filter((id) => isSkeleton(readTest(project, id).test));
  for (const id of skeletons) {
    removeTest(project, id);
    ctx.log("warn", `${o.label} left ${id} as tests.create made it: removed, the test is not written.`);
  }
  if (skeletons.length) markLeft(project, run.runId, skeletons);
  const tests = made.filter((id) => !skeletons.includes(id));
  const changed = run.changedTests.filter((id) => before[id] !== null && run.written.includes(id));
  // ponytail: a run that wrote no test may answer with a plan; anything else answers with its report. A reply that
  // carries neither, or one that cannot be read, is asked again once, in the same session, for that block alone — a
  // behavior left without a test is never lost with a report nobody could read
  const read = (text: string) => {
    const plan = o.mayPlan && !tests.length ? parsePlan(text) : null;
    return { plan: plan?.found ? plan : null, report: parseGenReport(text), planErrors: plan?.errors ?? [] };
  };
  let got = read(run.summary);
  if (run.ok && !got.plan && !got.report.found && run.sessionId && !ctx.signal.aborted) {
    const planned = o.mayPlan && !tests.length && got.planErrors.length && !got.planErrors[0].startsWith("no ");
    const tag = planned ? PLAN_TAG : REPORT_TAG;
    const errors = planned ? got.planErrors : got.report.errors;
    ctx.log("warn", refusedLine(o.label, tag, errors));
    const again = await runClaude({
      project,
      label: `${o.label}: report`,
      prompt: askAgainLines(tag, errors),
      ...who,
      kind: "generate",
      resume: run.sessionId,
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    if (again.ok) got = read(again.summary);
  }
  return { run, tests, changed, report: got.report, plan: got.plan, skeletons };
}

// ponytail: the items a generation left without a test, as one list — what it had before, what its plan and each run
// reported (the same behavior once), what a cancel stopped — each with what Testimus could not confirm about it
// what could not be checked about one item is said on it and logged; the others are checked all the same
function leftOut(
  project: string,
  before: Skipped[],
  now: Skipped[],
  covered: string[],
  written: string[],
  corpus: Corpus,
  ledger: Ledger,
  log: Ctx["log"],
): Skipped[] {
  return inCategoryOrder(
    mergeSkipped(before, dedupeSkipped(now, written), covered).map((s) => {
      if (s.reason === "stopped" || s.reason === "other") return s;
      const { doubts: _old, ...rest } = s;
      let doubts: string[];
      try {
        doubts = skipDoubts(project, s, corpus, ledger);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        log("warn", `Could not check the item left out « ${s.item} »: ${why}`);
        doubts = [`Testimus could not check it: ${why}`];
      }
      return doubts.length ? { ...rest, doubts } : rest;
    }),
  );
}

// ponytail: each part of what follows the writing is done even when one before it failed — its error is logged and the
// generation goes on to the next part
function attempt<T>(ctx: Ctx, what: string, fallback: T, f: () => T): T {
  try {
    return f();
  } catch (e) {
    ctx.log("error", `${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

const union = (xs: string[][]) => [...new Set(xs.flat())];

// ponytail: into = an earlier generation this run adds to (gen.revise): its tests are stamped with that generation,
// its ledger keeps what the generation asked first, its plan and its items not written (less those written now) and
// gains the new tests; two runs adding to the same generation go one after the other, so neither loses the other's
const adding = perKey(1);

export async function generateTests(project: string, asked: GenInput, ctx: Ctx, into?: string): Promise<GenResult> {
  const work = async () => {
    const release = holdNewTests(project);
    try {
      return await generate(project, asked, ctx, into);
    } finally {
      release();
    }
  };
  if (!into) return work();
  return adding(`${resolve(project).toLowerCase()}|${into}`, work, ctx.signal, () =>
    ctx.progress({ message: "Waiting for the other request on this generation" }),
  );
}

async function generate(project: string, asked: GenInput, outer: Ctx, into?: string): Promise<GenResult> {
  // ponytail: a progress line carries the board (gen) only when it moved since the last one that did — the page reads
  // the last line that has one
  let said = "";
  let sent = "";
  const moved = (gen: GenTestProgress[]) => {
    const now = JSON.stringify(gen);
    if (!gen.length || now === sent) return {};
    sent = now;
    return { gen };
  };
  const board = genBoard((gen) => {
    const g = moved(gen);
    if (g.gen) outer.progress({ message: said, ...g });
  });
  const ctx: Ctx = {
    ...outer,
    progress: (p) => {
      said = p.message;
      outer.progress({ ...p, ...moved(board.tests()) });
    },
  };
  const prior = asked.resume?.trim() ? readPrior(project, asked.resume.trim()) : null;
  const base = into ? readLedger(project, into) : null;
  const input = prior
    ? {
        ...prior.input,
        review: false,
        model: asked.model || prior.input.model,
        effort: asked.effort || prior.input.effort,
      }
    : asked;
  if (!prior) checkGenInput(input, project);
  const reviewing = !!input.review && !prior && !into;
  const reindex = !!asked.reindex && !!prior;
  ctx.steps?.([
    ...(reindex ? [{ id: "index", label: "Reindex the documents" }] : []),
    ...(prior ? [] : [{ id: "read", label: reviewing ? "Read the sources and plan" : "Read the sources" }]),
    ...(reviewing ? [] : [{ id: "write", label: "Write the tests" }]),
    ...(input.check !== false && !reviewing
      ? [{ id: "check", label: "Check the new tests and what was left out" }]
      : []),
  ]);
  if (reindex && ctx.invoke) {
    ctx.step?.("index");
    ctx.progress({ message: "Reindexing the documents first" });
    await ctx.invoke("rag.index", {}, { signal: ctx.signal });
  }
  const stale = indexGate(project, input);
  if (stale.length)
    ctx.log(
      "warn",
      `Index not up to date for ${stale.join(", ")}: what changed since the last index is not searched. Reindex to include it.`,
    );
  const p = readProject(project);
  // ponytail: a reviewed plan replaces the tests awaiting review when it is written, not when it is planned
  const discarded = input.discard && (prior ? prior.planned : !input.review) ? discardable(project) : [];
  for (const id of discarded) removeTest(project, id);
  if (discarded.length)
    ctx.log("info", `Deleted ${discarded.length} test(s) not validated yet: ${discarded.join(", ")}.`);
  const g = given(project, "generate", { kind: "project", docs: scopeDocs(input) }, input);
  const add = into && base ? addPart(project, base) : undefined;
  if (!prior) ctx.step?.("read");
  ctx.progress({ message: "Reading passages" });
  const runId = prior?.runId ?? newRunId();
  const by = into || asked.resume?.trim() || ctx.jobId || runId;
  const first = prior
    ? null
    : await genRun(ctx, project, input, {
        runId,
        by,
        given: g,
        prompt: genPrompt(project, input, g.lines, undefined, add ? { add } : {}),
        label: "generate",
        title: "read and write",
        lane: board.run(),
        mayPlan: true,
      }).catch((e: unknown) => thrownRun(runId, e));
  const plan = prior?.plan ?? (first?.run.ok ? first.plan : null);
  if (reviewing && first && plan?.found)
    return stopAtPlan(project, ctx, { by, runId, input: { ...input, contexts: g.contexts }, first: first.run, plan });
  const of = plan?.found ? plan.tests.length : 0;
  const done = new Set(prior?.done ?? []);
  const todo = plan?.found ? plan.tests.map((t, k) => ({ t, k })).filter(({ k, t }) => !done.has(k) && !t.off) : [];
  const slots = board.plan(
    todo.map(({ t }) => ({ summary: t.summary, ...(t.theme ? { folder: themeFolder(input.folder, t.theme) } : {}) })),
  );
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
  // ponytail: the tests each planned run wrote, as soon as it writes them — a run that starts later is told its
  // neighbours by number and, once they have one, by id
  const made = new Map<number, string[]>();
  const others = (k: number): PlanSibling[] =>
    plan?.found
      ? plan.tests.flatMap((t, j) =>
          j === k || t.off
            ? []
            : [
                {
                  n: j + 1,
                  summary: t.summary,
                  sections: t.sections,
                  ...(t.theme ? { theme: t.theme } : {}),
                  ids: made.get(j) ?? [],
                },
              ],
        )
      : [];
  const ended = new Set<number>();
  // ponytail: a failed run stops the runs not started yet (a credit or login failure would fail them all); a planned
  // test counts as written once its run wrote a test, so a resume never writes it twice — and a run that ended
  // without one leaves it to the resume
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
        let r: GenRun;
        try {
          const part = plannedInput(input, t);
          r = await genRun(ctx, project, part, {
            runId: id,
            by,
            given: g,
            prompt: genPrompt(project, part, g.lines, {
              n: k + 1,
              of,
              request: input.request.trim(),
              others: others(k),
              settled: prior?.settled ?? [],
            }),
            label: `generate ${k + 1}/${of}`,
            title: t.summary,
            lane: board.start(slots[n]),
            onWrite: (testId) => made.set(k, [...new Set([...(made.get(k) ?? []), testId])]),
          });
          absorbRun(project, runId, id);
        } catch (e) {
          ctx.log(
            "error",
            `generate ${k + 1}/${of} (${t.summary}) stopped on an error: ${e instanceof Error ? e.message : String(e)}`,
          );
          r = thrownRun(id, e);
        }
        finished++;
        if (r.tests.length) {
          done.add(k);
          made.set(k, r.tests);
        } else if (r.run.ok) ended.add(k);
        if (!r.run.ok) stop = true;
        return r;
      }),
    ),
  );
  const planned = parts.filter((r): r is GenRun => !!r);
  const runs = first ? [first, ...planned] : planned;
  const left = plan?.found ? plan.tests.filter((t, k) => !done.has(k) && !t.off) : [];
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
  const asked0 = base?.input ?? { ...input, contexts: g.contexts };
  const at = base?.at ?? env.now().toISOString();
  const ownPlan = !base?.plan && plan?.found;
  const kept = {
    tests: union([prior?.tests ?? [], base?.tests ?? [], tests]),
    consulted,
    searched,
    ...(base?.plan ? { plan: base.plan, done: base.done ?? [] } : {}),
    ...(base?.suggestions ? { suggestions: base.suggestions } : {}),
    ...(ownPlan ? { plan, done: [...done].sort((a, b) => a - b) } : {}),
    ...(prior?.settled.length ? { settled: prior.settled } : {}),
  };
  attempt(ctx, "Writing the generation's ledger", undefined, () =>
    writeLedger(project, by, { at, input: asked0, runId, ...kept }),
  );
  const themeOf = new Map<string, string>();
  for (const [k, ids] of made) for (const id of ids) if (plan?.tests[k]?.theme) themeOf.set(id, plan.tests[k].theme);
  for (const id of tests)
    attempt(ctx, `Stamping ${id}`, undefined, () =>
      stampTest(project, id, by, input.folder?.trim() || undefined, themeOf.get(id)),
    );
  const reports = planned.length || !first ? planned.map((r) => r.report) : [first.report];
  const reportFound = reports.every((r) => r.found);
  const failed = runs.find((r) => !r.run.ok)?.run;
  const why = `not written: the generation ${ctx.signal.aborted ? "was cancelled" : "stopped on a failed run"} — resume it`;
  const whyOf = (k: number) => (ended.has(k) ? "not written: the run ended without writing its test — resume it" : why);
  const corpus = attempt(ctx, "Reading the documents for the items left out", null, () => loadCorpus(project));
  const stopped: Skipped[] = plan?.found
    ? plan.tests.flatMap((t, k) =>
        done.has(k) || t.off ? [] : [{ item: t.summary, reason: "stopped" as const, category: STOPPED, why: whyOf(k) }],
      )
    : [];
  const now = [...(first ? (plan?.skipped ?? []) : []), ...reports.flatMap((r) => r.skipped), ...stopped];
  const before = base?.skipped ?? prior?.skipped ?? [];
  const covered = reports.flatMap((r) => r.covered);
  let skipped = attempt(
    ctx,
    "The summary of the items left out",
    inCategoryOrder(mergeSkipped(before, now, covered)),
    () =>
      corpus
        ? leftOut(project, before, now, covered, kept.tests, corpus, { consulted, searched }, ctx.log)
        : inCategoryOrder(mergeSkipped(before, dedupeSkipped(now, kept.tests), covered)),
  );
  const who = { runId, model: input.model || p.claude.model, effort: input.effort || p.claude.effort };
  const checks: GenCheck[] = [];
  let suggestions = kept.suggestions;
  // ponytail: one request checks the new tests and says what is to be said of the generation — a second look at what
  // it left without a test, what to ask next. A cancelled generation is not looked at again, nor one whose failed run
  // says Claude cannot be reached (it would fail the same); a run that failed otherwise leaves the others checked
  const unreachable = !!failed?.diagnosis;
  let looked = false;
  if (input.check !== false && !ctx.signal.aborted && !unreachable && hasReview({ tests, skipped })) {
    ctx.step?.("check");
    ctx.progress({ message: `Checking ${tests.length} new test(s)` });
    try {
      // ponytail: the request said is the one just asked (an added one too), and the check is given what the
      // generation was given — the tests were written with those contexts, they are judged with them
      const review = reviewPart({ request: input.request ?? asked0.request ?? "", tests, skipped });
      const checked = await checkTests(ctx, project, tests, true, {
        also: [review.part],
        pick: { contexts: g.contexts, without: input.without },
      });
      looked = true;
      const reply = review.reply();
      if (reply && corpus) {
        skipped = applyReview(skipped, review.items, reply, corpus);
        if (reply.suggestions.length) suggestions = reply.suggestions;
      } else ctx.log("warn", "Claude gave no second look at what was left out: the reasons are the generation's own.");
      for (const r of checked) {
        const n = (s: string) => r.check.findings.filter((f) => f.severity === s).length;
        checks.push({
          id: r.id,
          ok: r.ok,
          review: r.review,
          errors: n("error"),
          warnings: n("warning"),
        });
      }
    } catch (e) {
      ctx.log("error", `The check of the new tests failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!looked)
    for (const id of tests)
      attempt(ctx, `The mechanical check of ${id}`, undefined, () => runMechanical(project, id, corpus ?? undefined));
  attempt(ctx, "Recording what the runs left", undefined, () => {
    markLeft(project, runId, tests);
    for (const id of tests) markGenerated(project, id);
  });
  for (const id of changed)
    ctx.log("warn", `The generation changed the existing test ${quoted(testName(project, id))} — Revert puts it back.`);
  const reportErrors = reports.flatMap((r) => (r.found ? [] : r.errors));
  if (!reportFound && !failed)
    ctx.log(
      "error",
      `A run's report could not be read (${reportErrors.slice(0, 3).join("; ")}): what it left without a test is not known. Ask the generation again for it.`,
    );
  if (failed) ctx.log("error", failed.summary);
  if (left.length)
    ctx.log(
      "warn",
      `${left.length} planned test(s) not written${ownPlan ? ` — resume with gen.tests --resume ${by}` : ""}.`,
    );
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
    skipped,
    reportFound,
    ...(reportErrors.length ? { reportErrors } : {}),
    consulted: consulted.length,
    planned: planned.length,
    generation: by,
    remaining: left.length,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(tokensIn !== undefined && output !== undefined ? { tokens: { input: tokensIn, output } } : {}),
    durationMs: runs.reduce((a, r) => a + r.run.durationMs, 0),
    ...(diagnosis ? { diagnosis } : {}),
  };
  attempt(ctx, "Writing the generation's ledger", undefined, () =>
    writeLedger(project, by, {
      at,
      input: asked0,
      ...result,
      ...kept,
      ...(suggestions ? { suggestions } : {}),
    }),
  );
  const proposed = attempt(ctx, "Proposing the items left out that can be written", 0, () =>
    proposeWritable(project, by, skipped, who, ctx.log),
  );
  if (proposed) ctx.log("info", `${proposed} behavior(s) left out can be written after all: see the Claude actions.`);
  ctx.progress({ message: `${tests.length} test(s) written`, done: tests.length, total: tests.length });
  return result;
}
