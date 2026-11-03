import { z } from "zod";
import { diagnose } from "../claude/diagnose.ts";
import { buildPrompt, EDIT_MARKER, effectiveContexts, projectContexts, readContexts } from "../claude/prompt.ts";
import { runClaude } from "../claude/run.ts";
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
} from "../claude/schemas.ts";
import { readRun, revert } from "../claude/snapshot.ts";
import { CONNECT, checkSignedIn, claudeExe, claudeVersion } from "../claude/status.ts";
import { command, projectOf } from "../command.ts";
import { readProject } from "../lib/project.ts";

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
      scope: SCOPE.describe("What Claude may edit: { kind: step|test|tests|project, testId?, step?, testIds? }."),
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
    async run(ctx, input) {
      const project = projectOf(ctx);
      const p = readProject(project);
      const ids =
        input.contexts ??
        (input.scope.kind === "project"
          ? projectContexts(project)
          : effectiveContexts(project, "testId" in input.scope ? input.scope.testId : undefined));
      ctx.progress({ message: `Claude on ${scopeLabel(input.scope)}` });
      const prompt = buildPrompt(
        input.scope,
        input.prompt,
        readContexts(project, ids),
        project,
        input.note,
        input.conversation,
      );
      const { calls: _calls, ...r } = await runClaude({
        kind: "run",
        project,
        prompt: input.scope.kind === "project" ? prompt : `${EDIT_MARKER}\n${prompt}`,
        model: input.model || p.claude.model,
        effort: input.effort || p.claude.effort,
        scope: input.scope,
        contexts: ids,
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
      return r;
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
