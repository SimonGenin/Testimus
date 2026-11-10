import { z } from "zod";
import { fixTest } from "../claude/fix.ts";
import { decide, needTest, reviewQueue } from "../claude/review.ts";
import { CHECK_FILE, CONTEXT_IDS, DIAGNOSIS, REVIEW, TEST_REF, WITHOUT } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";
import { testName } from "../lib/names.ts";

const queueItem = z.object({
  id: z.string().describe("Test id"),
  key: z.string().optional().describe("Its Jira key, once pushed"),
  summary: z.string().describe("The test's summary"),
  folder: z.string().describe("Its Xray folder"),
  review: REVIEW,
  note: z.string().optional().describe("The reviewer's To fix note"),
  edited: z.boolean().describe("Its content changed since the generation wrote it"),
  unchecked: z.boolean().describe("No check ran on it yet"),
  errors: z.number().describe("Errors of its last check"),
  warnings: z.number().describe("Warnings of its last check"),
  infos: z.number().describe("Infos of its last check"),
  stale: z.boolean().describe("The test changed since its last check"),
  mtime: z.number().describe("When test.md was last written (ms since 1970)"),
  generatedBy: z.string().optional().describe("The generation that wrote it (generated_by: its job id)"),
  generatedAt: z
    .string()
    .optional()
    .describe("When that generation started (ISO), from its ledger .testimus/gen/<id>.json; absent without one"),
});

export const commands = [
  command({
    name: "review.set",
    summary:
      "Record the reviewer's decision on a test: validate (review: validated) or to-fix with a note (review: to-fix), stamping reviewed_by and reviewed_at; draft takes a decision back (review: draft, the note and the stamp removed).",
    input: z.object({
      id: TEST_REF,
      decision: z
        .enum(["validate", "to-fix", "draft"])
        .describe(
          "validate = the test is right; to-fix = it needs changes (note required); draft = no decision any more: back to awaiting review",
        ),
      note: z.string().optional().describe("What to fix, in the reviewer's words (required for to-fix)"),
    }),
    output: z.object({
      id: z.string().describe("Test id"),
      review: REVIEW,
      reviewNote: z.string().optional().describe("The reviewer's note (to-fix)"),
      reviewedBy: z.string().optional().describe("Who decided"),
      reviewedAt: z.string().optional().describe("When"),
    }),
    mutates: true,
    positional: ["id", "decision"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      const t = decide(project, input.id, input.decision, input.note);
      return {
        id: input.id,
        review: t.review,
        ...(t.reviewNote ? { reviewNote: t.reviewNote } : {}),
        ...(t.reviewedBy ? { reviewedBy: t.reviewedBy } : {}),
        ...(t.reviewedAt ? { reviewedAt: t.reviewedAt } : {}),
      };
    },
  }),

  command({
    name: "review.queue",
    summary:
      "The generated tests awaiting review — draft and to-fix (flagged unchecked when no check ran) — with their findings counts; filter by state (validated lists the generated tests already reviewed), folder, anomalies; sort. A test written by hand, pulled or imported never appears here.",
    input: z.object({
      state: z.array(REVIEW).optional().describe("Only these review states (default: draft, to-fix)"),
      folder: z.string().optional().describe("Only this Xray folder and its subfolders"),
      withFindings: z.boolean().optional().describe("Only tests whose last check has an error or a warning"),
      sort: z
        .enum(["state", "anomalies", "folder", "recent"])
        .default("state")
        .describe(
          "state = draft, then to-fix (most anomalies first within each); anomalies = errors then warnings; folder; recent = last edited first",
        ),
    }),
    output: z.object({
      tests: z.array(queueItem).describe("The tests listed, in the order asked"),
      counts: z
        .object({
          toFix: z.number().describe("Generated tests to fix"),
          draft: z.number().describe("Generated drafts, awaiting the reviewer"),
          unchecked: z.number().describe("Awaiting tests no check ran on"),
          validated: z.number().describe("Generated tests already validated (not in the default list)"),
        })
        .describe("How many generated tests are in each state"),
    }),
    mutates: false,
    async run(ctx, input) {
      return reviewQueue(projectOf(ctx), input);
    },
  }),

  command({
    name: "review.fix",
    summary:
      "Ask Claude to fix a test (fix-test skill) from its To fix note and its findings, then re-check it; it goes back to draft for the reviewer, never straight to validated. With a note, the test is first marked To fix with that note (what review.set to-fix does). Returns the runId for Revert.",
    input: z.object({
      id: TEST_REF,
      note: z
        .string()
        .optional()
        .describe(
          "What to fix, in the reviewer's words: the test is marked To fix with it first (default: the test's review_note)",
        ),
      semantic: z.boolean().default(true).describe("Re-check with the check-test skill too (default true)"),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids for this run, in place of the ones its subject attaches (a test's or a document's own list, else the project's defaults; claude.preview shows them).",
      ),
      without: WITHOUT,
    }),
    output: z.object({
      ok: z.boolean().describe("Whether Claude's fix run finished"),
      runId: z.string().describe("The fix run, for claude.revert"),
      summary: z.string().describe("Claude's reply"),
      changedSteps: z.array(z.number()).describe("The steps the fix changed"),
      changedTests: z
        .array(z.string())
        .optional()
        .describe("Tests whose file changed (also when only the header did, so the editor reloads)"),
      review: REVIEW,
      check: CHECK_FILE.nullable().describe("The re-check, or the last check when the fix failed"),
      message: z.string().optional().describe("Why the re-check did not finish (failed, or the mechanical pass only)"),
      diagnosis: DIAGNOSIS.optional(),
    }),
    mutates: true,
    job: "fix",
    positional: ["id"],
    subject: (i) => i.id,
    label: (i, project) => testName(project, i.id),
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      if (input.note?.trim()) decide(project, input.id, "to-fix", input.note);
      return await fixTest(ctx, project, input.id, input);
    },
  }),
];
