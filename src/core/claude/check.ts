import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { proposeAction } from "../lib/actions.ts";
import { agentPool, loadLine } from "../lib/agents.ts";
import { type Corpus, loadCorpus, runMechanical, semanticOf, writeCheck } from "../lib/check.ts";
import { quoted, testName } from "../lib/names.ts";
import { readProject } from "../lib/project.ts";
import { readTestReview } from "../lib/review.ts";
import { listLocalTests, readCheck, readTest, testExists } from "../lib/store.ts";
import type { CheckFile, Diagnosis, Effort, Finding, Review } from "../types.ts";
import { GIVEN_SLOT, given, type Pick as RunPick } from "./given.ts";
import { languageName } from "./language.ts";
import { ledgerOf, wasOpened } from "./ledger.ts";
import { askParts, type Part } from "./parts.ts";
import type { PromptTemplate } from "./prompt.ts";
import { insideClaude, newRunId, type RunResult, runClaude } from "./run.ts";
import { revert } from "./snapshot.ts";
import { claudeVersion } from "./status.ts";
import { calledFor } from "./stream.ts";

export type TestCheck = {
  id: string;
  ok: boolean;
  semantic: boolean;
  review: Review;
  check: CheckFile;
  summary?: string;
  runId?: string;
  diagnosis?: Diagnosis;
};

export const CHECK_MARKER = "Use the check-test skill";

// ponytail: how many tests one request checks — four share the reading of the passages they have in common and the
// turns it takes to open them; more, and the last tests of the request get less attention than the first (measured
// with Sonnet high and Opus high on tests with planted errors, 2026-11-10)
export const CHECK_LIMITS = { parts: 4, size: 28000 };

export const inFolder = (folder: string, f: string) => {
  const root = f.replace(/\/+$/, "");
  return folder === root || folder.startsWith(`${root}/`) || root === "";
};

export function selectTests(project: string, input: { ids?: string[]; folder?: string; all?: boolean }): string[] {
  const tests = listLocalTests(project);
  if (input.all) return tests.map((t) => t.id);
  if (!input.ids?.length && input.folder === undefined)
    throw new UserError("Say which tests to check.", "Pass ids, a folder (--folder /Traction) or --all.");
  const out = new Set<string>();
  for (const t of input.ids ?? []) {
    if (!testExists(project, t))
      throw new UserError(`No test ${t} in this project.`, "testimus tests list shows the tests.");
    out.add(t);
  }
  if (input.folder !== undefined) {
    const f = input.folder;
    const hit = tests.filter((t) => inFolder(t.folder, f));
    if (!hit.length && !out.size)
      throw new UserError(`No test in the folder ${f}.`, "testimus tests list shows the tests and their folders.");
    for (const t of hit) out.add(t.id);
  }
  return [...out];
}

// ponytail: asked for, the semantic pass runs (a Claude that fails says so on each test); not said, it runs when Claude
// Code is connected; called from inside a Claude run (the .mcp.json env says so), Claude itself is the semantic checker
export async function semanticPlan(
  asked: boolean | undefined,
  signal?: AbortSignal,
): Promise<{ semantic: boolean; why?: string }> {
  if (asked === false) return { semantic: false, why: "Mechanical pass only, as asked." };
  if (insideClaude()) return { semantic: false, why: "Called from a Claude run: mechanical pass only." };
  if (asked === undefined && !(await claudeVersion(false, signal)).ok)
    return { semantic: false, why: "Claude Code is not connected: mechanical pass only." };
  return { semantic: true };
}

export const findingLine = (f: Finding) =>
  `- ${f.step ? `step ${f.step}` : "test"} — ${f.kind} (${f.severity}): ${f.message}${f.sources.length ? ` [${f.sources.join(", ")}]` : ""}${f.fix ? ` → fix: ${f.fix}` : ""}`;

export const FINDING_SLOT =
  "- {step N or test} — {kind} ({severity}): {message} [{sources}] → fix: {its fix, when the check gave one}";

export type CheckAsk = { id: string; name: string; steps: number | string; mechanical: string[] };

/** something else asked in a check request, answered in the reply: what a generation leaves to be said about it */
export type AlsoAsked = Part & { ask: string[]; answered(reply: string): boolean };

// ponytail: one request, as many tests as it carries — what is asked of each is the same sentence whatever their
// number, and what else rides along (also) comes after the tests, so the tests are never read through it
export function checkPrompt(tests: CheckAsk[], language: string, context: string[], also: string[][] = []): string {
  const many = tests.length !== 1;
  return [
    ...(tests.length
      ? [
          `${CHECK_MARKER} on the ${many ? `${tests.length} tests` : "test"} below. Read ${many ? "each one" : "it"} with tests_show; never modify a test or any other file.`,
          "",
          ...tests.flatMap((t) => [
            `- ${t.id} — « ${t.name} », ${t.steps} step${t.steps === 1 ? "" : "s"}. ${
              t.mechanical.length
                ? "Already recorded by the mechanical pass, do not repeat:"
                : "The mechanical pass found nothing."
            }`,
            ...t.mechanical.map((m) => `  ${m}`),
          ]),
          "",
          `Record ${many ? "each test on its own" : "it"} with check_record, exactly once${many ? " per test" : ""}: { id, steps: [{ step, verdict, read }], findings: [] }.`,
          '- steps: one entry per step of the test. verdict "supported" — the passages you opened state its expected result; "unsupported" — they do not, or say otherwise; "unverified" — you could not judge it, with why. read: the docId#anchor you opened to judge that step.',
          "- findings: only what a passage proves and a reviewer would act on (the bar of the skill); [] is a normal result. Give a finding a fix when the documents settle it — what the step should say instead, in one sentence, from which passage — and none when only the team can decide.",
          "A refused call says what is missing: correct it and call again.",
          `Messages and fixes in ${languageName(language)}.`,
        ]
      : [`${CHECK_MARKER}'s way of reading the documents for what is asked below; modify no file.`]),
    ...context,
    ...(tests.length
      ? ["", `Then reply with one line${many ? " per test" : ""}: its findings counted by severity.`]
      : []),
    ...also.flatMap((a) => ["", ...a]),
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "check",
    name: "Check tests against the documents",
    group: "Check and fix",
    kind: "check",
    usedBy: ["Review and Tests: Check", "Generate: the new tests, four per request", "check.run"],
    answers:
      "check_record, once per test: a verdict and the passages read for each step, the findings and, when the documents settle one, its fix. A test not recorded is asked again, alone",
    text: () =>
      checkPrompt(
        [
          { id: "{test}", name: "{summary}", steps: "{n}", mechanical: [FINDING_SLOT] },
          { id: "{another test}", name: "{summary}", steps: "{n}", mechanical: [] },
        ],
        "{language}",
        GIVEN_SLOT,
      ),
  },
];

type CheckPart = Part & { ask?: AlsoAsked };

const CANCELLED: RunResult = {
  ok: false,
  summary: "Cancelled",
  runId: "",
  raw: "",
  durationMs: 0,
  changedTests: [],
  changedSteps: {},
  written: [],
  calls: [],
};

async function request(
  ctx: Ctx,
  project: string,
  ids: string[],
  also: AlsoAsked[],
  corpus: Corpus,
  run: { model?: string; effort?: Effort; pick?: RunPick },
): Promise<RunResult> {
  const p = readProject(project);
  const runId = newRunId();
  const asks = ids.map((id) => {
    const { test } = readTest(project, id);
    return {
      id,
      name: test.summary.trim() || id,
      steps: test.steps.length,
      mechanical: (readCheck(project, id) ?? runMechanical(project, id, corpus)).findings
        .filter((f) => f.pass !== "semantic")
        .map(findingLine),
    };
  });
  const g = given(project, "check", ids.length ? { kind: "tests", testIds: ids } : { kind: "project" }, run.pick);
  const r = await runClaude({
    project,
    runId,
    label: "check",
    title:
      ids.length === 1
        ? `check ${quoted(testName(project, ids[0]))}`
        : ids.length
          ? `check ${ids.length} tests`
          : "second look at a generation",
    prompt: checkPrompt(
      asks,
      p.language,
      g.lines,
      also.map((a) => a.ask),
    ),
    model: run.model || p.claude.model,
    effort: run.effort || p.claude.effort,
    ...(ids.length ? { scope: { kind: "tests" as const, testIds: ids } } : {}),
    given: g,
    kind: "check",
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  const named = (t: string) => quoted(testName(project, t));
  const names = (ts: string[]) => ts.map(named).join(", ");
  const own = r.changedTests.filter((t) => r.written.includes(t));
  const other = r.changedTests.filter((t) => !own.includes(t));
  if (own.length)
    try {
      revert(project, r.runId, { ids: own });
      ctx.log("warn", `The check run edited ${names(own)}; the edit was put back.`);
    } catch {
      ctx.log("warn", `The check run edited ${names(own)}, then the file changed again — kept as it is.`);
    }
  if (other.length) ctx.log("warn", `${names(other)} changed while being checked (not by the check): check again.`);
  return r;
}

// ponytail: a verdict is a proof only for the passages the run really opened — its own tool calls say which; one that
// names passages it never opened is kept, marked as not opened
function stampOpened(project: string, id: string, r: RunResult): void {
  const check = readCheck(project, id);
  if (!check?.verdicts?.length) return;
  const consulted = ledgerOf(project, r.calls).consulted;
  const verdicts = check.verdicts.map((v) => ({
    ...v,
    ...(v.verdict === "unverified" ? {} : { opened: v.read.some((ref) => wasOpened(project, consulted, ref)) }),
  }));
  writeCheck(project, id, check.findings, verdicts);
}

// ponytail: one request answers for several tests, a line each — a test's own line is what is said of it
const lineOf = (reply: string, id: string): string =>
  reply
    .split(/\r?\n/)
    .find((l) => l.includes(id))
    ?.replace(/^[\s*-]+/, "")
    .trim() || reply;

export type ProposedBy = { runId: string; model: string; effort: Effort | "" };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const MAX_TITLE = 80;
const MAX_PLAN = 7;

// ponytail: the one place a fix is proposed for a test — from its check, never from a run's own confidence: a finding
// of the mechanical pass says itself what to write, one of the semantic pass is fixable when the check that read the
// passage gave its fix. One action per test, its plan the fixes themselves; what only the team can settle stays a
// finding. The action is known to have worked when the next check of the test finds none of them
export function proposeFix(project: string, id: string, by: ProposedBy, log?: Ctx["log"]): void {
  if (!testExists(project, id)) return;
  const fixable = (readCheck(project, id)?.findings ?? [])
    .filter((f) => f.severity !== "info" && (f.pass !== "semantic" || f.fix?.trim()))
    .sort((a, b) => (a.step ?? Number.MAX_SAFE_INTEGER) - (b.step ?? Number.MAX_SAFE_INTEGER));
  if (!fixable.length) return;
  const errors = fixable.filter((f) => f.severity === "error").length;
  const warnings = fixable.length - errors;
  const head = `Fix ${errors ? plural(errors, "error") : plural(warnings, "warning")} in `;
  const said = (f: Finding) => f.fix?.trim() || f.message;
  const where = (f: Finding) => (f.step && !said(f).startsWith(`Step ${f.step}`) ? `Step ${f.step}: ` : "");
  try {
    proposeAction(project, {
      title: `${head}${quoted(clip(testName(project, id), MAX_TITLE - head.length - 4))}`,
      scope: { kind: "test", testId: id },
      where: `test:${id}`,
      problem: fixable.map((f) => `${f.kind}${f.step ? ` (step ${f.step})` : ""}: ${f.message}`).join(" · "),
      why: "The check read the passages: each finding says what the step should hold instead.",
      plan: [
        ...fixable.slice(0, MAX_PLAN - 1).map((f) => clip(`${where(f)}${said(f)}`, 300)),
        "Run check_run on the test: none of these findings is left",
      ],
      proposedBy: { run: "check", model: by.model, effort: by.effort, at: env.now().toISOString(), runId: by.runId },
      suggest: { model: "sonnet", effort: errors ? "high" : "medium" },
    });
  } catch (e) {
    log?.(
      "warn",
      `No Claude action for ${quoted(testName(project, id))}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function checkTests(
  ctx: Ctx,
  project: string,
  ids: string[],
  semantic: boolean,
  o: { also?: AlsoAsked[]; model?: string; effort?: Effort; pick?: RunPick } = {},
): Promise<TestCheck[]> {
  const corpus = loadCorpus(project);
  const total = ids.length;
  let done = 0;
  ctx.progress({ message: `Checking ${total} test${total === 1 ? "" : "s"}`, done, total });
  const mech = new Map(ids.map((id) => [id, runMechanical(project, id, corpus)]));
  const base = (id: string, check: CheckFile) => ({ id, review: readTestReview(project, id), check });
  if (!semantic) return ids.map((id) => ({ ...base(id, mech.get(id) as CheckFile), ok: true, semantic: false }));

  const pool = agentPool({
    onLimit: (n, load) => ctx.log("info", `Agents: ${n} at a time (${loadLine(load)}).`),
  });
  const parts: CheckPart[] = [
    ...ids.map((id) => ({ id, size: readTest(project, id).md.length })),
    ...(o.also ?? []).map((ask) => ({ id: ask.id, size: ask.size, ask })),
  ];
  // ponytail: a test is checked once its record holds a verdict per step — a test without a step has none to give
  const recorded = (id: string, r: RunResult) =>
    calledFor(r.calls, "check_record", id) &&
    (!!readCheck(project, id)?.verdicts?.length || !readTest(project, id).test.steps.length);
  const asked = await askParts<CheckPart, RunResult>(parts, {
    limits: CHECK_LIMITS,
    all: (jobs) => Promise.all(jobs.map((j) => pool.run(j))),
    retry: (r) => r.ok && !ctx.signal.aborted,
    answered: (p, r) => (p.ask ? r.ok && p.ask.answered(r.summary) : r.ok && recorded(p.id, r)),
    run: async (group, again) => {
      const tests = group.filter((p) => !p.ask).map((p) => p.id);
      const also = group.flatMap((p) => (p.ask ? [p.ask] : []));
      if (ctx.signal.aborted) return CANCELLED;
      if (again)
        ctx.log(
          "info",
          `Asked again: ${group.map((p) => (p.ask ? p.id : quoted(testName(project, p.id)))).join(", ")}.`,
        );
      const r = await request(ctx, project, tests, also, corpus, o);
      for (const id of tests) {
        if (!recorded(id, r)) continue;
        stampOpened(project, id, r);
        const n = (s: string) => (readCheck(project, id)?.findings ?? []).filter((f) => f.severity === s).length;
        done++;
        ctx.progress({
          message: `${quoted(testName(project, id))}: ${n("error")} error(s), ${n("warning")} warning(s)`,
          done,
          total,
          test: id,
        });
      }
      return r;
    },
  });
  const p = readProject(project);
  return ids.map((id) => {
    const r = asked.answeredBy.get(id);
    const last = asked.lastOf.get(id);
    if (r) {
      proposeFix(
        project,
        id,
        { runId: r.runId, model: o.model || p.claude.model, effort: o.effort || p.claude.effort },
        ctx.log,
      );
      return {
        ...base(id, readCheck(project, id) as CheckFile),
        ok: true,
        semantic: true,
        summary: lineOf(r.summary, id),
        runId: r.runId,
      };
    }
    const why = ctx.signal.aborted
      ? "Cancelled"
      : last && !last.ok
        ? last.summary
        : `Claude did not record the check of ${id} (check_record was not called with a verdict per step).`;
    const kept = semanticOf(readCheck(project, id)).filter(
      (f) => f.kind !== "other" || !/did not finish/.test(f.message),
    );
    const check = ctx.signal.aborted
      ? (readCheck(project, id) ?? (mech.get(id) as CheckFile))
      : writeCheck(project, id, [
          ...(mech.get(id) as CheckFile).findings,
          ...kept,
          {
            kind: "other",
            severity: "warning",
            message: `The semantic check did not finish (${why.slice(0, 200) || "no answer"}): run the check again.`,
            sources: [],
            pass: "semantic",
          },
        ]);
    ctx.progress({ message: `${quoted(testName(project, id))}: semantic check failed`, done: ++done, total, test: id });
    return {
      ...base(id, check),
      ok: false,
      semantic: true,
      summary: why,
      ...(last?.runId ? { runId: last.runId } : {}),
      ...(last?.diagnosis ? { diagnosis: last.diagnosis } : {}),
    };
  });
}

export async function checkOne(ctx: Ctx, project: string, id: string, semantic: boolean): Promise<TestCheck> {
  return (await checkTests(ctx, project, [id], semantic))[0];
}
