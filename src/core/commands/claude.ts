import { z } from "zod";
import { diagnose } from "../claude/diagnose.ts";
import { buildPrompt, effectiveContexts, readContexts } from "../claude/prompt.ts";
import { runClaude } from "../claude/run.ts";
import { revert } from "../claude/snapshot.ts";
import { CONNECT, checkSignedIn, claudeExe, claudeVersion } from "../claude/status.ts";
import { type Command, command, projectOf } from "../command.ts";
import { readProject } from "../lib/project.ts";
import type { ClaudeScope } from "../types.ts";

export const EFFORT = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const MODEL = z
  .string()
  .regex(/^[A-Za-z0-9.\-[\]:]+$/, "A model alias or id: letters, digits and . - [ ] : only");

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
  z.object({ kind: z.literal("project").describe("Every test of the project.") }),
]);

const DIAGNOSIS = z.object({
  kind: z.enum(["connect", "login", "credit", "limit", "network", "other"]),
  title: z.string(),
  detail: z.string(),
});

const RESULT = z.object({
  runId: z.string(),
  ok: z.boolean(),
  summary: z.string(),
  durationMs: z.number(),
  costUsd: z.number().optional(),
  sessionId: z.string().optional(),
  changedTests: z.array(z.string()),
  written: z.array(z.string()).describe("Tests the run itself wrote (its tool calls)"),
  changedSteps: z.record(z.string(), z.array(z.number())),
  diagnosis: DIAGNOSIS.optional(),
  raw: z.string(),
});

function scopeLabel(s: ClaudeScope): string {
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
      contexts: z
        .array(z.string().regex(/^[\w-]+$/, "A context id: letters, digits, _ and -"))
        .optional()
        .describe("Context ids to attach (default: project.json claude.contexts)."),
    }),
    output: RESULT,
    mutates: true,
    job: "claude",
    subject: (i) => scopeLabel(i.scope),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const p = readProject(project);
      const ids =
        input.contexts ?? effectiveContexts(project, "testId" in input.scope ? input.scope.testId : undefined);
      ctx.progress({ message: `Claude on ${scopeLabel(input.scope)}` });
      const { calls: _calls, ...r } = await runClaude({
        kind: "run",
        project,
        prompt: buildPrompt(input.scope, input.prompt, readContexts(project, ids), project),
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
    output: z.object({ reverted: z.array(z.string()) }),
    mutates: true,
    positional: ["runId"],
    async run(ctx, input) {
      return { reverted: revert(projectOf(ctx), input.runId, { force: input.force === true }) };
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
