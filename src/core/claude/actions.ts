import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { listJobs, showJob, startJob } from "../jobs.ts";
import { allActions, type Listed, readAction, stampOf, suggestFor, writeAction } from "../lib/actions.ts";
import { findDoc, readDoc } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import { readCheck, testExists } from "../lib/store.ts";
import type { ActionLeft, ClaudeAction, ClaudeRun, Effort } from "../types.ts";
import { checkOne, semanticPlan } from "./check.ts";
import { docGiven, GIVEN_SLOT, type Given, given, subjectOf } from "./given.ts";
import { languageName } from "./language.ts";
import { type PromptTemplate, scopeLines } from "./prompt.ts";
import { newRunId, type RunResult, runClaude } from "./run.ts";
import { readRun } from "./snapshot.ts";
import { claudeVersion } from "./status.ts";

export const ACTION_MARKER = "Testimus Claude action";
export const TRIAGE_MARKER = "Testimus triage";

export type Problem = { where: string; text: string };

// ponytail: the one rule for a run that may leave a Claude action behind — said here, never again in a skill nor in
// CLAUDE.md. An action is proposed for a problem the run looked at and can fix from the files, with a plan whose last
// step says how anyone will know it worked; a test's findings and a generation's items left out are not proposed by a
// run at all: Testimus builds those from the check (claude/check.ts proposeFix, claude/gen-review.ts)
export const ACTION_RULE = [
  "title: a verb first, at most 60 characters, in English (« Recover 23 figures from the PDF »). problem: as Testimus or you stated it. why: one sentence on why it can be fixed from the files. plan: 2 to 5 short steps, the last one saying how anyone will know it worked.",
  "model and effort: the least the fix needs — haiku (a mechanical change), sonnet (ordinary test edits) or opus (reading documents, judging); low (one obvious change), medium, high (a real search) or xhigh (long, delicate).",
  "Propose only what you looked at and can fix: at most 3, never a choice only the team can make, never what nobody can fix from the files.",
];

export function proposeLines(runId: string, examples: string): string[] {
  return [
    "",
    `A problem you could fix yourself in a later run, with the app's tools, can be left as a Claude action the user runs when they choose: actions_propose { runId: "${runId}", problem, title, why, plan, scope, model, effort }.`,
    `For example: ${examples}.`,
    ...ACTION_RULE,
  ];
}

export function triagePrompt(
  runId: string,
  problems: Problem[],
  where: string,
  language: string,
  extra: string[] = [],
): string {
  return [
    `${TRIAGE_MARKER} of ${where}: Testimus found the problems below.`,
    "For each one, decide whether you could fix it yourself in a later run, with the app's own commands. Look first — the project files, the documents, the tests, read only — and change nothing now.",
    "",
    "Problems:",
    ...problems.map((p) => `- [${p.where}] ${p.text}`),
    ...extra,
    "",
    "For a problem you can fix, call actions_propose once:",
    `{ runId: "${runId}", where: "<the [place] of the problem>", problem: "<the problem text, verbatim>", title, why, plan: ["…"],`,
    '  scope: { kind: "doc", docId } | { kind: "test", testId } | { kind: "step", testId, step } | { kind: "project" }, model, effort }',
    ...ACTION_RULE,
    "A figure the conversion found no picture for is fixable when a page of the document's PDF copy draws it: docs_page shows the page; the fix keeps the region with docs_convert { id, conversion: { ...its current options, figures: [{ key, page, region }] } }. Check the page before you propose it.",
    `why and plan in English; the problem quoted as given (the project's language is ${languageName(language)}).`,
    "Reply in one line: how many actions you proposed.",
    "",
  ].join("\n");
}

export const actionPrompt = (a: ClaudeAction, context: string[]): string => actionText(a, scopeLines(a.scope), context);

function actionText(
  a: Pick<ClaudeAction, "id" | "title" | "where" | "problem" | "why" | "plan">,
  scope: string[],
  context: string[],
): string {
  const lines = [
    `${ACTION_MARKER} ${a.id}: ${a.title}`,
    ...scope,
    "",
    `Problem (${a.where}): ${a.problem}`,
    `Why it can be fixed: ${a.why}`,
  ];
  if (a.plan.length)
    lines.push(
      "The plan proposed when the problem was seen — adjust it to what you find:",
      ...a.plan.map((s) => `- ${s}`),
    );
  lines.push(
    "",
    "Your tools are the app's own commands, the same as its buttons: change documents, settings and columns through them (docs_convert, docs_set, project_set, columns_save…) — Edit and Write are refused outside tests/.",
    "A test you change keeps the format and the source rules of CLAUDE.md.",
    "Never write to Jira: when the fix needs a push, prepare it with xray_plan and say what to push.",
    "Everything you change is snapshotted, and the user can revert it. Testimus then counts what is left of the problem.",
    ...context,
    "",
    "Reply in 2 to 5 lines: what you did, what is left, whether the problem is gone.",
    "",
  );
  return lines.join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "action",
    name: "Run a Claude action",
    group: "Claude actions",
    kind: "action",
    usedBy: ["Claude tab › Actions: Run", "actions.run"],
    answers: "What its plan changes, through the app's commands (snapshotted), and whether the problem is gone",
    text: () =>
      actionText(
        {
          id: "{action}",
          title: "{title}",
          where: "{where}",
          problem: "{problem}",
          why: "{why}",
          plan: ["{step of the plan}"],
        },
        ["Scope: {scope}", "Files: {files}"],
        GIVEN_SLOT,
      ),
  },
  {
    id: "triage",
    name: "Look at a failed job",
    group: "Claude actions",
    kind: "triage",
    usedBy: ["Jobs: a failed job", "actions.triage (job)", "actions.triageFailed"],
    answers: "actions_propose for each problem it could fix; nothing is changed",
    text: () => triagePrompt("{runId}", [{ where: "job:{job}", text: "{problem}" }], "the job {job}", "{language}"),
  },
  {
    id: "triage-doc",
    name: "Look at a document's conversion problems",
    group: "Claude actions",
    kind: "triage",
    usedBy: ["Documents: the conversion warnings", "actions.triage (docId)"],
    answers: "actions_propose for each warning it could fix; nothing is changed",
    text: () =>
      triagePrompt(
        "{runId}",
        [{ where: "doc:{document}", text: "{problem}" }],
        "the document {document}",
        "{language}",
        GIVEN_SLOT,
      ),
  },
];

export type ActionRun = Omit<RunResult, "calls"> & { action: ClaudeAction; changedFiles: string[] };

// ponytail: an action whose test, document, generation or job is gone has nothing left to work on — it is refused, never
// run on a place that no longer exists
function goneOf(project: string, a: ClaudeAction): string | null {
  const s = a.scope;
  if ((s.kind === "test" || s.kind === "step") && !testExists(project, s.testId)) return `the test ${s.testId}`;
  if (s.kind === "tests") {
    const lost = s.testIds.filter((id) => !testExists(project, id));
    if (lost.length === s.testIds.length) return `the tests ${lost.join(", ")}`;
  }
  if (s.kind === "doc" && !findDoc(project, s.docId)) return `the document ${s.docId}`;
  return stampOf(project, a.where) === "gone" ? a.where : null;
}

// ponytail: an action is known to have worked by what is left where its problem was — the findings of the test once
// checked again, the conversion warnings of the document — counted by Testimus, never taken from Claude's reply. A
// problem elsewhere (a job, a generation, the project) is not counted
function counted(project: string, where: string): { n: number; of: ActionLeft["of"] } | null {
  const [kind, id] = where.split(":");
  if (kind === "test" && testExists(project, id))
    return {
      n: (readCheck(project, id)?.findings ?? []).filter((f) => f.severity !== "info").length,
      of: "findings",
    };
  if (kind === "doc") {
    const d = findDoc(project, id);
    return d ? { n: d.converted?.warnings?.length ?? 0, of: "warnings" } : null;
  }
  return null;
}

export async function runAction(
  ctx: Ctx,
  project: string,
  id: string,
  o: { model?: string; effort?: Effort; note?: string; contexts?: string[]; without?: string[]; conversation?: string },
): Promise<ActionRun> {
  const a = readAction(project, id);
  const gone = goneOf(project, a);
  if (gone)
    throw new UserError(
      `« ${a.title} » cannot run: ${gone} is no longer in this project.`,
      `Dismiss it (testimus actions dismiss ${a.id}): its problem went with it.`,
      "action-gone",
    );
  const s = a.suggest ?? suggestFor(a);
  const model = o.model || s.model;
  const effort = o.effort || s.effort;
  const g = given(project, "action", subjectOf(a.scope), o);
  const runId = newRunId();
  const before = counted(project, a.where);
  writeAction(project, { ...a, state: "running" });
  let left: ClaudeAction = { ...a, state: "open" };
  try {
    const { calls: _calls, ...r } = await runClaude({
      kind: "action",
      project,
      prompt: actionPrompt(a, g.lines),
      model,
      effort,
      scope: a.scope,
      files: true,
      given: g,
      runId,
      ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    const [place, placeId] = a.where.split(":");
    if (r.ok && place === "test" && testExists(project, placeId) && !ctx.signal.aborted) {
      ctx.progress({ message: "Checking the test again" });
      await checkOne(ctx, project, placeId, (await semanticPlan(undefined, ctx.signal)).semantic);
    }
    const after = r.ok ? counted(project, a.where) : null;
    left = {
      ...readAction(project, id),
      state: r.ok ? "done" : "open",
      last: {
        runId,
        ok: r.ok,
        summary: r.summary,
        at: env.now().toISOString(),
        model,
        effort,
        ...(before && after ? { left: { was: before.n, now: after.n, of: after.of } } : {}),
      },
    };
    return { ...r, action: left, changedFiles: readRun(project, runId).changedFiles ?? [] };
  } finally {
    writeAction(project, left);
  }
}

export async function triage(
  ctx: Ctx,
  project: string,
  problems: Problem[],
  where: string,
  run: ClaudeRun,
  label: string,
  g?: Given,
): Promise<{ ok: boolean; summary: string; proposed: Listed[]; skipped?: boolean }> {
  if (!problems.length) return { ok: true, summary: "No problem to look at.", proposed: [], skipped: true };
  // ponytail: without Claude nothing is looked at, and the job says so instead of failing
  if (!(await claudeVersion(false, ctx.signal)).ok)
    return { ok: false, summary: "Claude Code is not connected: nothing was looked at.", proposed: [], skipped: true };
  const p = readProject(project);
  const runId = newRunId();
  ctx.progress({ message: `Claude looks at ${problems.length === 1 ? "the problem" : `${problems.length} problems`}` });
  const r = await runClaude({
    kind: "triage",
    project,
    prompt: triagePrompt(runId, problems, where, p.language, g?.lines ?? []),
    ...(g ? { given: g } : {}),
    model: run.model || p.claude.model,
    effort: run.effort || "low",
    runId,
    label,
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  return { ok: r.ok, summary: r.summary, proposed: allActions(project).filter((a) => a.proposedBy.runId === runId) };
}

function jobProblems(project: string, jobId: string): Problem[] {
  const shown = showJob(project, jobId);
  if (!shown) throw new UserError(`No job ${jobId} in this project.`, "testimus jobs list shows the jobs.");
  const where = `job:${jobId}`;
  const out: Problem[] = [];
  if (shown.job.error) out.push({ where, text: `${shown.job.kind} ${shown.job.subject} failed: ${shown.job.error}` });
  for (const e of shown.events)
    if (e.type === "log" && e.level !== "info" && out.length < 8) out.push({ where, text: e.message });
  return out;
}

const docProblems = (project: string, docId: string): Problem[] =>
  (readDoc(project, docId).converted?.warnings ?? []).map((text) => ({ where: `doc:${docId}`, text }));

export type TriageInput = ClaudeRun & {
  docId?: string;
  jobId?: string;
  note?: string;
  contexts?: string[];
  without?: string[];
};

export async function triageRun(ctx: Ctx, project: string, input: TriageInput) {
  if (!input.docId === !input.jobId)
    throw new UserError(
      "Give either docId or jobId.",
      "--doc-id <document> for its conversion warnings, or --job-id <job> for a failed job.",
    );
  const problems = input.docId ? docProblems(project, input.docId) : jobProblems(project, input.jobId ?? "");
  const where = input.docId ? `the document ${input.docId}` : `the job ${input.jobId}`;
  return await triage(
    ctx,
    project,
    problems,
    where,
    { model: input.model, effort: input.effort },
    input.docId ? "import" : "job",
    input.docId ? docGiven(project, "triage", input.docId, input) : given(project, "triage", { kind: "none" }),
  );
}

// ponytail: a failed job of the documents, the index, the figures, a generation or a check is shown to Claude once,
// cheaply (project model, low effort), when Claude is there; a Claude run or a Jira call is never triaged
const TRIAGED = /^(docs\.|rag-|rag\.|describe-figures|generate|check)/;

const deciding = new Set<string>();

// ponytail: the failed job is held from the first check to the triage job's start — asking whether Claude is there
// takes a while, and two pages that both saw the failure must start one triage, not two
export async function triageFailed(project: string, jobId: string): Promise<{ triage: string | null; why: string }> {
  const shown = showJob(project, jobId);
  if (!shown) throw new UserError(`No job ${jobId} in this project.`, "testimus jobs list shows the jobs.");
  const { job } = shown;
  const no = (why: string) => ({ triage: null, why });
  if (job.status !== "failed") return no(`The job ${jobId} did not fail (${job.status}).`);
  if (!TRIAGED.test(job.kind))
    return no(
      `A ${job.kind} job is not shown to Claude (only documents, index, figures, generation and check jobs are).`,
    );
  const held = `${project}\n${jobId}`;
  const already = () => listJobs(project).some((j) => j.kind === "actions.triage" && j.cause?.jobId === jobId);
  if (deciding.has(held) || already()) return no(`Claude already looked at the job ${jobId}.`);
  deciding.add(held);
  try {
    if (!(await claudeVersion()).ok) return no("Claude Code is not connected.");
    const input = { jobId };
    const { job: started } = startJob(
      "actions.triage",
      jobId,
      project,
      (c) => triageRun(c, project, input),
      undefined,
      {
        cause: { jobId, why: "after-failure" },
        rerun: { name: "actions.triage", input },
      },
    );
    return { triage: started.id, why: `Claude looks at the failed ${started.subject} job, cheaply (low effort).` };
  } finally {
    deciding.delete(held);
  }
}
