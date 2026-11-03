import { z } from "zod";
import { diagnose } from "../claude/diagnose.ts";
import { buildPrompt, effectiveContexts, projectContexts, readContexts } from "../claude/prompt.ts";
import { runClaude } from "../claude/run.ts";
import { readRun, revert } from "../claude/snapshot.ts";
import { CONNECT, checkSignedIn, claudeExe, claudeVersion } from "../claude/status.ts";
import { type Command, command, projectOf } from "../command.ts";
import { readProject } from "../lib/project.ts";
import type { ClaudeScope } from "../types.ts";

export const EFFORT = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const EDIT_MARKER = "Use the edit-test skill for the request below.";

export const MODEL = z
  .string()
  .regex(/^[A-Za-z0-9.\-[\]:]+$/, "A model alias or id: letters, digits and . - [ ] : only");

export const CONTEXT_IDS = z.array(z.string().regex(/^[\w-]+$/, "A context id: letters, digits, _ and -"));

export const NOTE = z
  .string()
  .max(20000)
  .optional()
  .describe("Additional context for this run only, in plain words (said to Claude in full)");

export const CONVERSATION = z
  .string()
  .max(60000)
  .optional()
  .describe(
    "The earlier exchanges of the Claude panel the user has not cleared, as a transcript (said to Claude in full as background)",
  );

const TEST_ID = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "A test id: a Jira key or local-<8hex>")
  .refine((s) => !s.includes(".."), "A test id never contains ..");

export const SCOPE = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("step").describe("One step of one test."),
    testId: TEST_ID.describe("Test folder id (Jira key or local-…)."),
    step: z.number().int().min(1).describe("Step number, 1-based."),
  }),
  z.object({
    kind: z.literal("test").describe("One whole test."),
    testId: TEST_ID.describe("Test folder id (Jira key or local-…)."),
  }),
  z.object({
    kind: z.literal("tests").describe("Several tests."),
    testIds: z.array(TEST_ID).min(1).describe("Test folder ids."),
  }),
  z.object({
    kind: z.literal("doc").describe("One document and the tests that cite it."),
    docId: TEST_ID.describe("Document id (its folder under docs/)."),
  }),
  z.object({ kind: z.literal("project").describe("The whole project: every test, every document.") }),
]);

export const DIAGNOSIS = z.object({
  kind: z.enum(["connect", "login", "credit", "limit", "network", "other"]),
  title: z.string(),
  detail: z.string(),
});

export const RESULT = z.object({
  runId: z.string(),
  ok: z.boolean(),
  summary: z.string(),
  durationMs: z.number(),
  costUsd: z.number().optional(),
  tokens: z
    .object({ input: z.number(), output: z.number() })
    .optional()
    .describe("Tokens the run used (input incl. cache)"),
  sessionId: z.string().optional(),
  changedTests: z.array(z.string()),
  written: z.array(z.string()).describe("Tests the run itself wrote (its tool calls)"),
  changedSteps: z.record(z.string(), z.array(z.number())),
  diagnosis: DIAGNOSIS.optional(),
  raw: z.string(),
});

export function scopeLabel(s: ClaudeScope): string {
  if (s.kind === "doc") return s.docId;
  if (s.kind === "step") return `${s.testId} step ${s.step}`;
  if (s.kind === "test") return s.testId;
  if (s.kind === "tests") return `${s.testIds.length} tests`;
  return "project";
}

export const commands: Command[] = [
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
    output: z.object({
      installed: z.boolean(),
      version: z.string().optional(),
      exe: z.string(),
      signedIn: z.boolean().nullable(),
      detail: z.string(),
      diagnosis: DIAGNOSIS.optional(),
      connect: z.array(z.object({ title: z.string(), cmd: z.string(), hint: z.string() })),
    }),
    mutates: false,
    global: true,
    async run(ctx, input) {
      const v = await claudeVersion(input.refresh === true);
      const base = { exe: claudeExe(), connect: CONNECT };
      if (!v.ok) return { ...base, installed: false, signedIn: false, detail: v.text, diagnosis: diagnose(v.text) };
      const version = v.text.match(/\d+\.\d+\.\d+/)?.[0];
      if (!input.signIn) return { ...base, installed: true, version, signedIn: null, detail: v.text };
      const s = await checkSignedIn(ctx.signal);
      return { ...base, installed: true, version, signedIn: s.signedIn, detail: s.text, diagnosis: s.diagnosis };
    },
  }),
];
