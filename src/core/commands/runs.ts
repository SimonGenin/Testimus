import { z } from "zod";
import { command, projectOf } from "../command.ts";
import { osUser } from "../lib/review.ts";
import { createRun, pickTests } from "../lib/run-create.ts";
import { addComment, attachCapture, detachCapture, setResult } from "../lib/run-results.ts";
import {
  countsOf,
  listRuns,
  type RunResult,
  readRunFile,
  removeRun,
  resultView,
  runView,
  testHistory,
} from "../lib/runs.ts";
import { localTestRef } from "../lib/store.ts";
import { REVIEW } from "../schemas.ts";
import { commands as pages } from "./runs-pages.ts";
import {
  ATTACHMENT,
  COMMENT,
  COUNTS,
  FROZEN_TEST,
  RESULT_VIEW,
  RUN,
  RUN_HEAD,
  RUN_TEST,
  STATUS,
  SUMMARY,
} from "./runs-schemas.ts";

const changed = z.object({
  test: z.string().describe("The test of the run that changed (its id)"),
  result: RESULT_VIEW.describe("Its result as now written"),
});
const viewed = <T extends { result: RunResult }>(o: T) => ({ ...o, result: resultView(o.result) });

export const commands = [
  command({
    name: "runs.list",
    summary:
      "The test runs of the project (test-runs/<run>/), newest first: name, version, environment, who made it, how many tests passed, have a problem, are blocked or not run, open questions, finished or not; and who records results from here.",
    input: z.object({}),
    output: z.object({
      runs: z.array(SUMMARY).describe("Every run, newest first"),
      user: z.string().describe("Who records results from here: the name a result written now is stamped with"),
    }),
    mutates: false,
    run: async (ctx) => ({ runs: listRuns(projectOf(ctx)), user: osUser() }),
  }),

  command({
    name: "runs.show",
    summary:
      "One run with its frozen tests (each as it was when the run was made: summary, preconditions, steps with their columns) and each test's result: status, OK / NOK per step with notes, blocked reason, comments and questions, screenshots.",
    input: z.object({ run: RUN }),
    output: z.object({
      ...RUN_HEAD,
      counts: COUNTS,
      tests: z
        .array(FROZEN_TEST.extend({ result: RESULT_VIEW }))
        .describe("The tests in run order, each with its result"),
    }),
    mutates: false,
    positional: ["run"],
    run: async (ctx, input) => {
      const view = runView(projectOf(ctx), input.run);
      return {
        ...view,
        counts: countsOf(view.tests.map((t) => t.result)),
        tests: view.tests.map((t) => ({ ...t, result: resultView(t.result) })),
      };
    },
  }),

  command({
    name: "runs.create",
    summary:
      "Make a test run: a frozen copy of the tests named, or of every test of a folder, holding one of the labels, or in a review state, written to test-runs/<run>/run.json (with copies of their pictures). A test edited later does not change the run. With dryRun, only says which tests it would hold.",
    input: z.object({
      name: z
        .string()
        .describe(
          "The run's name (« Recette J5 — Sectionneurs »); its folder name comes from it (a dry run ignores it)",
        ),
      version: z.string().optional().describe("The version under test (« SOSIE 2.4.0-rc2 »)"),
      environment: z.string().optional().describe("Where it is run (« Simulator room B »)"),
      tests: z.array(z.string()).optional().describe("Test ids or Jira keys to put in the run"),
      folder: z.string().optional().describe("Add every test of this Xray folder and below (« / » = all)"),
      labels: z.array(z.string()).optional().describe("Add every test holding one of these labels"),
      review: z.array(REVIEW).optional().describe("Add every test in one of these review states"),
      dryRun: z.boolean().optional().describe("Only list the tests it would hold; nothing is written"),
    }),
    output: z.object({
      slug: z.string().optional().describe("The new run's folder under test-runs/ (absent on a dry run)"),
      dryRun: z.boolean().describe("Nothing was written"),
      tests: z
        .array(
          z.object({
            id: z.string().describe("Test id"),
            key: z.string().optional().describe("Its Jira key"),
            summary: z.string().describe("Its summary"),
          }),
        )
        .describe("The tests of the run, in order"),
    }),
    mutates: true,
    positional: ["name"],
    subject: (i) => i.name,
    run: async (ctx, input) => {
      const project = projectOf(ctx);
      const ids = pickTests(project, input);
      const tests = ids.map((id) => {
        const r = localTestRef(project, id);
        return { id, ...(r?.key ? { key: r.key } : {}), summary: r?.summary ?? id };
      });
      if (input.dryRun) return { dryRun: true, tests };
      const slug = createRun(project, { ...input, ids });
      return { slug, dryRun: false, tests };
    },
  }),

  command({
    name: "runs.setResult",
    summary:
      "Record what the tester found on one test of a run: its result (passed, problem, blocked with its reason, not-run) and OK / NOK per step with a note on what happened. Only what is given changes. A person's decision: never a Claude run's.",
    input: z.object({
      run: RUN,
      test: RUN_TEST,
      status: STATUS.optional(),
      steps: z
        .array(
          z.object({
            step: z.number().int().describe("Step number, 1-based"),
            ok: z.boolean().nullable().describe("true = OK, false = NOK, null = clear the mark"),
            note: z.string().optional().describe("What happened (empty clears it; absent keeps it)"),
          }),
        )
        .optional()
        .describe("The steps whose mark changes"),
      blockedReason: z
        .string()
        .nullable()
        .optional()
        .describe("Why the test cannot be run (required for blocked; empty or null clears it)"),
    }),
    output: changed,
    mutates: true,
    positional: ["run", "test"],
    subject: (i) => `${i.run} ${i.test}`,
    run: async (ctx, input) => viewed(setResult(projectOf(ctx), input.run, input.test, input)),
  }),

  command({
    name: "runs.comment",
    summary:
      "Add a comment or a question to a test of a run (optionally about one step), or answer a question (answers = its id). A question stays open until answered.",
    input: z.object({
      run: RUN,
      test: RUN_TEST,
      text: z.string().describe("The comment, the question, or the answer"),
      kind: z.enum(["comment", "question"]).default("comment").describe("comment (default) or question"),
      step: z.number().int().optional().describe("The step it is about, 1-based (absent: the whole test)"),
      answers: z.string().optional().describe("The id of the question this text answers"),
    }),
    output: changed.extend({ comment: COMMENT.describe("The comment added, or the question answered") }),
    mutates: true,
    positional: ["run", "test", "text"],
    subject: (i) => `${i.run} ${i.test}`,
    run: async (ctx, input) => viewed(addComment(projectOf(ctx), input.run, input.test, input)),
  }),

  command({
    name: "runs.attach",
    summary:
      "Add a screenshot to a test of a run (optionally to one step): a picture file (absolute path) or pasted data is copied into test-runs/<run>/results/<testId>/.",
    input: z.object({
      run: RUN,
      test: RUN_TEST,
      step: z.number().int().optional().describe("The step it shows, 1-based"),
      file: z.string().optional().describe("The picture to copy: its absolute path"),
      dataBase64: z.string().optional().describe("The picture itself, base64 (a data: URL prefix is accepted)"),
      name: z.string().optional().describe("Its original file name (gives the extension of pasted data)"),
    }),
    output: changed.extend({ attachment: ATTACHMENT.describe("The screenshot added") }),
    mutates: true,
    positional: ["run", "test"],
    subject: (i) => `${i.run} ${i.test}`,
    run: async (ctx, input) => viewed(attachCapture(projectOf(ctx), input.run, input.test, input)),
  }),

  command({
    name: "runs.detach",
    summary: "Take a screenshot off a test of a run: its entry and its file under test-runs/<run>/results/<testId>/.",
    input: z.object({
      run: RUN,
      test: RUN_TEST,
      file: z.string().describe("The screenshot's file name (capture-<8hex>.<ext>), as runs.show lists it"),
    }),
    output: changed.extend({ attachment: ATTACHMENT.describe("The screenshot taken off") }),
    mutates: true,
    positional: ["run", "test", "file"],
    subject: (i) => `${i.run} ${i.test}`,
    run: async (ctx, input) => viewed(detachCapture(projectOf(ctx), input.run, input.test, input.file)),
  }),

  command({
    name: "runs.history",
    summary:
      "One test in every run that holds it (by its id or Jira key), newest run first: the run, when it was made, the result it got, who recorded it and when.",
    input: z.object({ test: RUN_TEST }),
    output: z.object({
      runs: z
        .array(
          z.object({
            run: z.string().describe("The run's folder under test-runs/"),
            name: z.string().describe("The run's name"),
            createdAt: z.string().describe("When the run was made (ISO)"),
            status: STATUS,
            updatedAt: z.string().optional().describe("When the result last changed (ISO)"),
            updatedBy: z.string().optional().describe("Who changed it last"),
          }),
        )
        .describe("Every run holding the test, newest first"),
    }),
    mutates: false,
    positional: ["test"],
    run: async (ctx, input) => ({ runs: testHistory(projectOf(ctx), input.test) }),
  }),

  command({
    name: "runs.remove",
    summary:
      "Delete a test run: its folder test-runs/<run>/ with every result, comment and screenshot. The tests themselves are not touched.",
    input: z.object({ run: RUN }),
    output: z.object({
      run: z.string().describe("The run deleted"),
      name: z.string().describe("Its name"),
    }),
    mutates: true,
    positional: ["run"],
    subject: (i) => i.run,
    run: async (ctx, input) => {
      const project = projectOf(ctx);
      const { name } = readRunFile(project, input.run);
      removeRun(project, input.run);
      return { run: input.run, name };
    },
  }),
  ...pages,
];
