import { z } from "zod";
import { fixTest } from "../claude/fix.ts";
import { command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { osUser, setReview, testEvidence } from "../lib/check.ts";
import { listLocalTests, readTest, testExists } from "../lib/store.ts";
import { type LocalTestRef, REVIEWS, type Review } from "../types.ts";
import { checkFile } from "./check.ts";

const id = z.string().describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");
const review = z.enum(REVIEWS as [Review, ...Review[]]);
const AWAITING: Review[] = ["checked", "to-fix", "draft"];
const STATE_RANK: Record<Review, number> = { checked: 0, "to-fix": 1, draft: 2, validated: 3 };

const needTest = (project: string, t: string) => {
  if (!testExists(project, t))
    throw new UserError(`No test ${t} in this project.`, "testimus tests list shows the tests.");
};

const inFolder = (folder: string, f: string) => {
  const root = f.replace(/\/+$/, "");
  return root === "" || folder === root || folder.startsWith(`${root}/`);
};

const queueItem = z.object({
  id: z.string(),
  key: z.string().optional(),
  summary: z.string(),
  folder: z.string(),
  review,
  note: z.string().optional(),
  edited: z.boolean().describe("Its content changed since the generation wrote it"),
  unchecked: z.boolean(),
  errors: z.number(),
  warnings: z.number(),
  infos: z.number(),
  stale: z.boolean(),
  mtime: z.number(),
});
type QueueItem = z.infer<typeof queueItem>;

function itemOf(project: string, t: LocalTestRef): QueueItem {
  const note = t.review === "to-fix" ? readTest(project, t.id).test.reviewNote : undefined;
  return {
    id: t.id,
    ...(t.key ? { key: t.key } : {}),
    summary: t.summary,
    folder: t.folder,
    review: t.review,
    ...(note ? { note } : {}),
    edited: t.edited,
    unchecked: !t.findings,
    errors: t.findings?.errors ?? 0,
    warnings: t.findings?.warnings ?? 0,
    infos: t.findings?.infos ?? 0,
    stale: t.findings?.stale ?? false,
    mtime: t.mtime,
  };
}

const byId = (a: QueueItem, b: QueueItem) => a.id.localeCompare(b.id, "en", { numeric: true });
const byAnomalies = (a: QueueItem, b: QueueItem) => b.errors - a.errors || b.warnings - a.warnings;
const byState = (a: QueueItem, b: QueueItem) => STATE_RANK[a.review] - STATE_RANK[b.review];
const SORTS: Record<string, (a: QueueItem, b: QueueItem) => number> = {
  state: (a, b) => byState(a, b) || byAnomalies(a, b) || byId(a, b),
  anomalies: (a, b) => byAnomalies(a, b) || byState(a, b) || byId(a, b),
  folder: (a, b) => a.folder.localeCompare(b.folder) || byState(a, b) || byId(a, b),
  recent: (a, b) => b.mtime - a.mtime || byId(a, b),
};

export const commands = [
  command({
    name: "review.set",
    summary:
      "Record the reviewer's decision on a test: validate (review: validated) or to-fix with a note (review: to-fix); stamps reviewed_by and reviewed_at.",
    input: z.object({
      id,
      decision: z
        .enum(["validate", "to-fix"])
        .describe("validate = the test is right; to-fix = it needs changes (note required)"),
      note: z.string().optional().describe("What to fix, in the reviewer's words (required for to-fix)"),
    }),
    output: z.object({
      id: z.string(),
      review,
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
      state: z.array(review).optional().describe("Only these review states (default: checked, to-fix, draft)"),
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
      const project = projectOf(ctx);
      const states = input.state?.length ? input.state : AWAITING;
      const generated = listLocalTests(project)
        .filter((t) => t.generated)
        .map((t) => itemOf(project, t));
      const awaiting = generated.filter((t) => t.review !== "validated");
      const tests = generated
        .filter((t) => states.includes(t.review))
        .filter((t) => input.folder === undefined || inFolder(t.folder, input.folder))
        .filter((t) => !input.withFindings || t.errors + t.warnings > 0)
        .sort(SORTS[input.sort]);
      const n = (r: Review) => awaiting.filter((t) => t.review === r).length;
      return {
        tests,
        counts: {
          checked: n("checked"),
          toFix: n("to-fix"),
          draft: n("draft"),
          unchecked: awaiting.filter((t) => t.unchecked).length,
          validated: generated.length - awaiting.length,
        },
      };
    },
  }),

  command({
    name: "review.fix",
    summary:
      "Ask Claude to fix a test (fix-test skill) from its To fix note and its findings, then re-check it; it goes back to checked, never straight to validated. Returns the runId for Revert.",
    input: z.object({
      id,
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
      review,
      check: checkFile.nullable(),
      message: z.string().optional().describe("Why the test did not go back to checked (re-check failed or skipped)"),
      diagnosis: z.object({ kind: z.string(), title: z.string(), detail: z.string() }).optional(),
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
    input: z.object({ testId: id }),
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
