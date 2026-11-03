import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { allActions, type Listed, readAction, writeAction } from "../lib/actions.ts";
import { readProject } from "../lib/project.ts";
import type { ClaudeAction, ClaudeRun, Effort } from "../types.ts";
import { contextLines, effectiveContexts, readContexts, scopeLines } from "./prompt.ts";
import { newRunId, type RunResult, runClaude } from "./run.ts";
import { readRun } from "./snapshot.ts";

export const ACTION_MARKER = "Testimus Claude action";
export const TRIAGE_MARKER = "Testimus triage";

export type Problem = { where: string; text: string };

// ponytail: what a run that sees problems is told — it may leave a button behind, for a problem it can really fix
export function proposeLines(runId: string, examples: string): string[] {
  return [
    "",
    "If you see a problem you could fix yourself in a later run with the app's tools, propose it with actions_propose",
    `(it shows the user a « Claude action » button): { runId: "${runId}", problem, title, why, plan, scope }.`,
    `For example: ${examples}.`,
    "title: a verb first, at most 60 characters, in English (« Recover 23 figures from the PDF »); problem: the problem",
    "as Testimus or you stated it; why: one sentence on why you can fix it; plan: 2 to 5 short steps.",
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
    '  scope: { kind: "doc", docId } | { kind: "test", testId } | { kind: "step", testId, step } | { kind: "project" } }',
    "Skip a problem nobody can fix from the files (a drawing lost in the source, a choice only the team can make).",
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
  const lines = [
    `${ACTION_MARKER} ${a.id}: ${a.title}`,
    ...scopeLines(a.scope),
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
    ...contextLines(project, readContexts(project, contexts), note, conversation),
    "",
    "When finished, reply in 2-5 lines: what you did, what is left, and whether the problem is gone.",
    "",
  );
  return lines.join("\n");
}

export type ActionRun = Omit<RunResult, "calls"> & { action: ClaudeAction; changedFiles: string[] };

export async function runAction(
  ctx: Ctx,
  project: string,
  id: string,
  o: { model?: string; effort?: Effort; note?: string; contexts?: string[]; conversation?: string },
): Promise<ActionRun> {
  const a = readAction(project, id);
  const p = readProject(project);
  const model = o.model || p.claude.model;
  const effort = o.effort || p.claude.effort;
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
): Promise<{ ok: boolean; summary: string; proposed: Listed[] }> {
  if (!problems.length) return { ok: true, summary: "No problem to look at.", proposed: [] };
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
