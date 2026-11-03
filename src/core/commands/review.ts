import { z } from "zod";
import { fixTest } from "../claude/fix.ts";
import { needTest, reviewQueue } from "../claude/review.ts";
import { CHECK_FILE, DIAGNOSIS, REVIEW, TEST_REF } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { osUser, setReview, testEvidence } from "../lib/check.ts";

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
});

export const commands = [
  command({
    name: "review.set",
    summary:
      "Record the reviewer's decision on a test: validate (review: validated) or to-fix with a note (review: to-fix); stamps reviewed_by and reviewed_at.",
    input: z.object({
      id: TEST_REF,
      decision: z
        .enum(["validate", "to-fix"])
        .describe("validate = the test is right; to-fix = it needs changes (note required)"),
      note: z.string().optional().describe("What to fix, in the reviewer's words (required for to-fix)"),
    }),
    output: z.object({
      id: z.string(),
      review: REVIEW,
      reviewNote: z.string().optional(),
      reviewedBy: z.string().optional(),
      reviewedAt: z.string().optional(),
    }),
    mutates: true,
    positional: ["id", "decision"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      const note = input.note?.trim() || null;
      if (input.decision === "to-fix" && !note)
        throw new UserError("A To fix decision needs a note.", 'Say what is wrong, e.g. --note "Step 2 must check …".');
      const t = setReview(project, input.id, {
        review: input.decision === "validate" ? "validated" : "to-fix",
        note,
        by: osUser(),
        at: env.now().toISOString(),
      });
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
      "The generated tests awaiting review — checked, to-fix, and draft (flagged unchecked when no check ran) — with their findings counts; filter by state (validated lists the generated tests already reviewed), folder, anomalies; sort. A test written by hand, pulled or imported never appears here.",
    input: z.object({
      state: z.array(REVIEW).optional().describe("Only these review states (default: checked, to-fix, draft)"),
      folder: z.string().optional().describe("Only this Xray folder and its subfolders"),
      withFindings: z.boolean().optional().describe("Only tests whose last check has an error or a warning"),
      sort: z
        .enum(["state", "anomalies", "folder", "recent"])
        .default("state")
        .describe(
          "state = checked, then to-fix, then draft (most anomalies first within each); anomalies = errors then warnings; folder; recent = last edited first",
        ),
    }),
    output: z.object({
      tests: z.array(queueItem),
      counts: z.object({
        checked: z.number(),
        toFix: z.number(),
        draft: z.number(),
        unchecked: z.number(),
        validated: z.number().describe("Generated tests already validated (not in the default list)"),
      }),
    }),
    mutates: false,
    async run(ctx, input) {
      return reviewQueue(projectOf(ctx), input);
    },
  }),

  command({
    name: "review.fix",
    summary:
      "Ask Claude to fix a test (fix-test skill) from its To fix note and its findings, then re-check it; it goes back to checked, never straight to validated. Returns the runId for Revert.",
    input: z.object({
      id: TEST_REF,
      note: z.string().optional().describe("The request (default: the test's review_note)"),
      semantic: z.boolean().default(true).describe("Re-check with the check-test skill too (default true)"),
    }),
    output: z.object({
      ok: z.boolean(),
      runId: z.string(),
      summary: z.string(),
      changedSteps: z.array(z.number()),
      changedTests: z
        .array(z.string())
        .optional()
        .describe("Tests whose file changed (also when only the header did, so the editor reloads)"),
      review: REVIEW,
      check: CHECK_FILE.nullable(),
      message: z.string().optional().describe("Why the test did not go back to checked (re-check failed or skipped)"),
      diagnosis: DIAGNOSIS.optional(),
    }),
    mutates: true,
    job: "fix",
    positional: ["id"],
    subject: (i) => i.id,
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      return await fixTest(ctx, project, input.id, { note: input.note, semantic: input.semantic });
    },
  }),
  command({
    name: "review.evidence",
    summary:
      "What the generation of a test really read (its evidence ledger): the passages it opened, each marked cited or not, and the searches it made — « sources read ».",
    input: z.object({ testId: TEST_REF }),
    output: z.object({
      testId: z.string().describe("The test"),
      jobId: z
        .string()
        .nullable()
        .describe("The generation job that wrote it (generated_by); null when it has no evidence ledger"),
      consulted: z
        .array(z.string())
        .describe("Every docId#anchor the generation opened, from its tool calls (.testimus/gen/<job>.json)"),
      read: z
        .array(
          z.object({
            ref: z.string().describe("docId#anchor opened by the generation"),
            title: z.string().describe("Section title or figure caption"),
            cited: z.boolean().describe("A step's Sources cite it or one of its sub-sections"),
          }),
        )
        .describe("Sources read"),
      searched: z
        .array(
          z.object({
            tool: z.string().describe("rag_search, rag_mentions or Grep"),
            query: z.string().describe("What was searched"),
          }),
        )
        .describe("The searches the generation made"),
    }),
    mutates: false,
    positional: ["testId"],
    run: async (ctx, input) => {
      const project = projectOf(ctx);
      needTest(project, input.testId);
      return testEvidence(project, input.testId);
    },
  }),
];
