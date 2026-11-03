import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Problem, runAction, triage } from "../claude/actions.ts";
import { docRunLines } from "../claude/prompt.ts";
import { readRunMeta } from "../claude/run.ts";
import { command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { showJob } from "../jobs.ts";
import {
  listActions,
  listed,
  proposeAction,
  readAction,
  runningNow,
  suggestFor,
  WHERE,
  writeAction,
} from "../lib/actions.ts";
import { readDoc } from "../lib/docs.ts";
import { testDir } from "../lib/store.ts";
import { ACTION_EFFORTS, ACTION_MODELS, type ClaudeScope } from "../types.ts";
import { CONTEXT_IDS, CONVERSATION, EFFORT, MODEL, NOTE, RESULT, SCOPE, scopeLabel } from "./claude.ts";

const id = z
  .string()
  .regex(/^act-[\w-]+$/, "An action id: act-…")
  .describe("Action id (act-…)");

const SUGGEST_MODEL = z.enum(ACTION_MODELS);
const SUGGEST_EFFORT = z.enum(ACTION_EFFORTS);

const ACTION = z.object({
  id: z.string().describe("Action id"),
  title: z.string().describe("What the button says, a verb first"),
  scope: SCOPE.describe("What the action works on: a step, a test, a document or the project"),
  where: z.string().describe("Where the problem is: doc:<id>, test:<id>, job:<id> or project"),
  problem: z.string().describe("The problem, as Testimus or Claude stated it"),
  why: z.string().describe("Why Claude judged it can fix it"),
  plan: z.array(z.string()).describe("The steps Claude proposed"),
  stamp: z.string().describe("State of the problem place when the action was proposed"),
  proposedBy: z
    .object({
      run: z.string().describe("Which run proposed it: import, check, generate, triage…"),
      model: z.string().describe("Model of that run"),
      effort: z.union([EFFORT, z.literal("")]).describe("Effort of that run"),
      at: z.string().describe("When"),
      runId: z.string().optional().describe("The proposing run"),
    })
    .describe("Who proposed the action — its quality depends on that run's model and effort"),
  suggest: z
    .object({ model: SUGGEST_MODEL, effort: SUGGEST_EFFORT })
    .optional()
    .describe("The model and effort the fix needs, as the proposing run judged it (Opus and xhigh at most)"),
  state: z.enum(["open", "running", "done", "dismissed"]).describe("open, running, done or dismissed"),
  at: z.string().describe("When it was proposed"),
  last: z
    .object({
      runId: z.string(),
      ok: z.boolean(),
      summary: z.string(),
      at: z.string(),
      model: z.string(),
      effort: EFFORT,
    })
    .optional()
    .describe("The last run of the action"),
});
const LISTED = ACTION.extend({
  stale: z.boolean().describe("The problem place changed since: the problem may be gone, the button is not shown"),
});

function checkScope(project: string, s: ClaudeScope): void {
  if (s.kind === "doc") readDoc(project, s.docId);
  if (s.kind === "step" || s.kind === "test") {
    if (!existsSync(join(testDir(project, s.testId), "test.md")))
      throw new UserError(`No test ${s.testId} in this project.`);
  }
  if (s.kind === "tests") for (const t of s.testIds) testDir(project, t);
}

function jobProblems(project: string, jobId: string): Problem[] {
  const shown = showJob(project, jobId);
  if (!shown) throw new UserError(`No job ${jobId} in this project.`);
  const where = `job:${jobId}`;
  const out: Problem[] = [];
  if (shown.job.error) out.push({ where, text: `${shown.job.kind} ${shown.job.subject} failed: ${shown.job.error}` });
  for (const e of shown.events)
    if (e.type === "log" && e.level !== "info" && out.length < 8) out.push({ where, text: e.message });
  return out;
}

const docProblems = (project: string, docId: string): Problem[] =>
  readDoc(project, docId).warnings.map((text) => ({ where: `doc:${docId}`, text }));

export const commands = [
  command({
    name: "actions.list",
    summary:
      "List the Claude actions: problems a Claude run saw and judged it can fix, each with its button text, scope and plan.",
    input: z.object({
      docId: z.string().optional().describe("Only the actions about this document"),
      testId: z.string().optional().describe("Only the actions about this test (and its steps)"),
      jobId: z.string().optional().describe("Only the actions about this job"),
      all: z.boolean().optional().describe("Also the done, dismissed and stale ones"),
    }),
    output: z.array(LISTED),
    mutates: false,
    async run(ctx, input) {
      return listActions(projectOf(ctx), input);
    },
  }),
  command({
    name: "actions.show",
    summary: "Show one Claude action.",
    input: z.object({ id }),
    output: LISTED,
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      return listed(project, readAction(project, input.id));
    },
  }),
  command({
    name: "actions.propose",
    summary:
      "Propose a Claude action for a problem you can fix in a later run: the user sees a card with the title in the Actions tab of Ask Claude. One open action per problem; a dismissed problem stays dismissed.",
    input: z.object({
      runId: z
        .string()
        .optional()
        .describe("The runId your prompt gave you — it records which run, model and effort proposed the action"),
      where: z
        .string()
        .regex(WHERE, "doc:<id>, test:<id>, job:<id> or project")
        .optional()
        .describe("Where the problem is: doc:<id>, test:<id>, job:<id> or project (default: from the scope)"),
      problem: z.string().min(1).max(2000).describe("The problem, verbatim as Testimus stated it, or in one sentence"),
      title: z.string().min(3).max(80).describe("The button text: a verb first, at most 60 characters, in English"),
      why: z.string().min(1).max(2000).describe("One sentence: why you can fix it"),
      plan: z.array(z.string().max(300)).min(1).max(8).describe("2 to 5 short steps you would take"),
      scope: SCOPE.describe("What the action works on: { kind: step|test|doc|project, testId?, step?, docId? }"),
      model: SUGGEST_MODEL.optional().describe(
        "The model the fix needs: haiku for a mechanical change, sonnet for ordinary test edits, opus for reading documents and judging",
      ),
      effort: SUGGEST_EFFORT.optional().describe(
        "The effort the fix needs: low for one obvious change, medium for a few, high for a real search, xhigh for a long or delicate one",
      ),
    }),
    output: LISTED.extend({ ignored: z.boolean().optional().describe("True when the user dismissed this problem") }),
    mutates: true,
    subject: (i) => i.title,
    async run(ctx, input) {
      const project = projectOf(ctx);
      checkScope(project, input.scope);
      const meta = input.runId ? readRunMeta(project, input.runId) : null;
      const a = proposeAction(project, {
        title: input.title,
        scope: input.scope,
        where: input.where,
        problem: input.problem,
        why: input.why,
        plan: input.plan,
        proposedBy: {
          run: meta?.label ?? meta?.kind ?? "claude",
          model: meta?.model ?? "",
          effort: meta?.effort ?? "",
          at: env.now().toISOString(),
          ...(meta && input.runId ? { runId: input.runId } : {}),
        },
        suggest: {
          model: input.model ?? suggestFor(input).model,
          effort: input.effort ?? suggestFor(input).effort,
        },
      });
      return { ...listed(project, a), ...(a.ignored ? { ignored: true } : {}) };
    },
  }),
  command({
    name: "actions.dismiss",
    summary: "Dismiss a Claude action: its button goes and does not come back for the same problem.",
    input: z.object({ id }),
    output: LISTED,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const a = readAction(project, input.id);
      if (a.state === "running" && runningNow(project, a.id))
        throw new UserError("This action is running.", "Cancel its run first.");
      return listed(project, writeAction(project, { ...a, state: "dismissed" }));
    },
  }),
  command({
    name: "actions.run",
    summary:
      "Run a Claude action with the app's whole command set; everything it changes (tests, the document in scope, project.json) is snapshotted, so claude.revert puts it back.",
    input: z.object({
      id,
      model: MODEL.optional().describe("Model alias or name (default: the action's suggested model)"),
      effort: EFFORT.optional().describe("Effort level (default: the action's suggested effort)"),
      contexts: CONTEXT_IDS.optional().describe("Context ids to attach (default: the effective ones)"),
      note: NOTE,
      conversation: CONVERSATION,
    }),
    output: RESULT.extend({
      action: ACTION,
      changedFiles: z.array(z.string()).describe("Files other than tests the action changed, relative to the project"),
    }),
    mutates: true,
    job: "claude",
    positional: ["id"],
    subject: (i) => i.id,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const a = readAction(project, input.id);
      if (a.state === "running" && runningNow(project, a.id, ctx.jobId))
        throw new UserError("This action is already running.");
      ctx.progress({ message: `Claude action on ${scopeLabel(a.scope)}: ${a.title}` });
      return await runAction(ctx, project, input.id, input);
    },
  }),
  command({
    name: "actions.triage",
    summary:
      "Have Claude look at the problems of a document (its conversion warnings) or of a failed job, and propose an action for each one it can fix.",
    input: z.object({
      docId: z.string().optional().describe("A document: its conversion warnings are looked at"),
      jobId: z.string().optional().describe("A failed job: its error and warnings are looked at"),
      model: MODEL.optional().describe("Model (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Effort (default: low)"),
      note: NOTE,
      contexts: CONTEXT_IDS.optional().describe("Saved contexts to read for this run (with docId)"),
    }),
    output: z.object({
      ok: z.boolean().describe("Whether the Claude run finished"),
      summary: z.string().describe("Claude's one-line answer"),
      proposed: z.array(LISTED).describe("The actions this triage proposed"),
    }),
    mutates: true,
    job: "actions.triage",
    subject: (i) => i.docId ?? i.jobId ?? "",
    cause: (i) => (i.jobId ? { jobId: i.jobId, why: "after-failure" } : undefined),
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!input.docId === !input.jobId) throw new UserError("Give either docId or jobId.");
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
    },
  }),
];
