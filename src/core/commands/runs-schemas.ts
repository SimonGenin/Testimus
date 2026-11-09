import { z } from "zod";
import { RUN_STATUSES, type RunStatus } from "../lib/runs.ts";

// ponytail: the zod shapes of the runs group — a run, its frozen tests, a test's result — shared by runs.ts and
// runs-pages.ts

export const RUN = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "A run: its folder under test-runs/ (lowercase letters, digits, -)")
  .describe("The run: its folder under test-runs/ (runs.list gives it as slug)");

export const RUN_TEST = z
  .string()
  .describe("A test of the run: its id (the folder it had under tests/) or its Jira key");

export const STATUS = z
  .enum(RUN_STATUSES as [RunStatus, ...RunStatus[]])
  .describe("not-run · passed · problem (a step did not do what it should) · blocked (could not be run)");

export const COUNTS = z
  .object({
    passed: z.number().describe("Tests passed"),
    problem: z.number().describe("Tests with a problem"),
    blocked: z.number().describe("Tests blocked"),
    notRun: z.number().describe("Tests not run yet"),
  })
  .describe("How many tests of the run are in each result");

export const STEP_MARK = z.object({
  ok: z.boolean().nullable().describe("true = OK, false = NOK, null = not marked yet"),
  note: z.string().optional().describe("What happened (on a NOK step)"),
});

export const COMMENT = z.object({
  id: z.string().describe("The comment's id (answering a question names it)"),
  kind: z.enum(["comment", "question"]).describe("comment = a remark; question = stays open until answered"),
  step: z.number().optional().describe("The step it is about, 1-based (absent: the whole test)"),
  text: z.string().describe("What was written"),
  by: z.string().describe("Who wrote it"),
  at: z.string().describe("When (ISO)"),
  answer: z.string().optional().describe("The answer to a question"),
  answeredBy: z.string().optional().describe("Who answered"),
  answeredAt: z.string().optional().describe("When it was answered (ISO)"),
});

export const ATTACHMENT = z.object({
  file: z.string().describe("The screenshot, in results/<testId>/ of the run (capture-<8hex>.<ext>)"),
  step: z.number().optional().describe("The step it shows, 1-based"),
});

const VERSION = z.object({
  status: STATUS,
  steps: z.array(STEP_MARK).describe("The marks it had"),
  blockedReason: z.string().optional().describe("Why it was blocked"),
  updatedAt: z.string().optional().describe("When it was recorded (ISO)"),
  updatedBy: z.string().optional().describe("Who recorded it"),
  replacedAt: z.string().describe("When a newer result replaced it (ISO)"),
});

export const RESULT = z.object({
  status: STATUS,
  steps: z.array(STEP_MARK).describe("One mark per step of the frozen test, in order"),
  blockedReason: z.string().optional().describe("Why the test could not be run (blocked)"),
  comments: z.array(COMMENT).describe("Comments and questions, oldest first"),
  attachments: z.array(ATTACHMENT).describe("Screenshots taken while running it"),
  updatedAt: z.string().optional().describe("When the result last changed (ISO); absent = never touched"),
  updatedBy: z.string().optional().describe("Who changed it last"),
  history: z.array(VERSION).optional().describe("Older results an import replaced (the newer one won)"),
});

export const RESULT_VIEW = RESULT.extend({
  proposed: STATUS.nullable().describe(
    "The result the marks give (a NOK → problem, every step OK → passed) when it differs from the one recorded — the tester picked another since the marks last changed; null otherwise, and for a blocked test — computed, never written",
  ),
  openQuestions: z.number().describe("Its questions not answered yet"),
});

export const FROZEN_TEST = z.object({
  id: z.string().describe("The test's id when the run was made (its folder under tests/)"),
  key: z.string().optional().describe("Its Jira key, if it had one"),
  folder: z
    .string()
    .optional()
    .describe("Its Xray folder when the run was made (absent in runs made before it was kept)"),
  summary: z.string().describe("Its summary"),
  description: z.string().optional().describe("Its description"),
  preconditions: z.array(z.string()).describe("Its preconditions (Jira keys)"),
  steps: z
    .array(
      z.object({
        fields: z.record(z.string(), z.string()).describe("Each filled column of the step, in the columns' order"),
        images: z
          .array(z.string())
          .describe(
            "Pictures the step shows (images/<file>); the run's copy is test-runs/<run>/images/<testId>/<file>",
          ),
        sources: z
          .array(
            z.object({
              docId: z.string().describe("The document"),
              anchor: z.string().describe("Where in it (a section, a figure)"),
              quote: z.string().describe("The words the claim rests on, verbatim from doc.md"),
              column: z.string().optional().describe("The column whose item it backs"),
              item: z.string().optional().describe("The item of that column it backs (a requirement code)"),
            }),
          )
          .optional()
          .describe("Where the step's claims come from, as frozen (absent in runs made before they were kept)"),
      }),
    )
    .describe("Its steps as they were"),
});

export const RUN_HEAD = {
  slug: z.string().describe("The run's folder under test-runs/"),
  name: z.string().describe("The run's name"),
  createdAt: z.string().describe("When the run was made (ISO)"),
  createdBy: z.string().describe("Who made it"),
  importedAt: z.string().optional().describe("When results were last imported from pages (ISO)"),
};

export const SUMMARY = z.object({
  ...RUN_HEAD,
  updatedAt: z.string().optional().describe("When a result last changed (ISO)"),
  total: z.number().describe("Tests in the run"),
  counts: COUNTS,
  openQuestions: z.number().describe("Questions not answered yet"),
  finished: z.boolean().describe("Every test has a result (none is not-run)"),
});
