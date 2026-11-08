import { z } from "zod";
import { listPrompts } from "../claude/catalog.ts";
import { draftComment } from "../claude/comment.ts";
import { diagnose } from "../claude/diagnose.ts";
import {
  CONTEXT_IDS,
  CONVERSATION,
  DIAGNOSIS,
  EFFORT,
  MODEL,
  NOTE,
  RESULT,
  SCOPE,
  scopeLabel,
  TOKENS,
} from "../claude/schemas.ts";
import { runOnScope } from "../claude/scoped.ts";
import { leftAsIs, readRun, revert, standingRun } from "../claude/snapshot.ts";
import { CONNECT, checkSignedIn, claudeExe, claudeVersion } from "../claude/status.ts";
import { command, projectOf } from "../command.ts";
import { scopeName, testName } from "../lib/names.ts";
import { readXray } from "../lib/project.ts";
import { parseTest } from "../lib/testfile.ts";
import { TEST, TEST_ID } from "../schemas.ts";

const STATUS = z.object({
  installed: z.boolean().describe("claude --version answered"),
  version: z.string().optional().describe("Its version"),
  exe: z.string().describe("The Claude program Testimus runs (the setting, or the one found on PATH)"),
  signedIn: z.boolean().nullable().describe("Whether a tiny run worked; null when it was not tried (signIn not asked)"),
  detail: z.string().describe("What claude said, first line"),
  diagnosis: DIAGNOSIS.optional(),
  connect: z
    .array(
      z.object({
        title: z.string().describe("The step"),
        cmd: z.string().describe("What to type"),
        hint: z.string().describe("Where and how"),
      }),
    )
    .describe("How to install Claude Code and sign in"),
});

export const commands = [
  command({
    name: "claude.run",
    summary:
      "Run Claude on a test, a step, several tests or the project; snapshots the tests so the run can be reverted.",
    input: z.object({
      scope: SCOPE.describe(
        "What Claude may edit: { kind: step|test|tests|project, testId?, step?, testIds? }; or what it reads without changing anything: { kind: run, run, testId?, step? } (a test run).",
      ),
      prompt: z.string().describe("The request, e.g. « Rephrase in house style »."),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)."),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)."),
      contexts: CONTEXT_IDS.optional().describe(
        "Context ids to attach (default: the test's own list, else project.json claude.contexts; on the project, every context the project or a test attaches, once each).",
      ),
      note: NOTE,
      conversation: CONVERSATION,
    }),
    output: RESULT,
    mutates: true,
    job: "claude",
    subject: (i) => scopeLabel(i.scope),
    label: (i, project) => scopeName(project, i.scope),
    async run(ctx, input) {
      const project = projectOf(ctx);
      ctx.progress({ message: `Claude on ${scopeName(project, input.scope)}` });
      return await runOnScope(ctx, project, input);
    },
  }),
  command({
    name: "claude.revert",
    summary:
      "Put back the tests a Claude run changed, as they were before it; refuses (naming them) when a test was edited after the run, unless force.",
    input: z.object({
      runId: z.string().describe("The runId returned by claude.run (or gen/review runs)."),
      force: z.boolean().optional().describe("Also discard the edits made to those tests after the run."),
    }),
    output: z.object({
      reverted: z.array(z.string()).describe("Tests put back"),
      files: z
        .array(z.string())
        .describe("Other files put back (project.json, a document's files), relative to the project folder"),
    }),
    mutates: true,
    positional: ["runId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const reverted = revert(project, input.runId, { force: input.force === true });
      return { reverted, files: readRun(project, input.runId).revertedFiles ?? [] };
    },
  }),
  command({
    name: "claude.before",
    summary:
      "A test as it was before the latest Claude run that changed it, while that change stands (the run finished, was not reverted, and the test was not synced with Jira since); null when there is none.",
    input: z.object({ testId: TEST_ID }),
    output: z
      .object({
        runId: z.string().describe("The run, to revert it with claude.revert"),
        at: z.string().describe("When the run started (ISO)"),
        kind: z.string().optional().describe("What ran: the chat, a fix, an action…"),
        label: z.string().optional().describe("The run's own title, when it has one"),
        steps: z.array(z.number()).describe("The steps the run changed, by number, as it left the test"),
        untouched: z
          .boolean()
          .describe("test.md is still as the run left it: every difference from `test` is the run's"),
        test: TEST.describe("The test as test.md said it before the run"),
      })
      .nullable(),
    mutates: false,
    positional: ["testId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const found = standingRun(project, input.testId);
      if (!found) return null;
      const { rec, md } = found;
      return {
        runId: rec.runId,
        at: rec.at,
        ...(rec.kind ? { kind: rec.kind } : {}),
        ...(rec.label ? { label: rec.label } : {}),
        steps: rec.changedSteps[input.testId] ?? [],
        untouched: leftAsIs(project, rec, input.testId),
        test: parseTest(
          md,
          readXray(project).fields.map((f) => f.name),
        ).test,
      };
    },
  }),
  command({
    name: "claude.draftComment",
    summary:
      "Claude drafts a comment for a test's Jira issue (it reads the test, the thread and the documents) and gives it back as text — it posts nothing; the person sends it with issue.comment. Mentions are written @[Name](accountId).",
    input: z.object({
      key: z.string().describe("Issue key of the test, e.g. LFRPS12-1420"),
      ask: z.string().default("").describe("What the comment should say (empty: answer the thread)"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)."),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)."),
      contexts: CONTEXT_IDS.optional().describe("Saved context ids Claude reads first (default: none)."),
    }),
    output: z.object({
      ok: z.boolean().describe("Whether Claude drafted something"),
      text: z.string().describe("The draft, or why it failed"),
      mentions: z
        .array(z.object({ accountId: z.string().describe("Jira account id"), name: z.string().describe("Name") }))
        .describe("The people the draft mentions"),
      costUsd: z.number().optional().describe("What the run cost"),
      tokens: TOKENS.optional(),
      diagnosis: DIAGNOSIS.optional(),
      raw: z.string().optional().describe("Claude's raw output (stdout and stderr), for « Show raw output »"),
    }),
    mutates: true,
    job: "comment-draft",
    positional: ["key"],
    subject: (i) => i.key,
    label: (i, project) => testName(project, i.key),
    async run(ctx, input) {
      return draftComment({
        project: projectOf(ctx),
        key: input.key.trim().toUpperCase(),
        ask: input.ask,
        model: input.model,
        effort: input.effort,
        contexts: input.contexts,
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
  command({
    name: "claude.prompts",
    summary:
      "Everything Claude is given in this project, run by run: the project's skills (the team's too), each prompt Testimus builds (as its template, the parts filled per run in {braces}), CLAUDE.md and the contexts attached by default — read only.",
    input: z.object({}),
    output: z.array(
      z.object({
        id: z
          .string()
          .describe("Stable id: skill:<name>, file:CLAUDE.md, context:<id>, or the id of a prompt Testimus builds"),
        name: z.string().describe("What it is, in words (« Generate tests »)"),
        group: z
          .string()
          .describe("What it is used for: Generation, Check and fix, Tests, Documents, Chat, Every run, Team skills…"),
        origin: z
          .enum(["skill", "built", "file", "context"])
          .describe(
            "skill: a .claude/skills/<name>/SKILL.md of the project · built: written by Testimus for each run · file: a project file every run reads (CLAUDE.md) · context: a context attached by default",
          ),
        path: z
          .string()
          .optional()
          .describe(
            "Where it is, relative to the project folder (absolute for a shared context); none for a prompt built per run",
          ),
        file: z.string().optional().describe("Its absolute path, for Show in Explorer"),
        usedBy: z.array(z.string()).describe("The screens and commands that send it to Claude"),
        text: z
          .string()
          .describe("The full text; a prompt Testimus builds shows its template, the parts filled per run in {braces}"),
      }),
    ),
    mutates: false,
    async run(ctx) {
      return listPrompts(projectOf(ctx));
    },
  }),
  command({
    name: "claude.status",
    summary: "Is Claude Code installed (version) and signed in; what to run to connect it.",
    input: z.object({
      signIn: z
        .boolean()
        .optional()
        .describe("Also check the sign-in with a tiny real `claude -p` run (costs a few tokens)."),
      refresh: z.boolean().optional().describe("Ask `claude --version` again instead of the remembered answer."),
    }),
    output: STATUS,
    mutates: false,
    global: true,
    async run(ctx, input) {
      const v = await claudeVersion(input.refresh === true, ctx.signal);
      const base = { exe: claudeExe(), connect: CONNECT };
      if (!v.ok) return { ...base, installed: false, signedIn: false, detail: v.text, diagnosis: diagnose(v.text) };
      const version = v.text.match(/\d+\.\d+\.\d+/)?.[0];
      if (!input.signIn) return { ...base, installed: true, version, signedIn: null, detail: v.text };
      const s = await checkSignedIn(ctx.signal);
      return { ...base, installed: true, version, signedIn: s.signedIn, detail: s.text, diagnosis: s.diagnosis };
    },
  }),
];
