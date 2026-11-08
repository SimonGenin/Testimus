import { z } from "zod";
import { type ClaudeScope, type Effort, type FindingKind, REVIEWS, type Review } from "../types.ts";

// ponytail: the schemas every command that starts Claude shares — this module imports nothing of the app but its
// types, so no command file imports another command file (the registry cycle)

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly Effort[];

export const MODEL_RE = /^[A-Za-z0-9.\-[\]:]+$/;

export const EFFORT = z.enum(EFFORTS);

export const MODEL = z.string().regex(MODEL_RE, "A model alias or id: letters, digits and . - [ ] : only");

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
  z.object({
    kind: z.literal("run").describe("A test run, read only: the run, one of its tests, or one step of it."),
    run: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "A run: its folder under test-runs/")
      .describe("The run: its folder under test-runs/."),
    testId: TEST_ID.optional().describe("One test of the run (its id when the run was made)."),
    step: z.number().int().min(1).optional().describe("One step of that test, 1-based."),
  }),
  z.object({ kind: z.literal("project").describe("The whole project: every test, every document.") }),
]);

export const DIAGNOSIS = z
  .object({
    kind: z
      .enum(["connect", "login", "credit", "limit", "network", "other"])
      .describe("connect = Claude Code missing, login = not signed in, credit, limit, network, or other"),
    title: z.string().describe("What went wrong, in plain words"),
    detail: z.string().describe("What to do about it"),
  })
  .describe("Why a Claude run failed, in plain words, when it did");

export const TOKENS = z
  .object({
    input: z.number().describe("Input tokens, cache included"),
    output: z.number().describe("Output tokens"),
  })
  .describe("Tokens the run used (input incl. cache)");

export const RESULT = z.object({
  runId: z.string().describe("The run id — claude.revert takes it"),
  ok: z.boolean().describe("Whether the run finished and Claude answered"),
  summary: z.string().describe("Claude's final reply, or why the run failed"),
  durationMs: z.number().describe("How long the run took"),
  costUsd: z.number().optional().describe("What the run cost, as Claude Code reports it"),
  tokens: TOKENS.optional(),
  sessionId: z.string().optional().describe("The Claude Code session, to resume it"),
  changedTests: z.array(z.string()).describe("Tests whose file the run changed"),
  written: z.array(z.string()).describe("Tests the run itself wrote (its tool calls)"),
  changedSteps: z.record(z.string(), z.array(z.number())).describe("For each changed test, the steps that changed"),
  diagnosis: DIAGNOSIS.optional(),
  raw: z.string().describe("The end of what claude printed, for the log"),
});

export const REVIEW = z.enum(REVIEWS as [Review, ...Review[]]).describe("draft, to-fix or validated");

export const TEST_REF = z
  .string()
  .describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");

export const FINDING_KINDS: [FindingKind, ...FindingKind[]] = [
  "source-missing",
  "quote-not-found",
  "unsupported",
  "contradicted",
  "wrong-object",
  "negative-missing",
  "case-missing",
  "not-simulated-unsourced",
  "vague-result",
  "documents-conflict",
  "empty-field",
  "raw-embed",
  "duplicate-step",
  "figure-not-embedded",
  "column-unsourced",
  "item-not-found",
  "other",
];

export const SEVERITY = z
  .enum(["error", "warning", "info"])
  .describe(
    "error = a tester would pass a wrong behavior or fail a right one; warning = a gap or a vague result the reviewer decides on; info = never for a remark or a suggestion (those are not recorded)",
  );

const FINDING = z.object({
  step: z.number().int().min(1).optional().describe("Step number (1-based); absent for the whole test"),
  kind: z.enum(FINDING_KINDS).describe("Finding kind"),
  severity: SEVERITY,
  message: z.string().describe("The exact discrepancy, in one sentence in the project language"),
  sources: z.array(z.string()).describe("The anchors that prove it: docId#anchor"),
  pass: z.enum(["mechanical", "semantic"]).optional().describe("Which pass found it"),
});

export const CHECK_FILE = z
  .object({
    at: z.string().describe("When the test was checked"),
    testHash: z.string().describe("The hash of test.md the check is about: another hash means the check is stale"),
    findings: z.array(FINDING).describe("Every finding of the check, mechanical and semantic"),
  })
  .describe("A test's last check (tests/<id>/check.json)");

export function scopeLabel(s: ClaudeScope): string {
  if (s.kind === "doc") return s.docId;
  if (s.kind === "step") return `${s.testId} step ${s.step}`;
  if (s.kind === "test") return s.testId;
  if (s.kind === "tests") return `${s.testIds.length} tests`;
  if (s.kind === "run") return [`run ${s.run}`, s.testId, s.step && `step ${s.step}`].filter(Boolean).join(" ");
  return "project";
}
