import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CHECK_FILE } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { fileMtime, unchangedSince } from "../lib/atomic.ts";
import { fieldOrder, projectFolds } from "../lib/columns.ts";
import { readProject, readXray } from "../lib/project.ts";
import {
  cloneLocalTest,
  createLocalTest,
  findingCounts,
  inFolder,
  listLocalTests,
  localTestRef,
  readCheck,
  readLocal,
  readTest,
  removeImageFile,
  removeTest,
  syncState,
  testDir,
  testExists,
  writeLocal,
  writeTest,
} from "../lib/store.ts";
import { applyOps, keepReview } from "../lib/test-edit.ts";
import { fieldWarnings, newTest, parseTest } from "../lib/testfile.ts";
import { FINDING_COUNTS, IF_MTIME, REVIEW, SYNC, TEST, TEST_ID, TEST_REF } from "../schemas.ts";
import { awaitsReview, type LocalTestRef } from "../types.ts";

const id = TEST_ID;

const sourceLines = z
  .array(z.string())
  .describe(
    'Source lines, each `<docId>#<anchor> "<exact quote>"`, followed by `@<column> "<item>"` when it backs an item of a smart column — replaces the step\'s sources',
  );

const stepOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set").describe("Set one field of a step; an empty value removes the field"),
    step: z.number().int().describe("Step number, 1-based"),
    field: z
      .string()
      .describe("Field name (Action, Data, Expected Result or a smart column); `Expected` = Expected Result"),
    value: z.string().describe("New text of the field"),
  }),
  z.object({
    op: z.literal("add").describe("Insert a new step"),
    at: z.number().int().optional().describe("Position of the new step, 1-based (default: last)"),
    fields: z.record(z.string(), z.string()).default({}).describe("Fields of the new step by name"),
    sources: sourceLines.default([]),
  }),
  z.object({
    op: z.literal("remove").describe("Remove a step"),
    step: z.number().int().describe("Step number, 1-based"),
  }),
  z.object({
    op: z.literal("move").describe("Move a step to another position"),
    step: z.number().int().describe("Step number, 1-based"),
    to: z.number().int().describe("New position, 1-based"),
  }),
  z.object({
    op: z.literal("sources").describe("Replace the sources of a step"),
    step: z.number().int().describe("Step number, 1-based"),
    sources: sourceLines,
  }),
]);

const FOLD = z
  .enum(["open", "filled", "collapsed"])
  .describe("open · filled: only on a step that holds something · collapsed: folded");
const folds = z.object({
  own: z
    .record(z.string(), FOLD)
    .nullable()
    .describe("The test's own folds by field name, null when it follows the project"),
  project: z.record(z.string(), FOLD).describe("The project's folds (fields not listed are open)"),
});

function mustExist(dir: string, testId: string): void {
  testDir(dir, testId);
  if (!testExists(dir, testId))
    throw new UserError(`No test ${testId} in this project.`, "testimus tests list shows the tests.");
}

const withAwaiting = (r: LocalTestRef) => ({ ...r, awaiting: awaitsReview(r) });

function refOf(dir: string, testId: string) {
  const r = localTestRef(dir, testId);
  if (!r) throw new UserError(`No test ${testId} in this project.`, "testimus tests list shows the tests.");
  return withAwaiting(r);
}

function imageFiles(dir: string, testId: string): string[] {
  const at = join(testDir(dir, testId), "images");
  return existsSync(at) ? readdirSync(at).map((f) => `images/${f}`) : [];
}

const foldsOf = (dir: string, testId: string) => ({
  own: readLocal(dir, testId).columns ?? null,
  project: projectFolds(dir),
});

export const commands = [
  command({
    name: "tests.list",
    summary: "List the project's local tests with their review state, sync state and findings.",
    input: z.object({
      folder: z.string().optional().describe("Only tests in this Xray folder or below (e.g. /Traction)"),
      review: REVIEW.optional().describe("Only tests in this review state"),
      text: z.string().optional().describe("Only tests whose id, key or summary contains this text"),
      generating: z
        .boolean()
        .optional()
        .describe(
          "Also list the tests a running generation is still writing (flagged generating) — Generate shows them as they land; nothing else does until the generation ends",
        ),
    }),
    output: z.array(TEST_REF),
    mutates: false,
    async run(ctx, input) {
      const text = input.text?.toLowerCase();
      return listLocalTests(projectOf(ctx), { generating: input.generating })
        .filter(
          (t) =>
            (input.folder === undefined || inFolder(t.folder, input.folder)) &&
            (input.review === undefined || t.review === input.review) &&
            (!text || [t.id, t.key ?? "", t.summary].some((s) => s.toLowerCase().includes(text))),
        )
        .map(withAwaiting);
    },
  }),
  command({
    name: "tests.show",
    summary: "Show one test: parsed content, parse warnings, raw test.md, sync state and last check.",
    input: z.object({ id }),
    output: z.object({
      id: z.string().describe("Test id"),
      test: TEST.describe("The test as test.md says it"),
      warnings: z.array(z.string()).describe("What the parser could not read, and step fields Xray does not know"),
      md: z.string().describe("test.md as it is on disk"),
      remote: TEST.nullable().describe("The version Jira had at the last sync (.remote.md), null when never synced"),
      remoteMd: z.string().nullable().describe(".remote.md as it is on disk, null when never synced"),
      sync: SYNC,
      edited: z.boolean().describe("Generated, and its content changed since the generation wrote it"),
      findings: FINDING_COUNTS.nullable().describe("What the last check found, null when never checked"),
      check: CHECK_FILE.nullable().describe("The last check (check.json), null when never checked"),
      files: z.array(z.string()).describe("Picture files present in the test folder (images/…)"),
      mtime: z
        .number()
        .describe(
          "test.md modification time (ms, rounded), to notice an edit made outside the app (tests.save ifMtime)",
        ),
    }),
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      const { test, warnings, md, remoteMd } = readTest(dir, input.id);
      const check = readCheck(dir, input.id);
      const names = readXray(dir).fields.map((f) => f.name);
      return {
        id: input.id,
        test,
        warnings: [...warnings, ...fieldWarnings(test, names)],
        md,
        remote: remoteMd === undefined ? null : parseTest(remoteMd).test,
        remoteMd: remoteMd ?? null,
        sync: syncState(dir, input.id, md, remoteMd ?? null),
        edited: refOf(dir, input.id).edited,
        findings: findingCounts(check, md) ?? null,
        check,
        files: imageFiles(dir, input.id),
        mtime: fileMtime(join(testDir(dir, input.id), "test.md")),
      };
    },
  }),
  command({
    name: "tests.create",
    summary:
      "Create a local test (local-<8hex>), review draft — with its content in the same call (summary, description, steps with their sources), or with one empty step when no step is given.",
    input: z.object({
      summary: z.string().optional().describe("Test summary (default: New test)"),
      folder: z.string().optional().describe("Xray folder path (default: /)"),
      description: z.string().optional().describe("Test description"),
      labels: z.array(z.string()).optional().describe("Jira labels"),
      covers: z.array(z.string()).optional().describe("Issue keys the test is linked to in Jira (« Test » links)"),
      steps: z
        .array(
          z.object({
            fields: z
              .record(z.string(), z.string())
              .describe("The step's fields by name: Action, Data, Expected Result and the smart columns"),
            sources: sourceLines.default([]),
          }),
        )
        .optional()
        .describe("The steps, in order (default: one empty step) — the test is written whole in one call"),
    }),
    output: z.object({ id: z.string().describe("The new test's id (local-<8hex>)") }),
    mutates: true,
    async run(ctx, input) {
      const dir = projectOf(ctx);
      const t = newTest(readProject(dir).jiraProject, input.folder ?? "/");
      if (input.summary !== undefined) t.summary = input.summary;
      if (input.description !== undefined) t.description = input.description;
      if (input.labels) t.labels = input.labels;
      if (input.covers) t.covers = input.covers;
      if (input.steps?.length) {
        t.steps = [];
        applyOps(
          t,
          input.steps.map((s) => ({ op: "add" as const, fields: s.fields, sources: s.sources })),
          readXray(dir).fields.map((f) => f.name),
        );
      }
      return { id: createLocalTest(dir, t, fieldOrder(dir)) };
    },
  }),
  command({
    name: "tests.edit",
    summary:
      "Patch a test: summary, folder, labels, description, covers, and step operations (set field, add, remove, move, sources).",
    input: z.object({
      id,
      summary: z.string().optional().describe("New summary"),
      folder: z.string().optional().describe("New Xray folder path"),
      labels: z.array(z.string()).optional().describe("New label list (replaces it)"),
      description: z.string().optional().describe("New description"),
      covers: z.array(z.string()).optional().describe("New list of issue keys linked by « Test » links (replaces it)"),
      preconditions: z
        .array(z.string())
        .optional()
        .describe("New list of attached Xray Precondition keys (replaces it; xray.preconditions lists them)"),
      steps: z
        .array(stepOp)
        .optional()
        .describe(
          'Step operations applied in order, step numbers 1-based as in "## Step N": ' +
            '{op:"set",step,field,value} {op:"add",at?,fields?,sources?} {op:"remove",step} {op:"move",step,to} {op:"sources",step,sources}',
        ),
    }),
    output: TEST_REF,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      const { test } = readTest(dir, input.id);
      if (input.summary !== undefined) test.summary = input.summary;
      if (input.folder !== undefined) test.folder = input.folder;
      if (input.labels) test.labels = input.labels;
      if (input.description !== undefined) test.description = input.description;
      if (input.covers) test.covers = input.covers;
      if (input.preconditions)
        test.preconditions = [
          ...new Set(input.preconditions.map((k) => k.trim().toUpperCase()).filter(Boolean)),
        ].sort();
      applyOps(
        test,
        input.steps ?? [],
        readXray(dir).fields.map((f) => f.name),
      );
      writeTest(dir, input.id, test, fieldOrder(dir));
      return refOf(dir, input.id);
    },
  }),
  command({
    name: "tests.save",
    summary:
      "Write a whole test (the editor's save): test.md is rewritten from the given Test. The review keys (review, note, reviewed by/at, generated by) keep what is on disk — review.set changes them — and so do Jira's (status, assignee: issue.transition, issue.assign). With ifMtime, refused (code conflict) when test.md changed on disk since it was read.",
    input: z.object({
      id,
      test: TEST.describe("The whole test, as tests.show returns it"),
      ifMtime: IF_MTIME,
    }),
    output: TEST_REF,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      unchangedSince(join(testDir(dir, input.id), "test.md"), input.ifMtime, `${input.id}/test.md`);
      writeTest(dir, input.id, keepReview(readTest(dir, input.id).test, input.test), fieldOrder(dir));
      return refOf(dir, input.id);
    },
  }),
  command({
    name: "tests.restore",
    summary:
      "Undo every local change of a test: test.md is rewritten from .remote.md, the version Jira had at the last sync (no network, nothing pushed) — the review state included, as the label Jira carried.",
    input: z.object({ id }),
    output: TEST_REF,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      const { remoteMd } = readTest(dir, input.id);
      if (remoteMd === undefined)
        throw new UserError(
          `${input.id} was never synced with Jira — there is no version to go back to.`,
          "Only a test pulled from or pushed to Jira keeps a .remote.md.",
        );
      writeTest(dir, input.id, parseTest(remoteMd).test, fieldOrder(dir));
      return refOf(dir, input.id);
    },
  }),
  command({
    name: "tests.folds",
    summary:
      "How the step fields of one test fold: its own folds (tests/<id>/local.json, never part of test.md) over the project's column modes (columns.json).",
    input: z.object({ id }),
    output: folds,
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      return foldsOf(dir, input.id);
    },
  }),
  command({
    name: "tests.setFolds",
    summary:
      "Set how the step fields of one test fold (open · filled: only on a step that holds something · collapsed); null or {} follows the project again. Folding never makes a test modified.",
    input: z.object({
      id,
      modes: z
        .record(z.string(), FOLD)
        .nullable()
        .describe("Folds by field name for this test only, or null to follow the project"),
    }),
    output: folds,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      writeLocal(dir, input.id, { ...readLocal(dir, input.id), columns: input.modes ?? undefined });
      return foldsOf(dir, input.id);
    },
  }),
  command({
    name: "tests.removeImage",
    summary:
      "Delete a picture file of a test (tests/<id>/images/…) that no step of test.md lists any more — the editor's ✕ once its Undo has expired.",
    input: z.object({
      id,
      file: z.string().describe("The picture, relative to the test folder: images/img-<8hex>.png"),
    }),
    output: z.object({
      removed: z.boolean().describe("The file is gone"),
      reason: z.string().optional().describe("Why it was kept"),
    }),
    mutates: true,
    positional: ["id", "file"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      const { test } = readTest(dir, input.id);
      if (test.steps.some((s) => s.images.some((im) => im.file === input.file)))
        return { removed: false, reason: "a step still lists it under ### Attachments" };
      removeImageFile(dir, input.id, input.file);
      return { removed: true };
    },
  }),
  command({
    name: "tests.clone",
    summary:
      "Copy a test into a new local test (images included; key, step ids, review and the generated mark dropped: the copy is the team's own).",
    input: z.object({ id }),
    output: z.object({ id: z.string().describe("The copy's id (local-<8hex>)") }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      return { id: await cloneLocalTest(dir, input.id, fieldOrder(dir)) };
    },
  }),
  command({
    name: "tests.remove",
    summary: "Delete a test folder from the project (Jira is not touched).",
    input: z.object({ id }),
    output: z.object({
      id: z.string().describe("The test id"),
      removed: z.boolean().describe("The folder is gone"),
    }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      removeTest(dir, input.id);
      return { id: input.id, removed: true };
    },
  }),
];
