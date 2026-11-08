import { type Ctx, UserError } from "../command.ts";
import { env } from "../env.ts";
import { listJobs, showJob, startJob } from "../jobs.ts";
import { allActions, type Listed, readAction, suggestFor, writeAction } from "../lib/actions.ts";
import { readDoc } from "../lib/docs.ts";
import { readProject } from "../lib/project.ts";
import type { ClaudeAction, ClaudeRun, Effort } from "../types.ts";
import {
  CONTEXT_SLOT,
  contextLines,
  DOC_SLOT,
  docRunLines,
  effectiveContexts,
  type PromptTemplate,
  readContexts,
  scopeLines,
} from "./prompt.ts";
import { newRunId, type RunResult, runClaude } from "./run.ts";
import { readRun } from "./snapshot.ts";
import { claudeVersion } from "./status.ts";

export const ACTION_MARKER = "Testimus Claude action";
export const TRIAGE_MARKER = "Testimus triage";

export type Problem = { where: string; text: string };

// ponytail: what a run that sees problems is told — it may leave a button behind, for a problem it can really fix
// ponytail: the proposing run knows the fix best — it says which model and effort the fix needs, Opus and xhigh at most
const SUGGEST_RULE = [
  "model and effort: what the fix needs — model haiku (a mechanical change), sonnet (ordinary test edits) or opus",
  "(reading documents, judging); effort low (one obvious change), medium, high (a real search) or xhigh (long, delicate).",
];

export function proposeLines(runId: string, examples: string): string[] {
  return [
    "",
    "If you see a problem you could fix yourself in a later run with the app's tools, propose it with actions_propose",
    `(the user sees it as a card in the Actions tab of Ask Claude): { runId: "${runId}", problem, title, why, plan, scope, model, effort }.`,
    `For example: ${examples}.`,
    "title: a verb first, at most 60 characters, in English (« Recover 23 figures from the PDF »); problem: the problem",
    "as Testimus or you stated it; why: one sentence on why you can fix it; plan: 2 to 5 short steps.",
    ...SUGGEST_RULE,
    "Propose only what you are confident about, at most 3, and never for a choice only the team can make.",
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
    "For each one, decide whether you could fix it yourself in a later run, with the app's own commands",
    "(mcp__testimus__ tools: docs_*, tests_*, columns_*, contexts_*, check_run, rag_index…).",
    "Look first (read only: the project files, the documents, the tests, rag_search); do not change anything now.",
    "",
    "Problems:",
    ...problems.map((p) => `- [${p.where}] ${p.text}`),
    ...extra,
    "",
    "For a problem you can really fix, call actions_propose once:",
    `{ runId: "${runId}", where: "<the [place] of the problem>", problem: "<the problem text, verbatim>",`,
    '  title: "<a verb first, at most 60 characters, in English>", why: "<one sentence>", plan: ["<2 to 5 short steps>"],',
    '  scope: { kind: "doc", docId } | { kind: "test", testId } | { kind: "step", testId, step } | { kind: "project" },',
    '  model: "haiku" | "sonnet" | "opus", effort: "low" | "medium" | "high" | "xhigh" }',
    ...SUGGEST_RULE,
    "A figure the conversion found no picture for is fixable when a page of the document's PDF copy draws it: docs_page",
    "shows the page; the fix keeps the region with docs_convert { id, conversion: { ...its current options, figures:",
    "[{ key, page, region }] } }. Check the page before proposing it.",
    "Skip a problem nobody can fix from the files (a drawing drawn nowhere, not even in the PDF; a choice only the team",
    "can make).",
    `Write why and plan in English; quote the problem as given (project language: ${language}).`,
    "Reply in one line: how many actions you proposed.",
    "",
  ].join("\n");
}

export function actionPrompt(
  project: string,
  a: ClaudeAction,
  contexts: string[],
  note = "",
  conversation = "",
): string {
  return actionText(a, scopeLines(a.scope), contextLines(project, readContexts(project, contexts), note, conversation));
}

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
    `Why it was judged fixable: ${a.why}`,
  ];
  if (a.plan.length)
    lines.push("Plan proposed when the problem was seen (adjust it to what you find):", ...a.plan.map((s) => `- ${s}`));
  lines.push(
    "",
    "You may use every mcp__testimus__ tool: they are the app's own commands, the same as its CLI and its buttons.",
    "Change documents, settings and smart columns through them (docs_convert, docs_set, project_set, columns_save…);",
    "files under docs/, index/, .testimus/ and project.json are refused to Edit and Write.",
    "Tests follow the test.md format of CLAUDE.md; every claim keeps or gets its source line",
    '`<docId>#<anchor> "<exact quote from doc.md>"`, found with rag_search and rag_passage.',
    "Never write to Jira: if the fix needs a push, prepare it with xray_plan and say what to push; the user pushes.",
    "Everything you change is snapshotted and can be reverted by the user.",
    ...context,
    "",
    "When finished, reply in 2-5 lines: what you did, what is left, and whether the problem is gone.",
    "",
  );
  return lines.join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "action",
    name: "Run a Claude action",
    group: "Claude actions",
    usedBy: ["Claude dock › Actions: Run", "actions.run"],
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
        CONTEXT_SLOT,
      ),
  },
  {
    id: "triage",
    name: "Look at problems Testimus found",
    group: "Claude actions",
    usedBy: ["Documents: the conversion warnings", "Jobs: a failed job", "actions.triage"],
    text: () => triagePrompt("{runId}", [{ where: "{where}", text: "{problem}" }], "{what}", "{language}", DOC_SLOT),
  },
];

export type ActionRun = Omit<RunResult, "calls"> & { action: ClaudeAction; changedFiles: string[] };

export async function runAction(
  ctx: Ctx,
  project: string,
  id: string,
  o: { model?: string; effort?: Effort; note?: string; contexts?: string[]; conversation?: string },
): Promise<ActionRun> {
  const a = readAction(project, id);
  const s = a.suggest ?? suggestFor(a);
  const model = o.model || s.model;
  const effort = o.effort || s.effort;
  const ids = o.contexts ?? effectiveContexts(project, "testId" in a.scope ? a.scope.testId : undefined);
  const runId = newRunId();
  writeAction(project, { ...a, state: "running" });
  let left: ClaudeAction = { ...a, state: "open" };
  try {
    const { calls: _calls, ...r } = await runClaude({
      kind: "action",
      project,
      prompt: actionPrompt(project, a, ids, o.note, o.conversation),
      model,
      effort,
      scope: a.scope,
      files: true,
      contexts: ids,
      runId,
      ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    left = {
      ...readAction(project, id),
      state: r.ok ? "done" : "open",
      last: { runId, ok: r.ok, summary: r.summary, at: env.now().toISOString(), model, effort },
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
  extra: string[] = [],
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
    prompt: triagePrompt(runId, problems, where, p.language, extra),
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

export type TriageInput = ClaudeRun & { docId?: string; jobId?: string; note?: string; contexts?: string[] };

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
    input.docId ? docRunLines(project, input.docId, input) : [],
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
