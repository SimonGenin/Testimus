import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Command, command, projectOf, UserError } from "../command.ts";
import { fieldOrder, readJson, readProject, readXray, writeJson } from "../lib/project.ts";
import {
  cloneLocalTest,
  createLocalTest,
  findingCounts,
  listLocalTests,
  localTestRef,
  readCheck,
  readTest,
  removeImageFile,
  removeTest,
  syncState,
  testDir,
  testExists,
  writeTest,
} from "../lib/store.ts";
import { fieldName, fieldWarnings, isReserved, newTest, parseSource, parseTest } from "../lib/testfile.ts";
import { type ColumnModes, REVIEWS, type Review, type Source, type Test } from "../types.ts";

const review = z.enum(REVIEWS as [Review, ...Review[]]);
const id = z.string().describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");

const counts = z.object({ errors: z.number(), warnings: z.number(), infos: z.number(), stale: z.boolean() });
const ref = z.object({
  id: z.string(),
  key: z.string().optional(),
  summary: z.string(),
  folder: z.string(),
  review,
  generated: z
    .boolean()
    .describe("Written by a generation (generated_by set): it waits in review.queue until validated"),
  edited: z.boolean().describe("Generated, and its content changed since the generation wrote it"),
  sync: z.enum(["local", "modified", "synced", "remote-changed"]),
  dirty: z.boolean(),
  synced: z.boolean(),
  mtime: z.number(),
  stepCount: z.number(),
  findings: counts.optional(),
});

const source = z.object({
  docId: z.string().describe("Document code (docs/<docId>/)"),
  anchor: z.string().describe("Anchor in the document: §5.6.6, fig:<n> or page:<n>"),
  quote: z.string().describe("Short quote copied verbatim from doc.md"),
});
const step = z.object({
  id: z.string().optional().describe("Xray step id, when the step came from Jira"),
  fields: z
    .record(z.string(), z.string())
    .describe("Step fields by Xray name (Action, Data, Expected Result, and the smart columns)"),
  sources: z.array(source).default([]).describe("Claims the step relies on (local, never pushed)"),
  images: z
    .array(
      z.object({
        file: z.string(),
        remoteId: z.string().optional(),
        figure: z.string().optional().describe("The document figure the picture was copied from: docId#fig:40"),
      }),
    )
    .default([])
    .describe(
      "Every attachment of the step, embedded or not: images/<file>, its Xray attachment id and the figure it came from",
    ),
});
const testSchema = z.object({
  key: z.string().optional().describe("Jira key; absent for a local test"),
  project: z.string().describe("Jira project key"),
  summary: z.string().describe("Test summary"),
  folder: z.string().describe("Xray folder path"),
  labels: z.array(z.string()).default([]).describe("Jira labels"),
  status: z.string().optional().describe("Jira status (informational, never pushed)"),
  description: z.string().default("").describe("Test description"),
  covers: z.array(z.string()).default([]).describe("Issue keys the test is linked to in Jira (« Test » links)"),
  clonedFrom: z.string().optional().describe("Key of the test this one was cloned from"),
  preconditions: z.array(z.string()).default([]).describe("Precondition issue keys"),
  review: review.default("draft").describe("Review state — read-only here: a save keeps the one on disk (review.set)"),
  reviewNote: z.string().optional().describe("Reviewer's note (with to-fix) — read-only here, kept from disk"),
  reviewedBy: z.string().optional().describe("Who set the review state — read-only here, kept from disk"),
  reviewedAt: z.string().optional().describe("When the review state was set (ISO) — read-only here, kept from disk"),
  generatedBy: z.string().optional().describe("Job id of the generation that wrote the test — read-only here"),
  steps: z.array(step).describe("Steps in order"),
  extra: z
    .record(z.string(), z.string())
    .default({})
    .describe(
      'Unknown frontmatter keys, kept as they are ("#…" keys belong to the parser and are always kept from disk)',
    ),
});

const sourceLines = z
  .array(z.string())
  .describe('Source lines, each `<docId>#<anchor> "<exact quote>"` — replaces the step\'s sources');

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
type StepOp = z.output<typeof stepOp>;

function mustExist(dir: string, testId: string): void {
  if (!testExists(dir, testId))
    throw new UserError(`No test ${testId} in this project.`, "testimus tests list shows the tests.");
}

const order = (dir: string) => fieldOrder(readXray(dir));

const MODE = z.enum(["open", "filled", "collapsed"]);
const columnsFile = (dir: string, testId: string) => join(testDir(dir, testId), "columns.json");

function readColumns(dir: string, testId: string): ColumnModes | null {
  if (!existsSync(columnsFile(dir, testId))) return null;
  const raw = readJson<Record<string, unknown>>(columnsFile(dir, testId), {});
  const out: ColumnModes = {};
  for (const [k, v] of Object.entries(raw)) if (MODE.safeParse(v).success) out[k] = v as ColumnModes[string];
  return out;
}

function projectColumns(dir: string): ColumnModes {
  const p = readXray(dir).prefs;
  const out: ColumnModes = {};
  for (const n of p.filled ?? []) out[n] = "filled";
  for (const n of p.collapsed) out[n] = "collapsed";
  return out;
}

function imageFiles(dir: string, testId: string): string[] {
  const at = join(testDir(dir, testId), "images");
  return existsSync(at) ? readdirSync(at).map((f) => `images/${f}`) : [];
}

function refOf(dir: string, testId: string) {
  const r = localTestRef(dir, testId);
  if (!r) throw new UserError(`No test ${testId} in this project.`);
  return r;
}

function toSources(lines: string[]): Source[] {
  return lines.map((l) => {
    const s = parseSource(l);
    if (!s?.quote)
      throw new UserError(
        `Source "${l}" is not docId#anchor "quote".`,
        'Write it as SOSIE_211_D401-1_3#§5.6.6 "exact quote".',
      );
    return s;
  });
}

const renamed = (fields: Record<string, string>, known: readonly string[]) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [fieldName(k, known), v]));

// ponytail: the review keys are the reviewer's and the generation's, never the editor's — a save keeps
// what is on disk (only review.set, the check and the fix change them), and so does every key the
// parser kept as written, which the editor cannot see
function keepReview(onDisk: Test, saved: Test): Test {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(saved.extra ?? {})) if (!isReserved(k)) extra[k] = v;
  for (const [k, v] of Object.entries(onDisk.extra)) if (isReserved(k)) extra[k] = v;
  return {
    ...saved,
    review: onDisk.review,
    reviewNote: onDisk.reviewNote,
    reviewedBy: onDisk.reviewedBy,
    reviewedAt: onDisk.reviewedAt,
    generatedBy: onDisk.generatedBy,
    extra,
  };
}

function applyOps(t: Test, ops: StepOp[], known: readonly string[]): void {
  const at = (n: number) => {
    if (n < 1 || n > t.steps.length)
      throw new UserError(`Step ${n} does not exist — the test has ${t.steps.length} step(s).`);
    return n - 1;
  };
  for (const o of ops) {
    if (o.op === "set") t.steps[at(o.step)].fields[fieldName(o.field, known)] = o.value;
    else if (o.op === "add") {
      const pos = o.at === undefined ? t.steps.length : Math.min(Math.max(o.at, 1), t.steps.length + 1) - 1;
      t.steps.splice(pos, 0, { fields: renamed(o.fields, known), sources: toSources(o.sources), images: [] });
    } else if (o.op === "remove") t.steps.splice(at(o.step), 1);
    else if (o.op === "move") {
      const [s] = t.steps.splice(at(o.step), 1);
      t.steps.splice(Math.min(Math.max(o.to, 1), t.steps.length + 1) - 1, 0, s);
    } else t.steps[at(o.step)].sources = toSources(o.sources);
  }
}

const underFolder = (folder: string, f: string) => {
  const base = f.replace(/\/+$/, "");
  return base === "" || folder === base || folder.startsWith(`${base}/`);
};

export const commands: Command[] = [
  command({
    name: "tests.list",
    summary: "List the project's local tests with their review state, sync state and findings.",
    input: z.object({
      folder: z.string().optional().describe("Only tests in this Xray folder or below (e.g. /Traction)"),
      review: review.optional().describe("Only tests in this review state"),
      text: z.string().optional().describe("Only tests whose id, key or summary contains this text"),
    }),
    output: z.array(ref),
    mutates: false,
    async run(ctx, input) {
      const text = input.text?.toLowerCase();
      return listLocalTests(projectOf(ctx)).filter(
        (t) =>
          (input.folder === undefined || underFolder(t.folder, input.folder)) &&
          (input.review === undefined || t.review === input.review) &&
          (!text || [t.id, t.key ?? "", t.summary].some((s) => s.toLowerCase().includes(text))),
      );
    },
  }),
  command({
    name: "tests.show",
    summary: "Show one test: parsed content, parse warnings, raw test.md, sync state and last check.",
    input: z.object({ id }),
    output: z.object({
      id: z.string(),
      test: z.unknown(),
      warnings: z.array(z.string()),
      md: z.string(),
      remote: z.unknown(),
      remoteMd: z.string().nullable(),
      sync: z.enum(["local", "modified", "synced", "remote-changed"]),
      edited: z.boolean().describe("Generated, and its content changed since the generation wrote it"),
      findings: counts.nullable(),
      check: z.unknown(),
      files: z.array(z.string()).describe("Picture files present in the test folder (images/…)"),
      mtime: z.number().describe("test.md modification time (ms), to notice an edit made outside the app"),
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
        mtime: statSync(join(testDir(dir, input.id), "test.md")).mtimeMs,
      };
    },
  }),
  command({
    name: "tests.create",
    summary: "Create a local test (local-<8hex>) with one empty step, review draft.",
    input: z.object({
      summary: z.string().optional().describe("Test summary (default: New test)"),
      folder: z.string().optional().describe("Xray folder path (default: /)"),
      description: z.string().optional().describe("Test description"),
      labels: z.array(z.string()).optional().describe("Jira labels"),
      covers: z.array(z.string()).optional().describe("Issue keys the test is linked to in Jira (« Test » links)"),
    }),
    output: z.object({ id: z.string() }),
    mutates: true,
    async run(ctx, input) {
      const dir = projectOf(ctx);
      const t = newTest(readProject(dir).jiraProject, input.folder ?? "/");
      if (input.summary !== undefined) t.summary = input.summary;
      if (input.description !== undefined) t.description = input.description;
      if (input.labels) t.labels = input.labels;
      if (input.covers) t.covers = input.covers;
      return { id: createLocalTest(dir, t, order(dir)) };
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
    output: ref,
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
      writeTest(dir, input.id, test, order(dir));
      return refOf(dir, input.id);
    },
  }),
  command({
    name: "tests.save",
    summary:
      "Write a whole test (the editor's save): test.md is rewritten from the given Test. The review keys (review, note, reviewed by/at, generated by) keep what is on disk — review.set changes them.",
    input: z.object({ id, test: testSchema.describe("The whole test, as tests.show returns it") }),
    output: ref,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      writeTest(dir, input.id, keepReview(readTest(dir, input.id).test, input.test), order(dir));
      return refOf(dir, input.id);
    },
  }),
  command({
    name: "tests.restore",
    summary:
      "Undo every local change of a test: test.md is rewritten from .remote.md, the version Jira had at the last sync (no network, nothing pushed) — the review state included, as the label Jira carried.",
    input: z.object({ id }),
    output: ref,
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
      writeTest(dir, input.id, parseTest(remoteMd).test, order(dir));
      return refOf(dir, input.id);
    },
  }),
  command({
    name: "tests.columns",
    summary:
      "How the step fields of one test fold: its own modes (tests/<id>/columns.json, never part of test.md) over the project's (xray.json prefs).",
    input: z.object({ id }),
    output: z.object({
      own: z
        .record(z.string(), MODE)
        .nullable()
        .describe("The test's own modes by field name, null when it follows the project"),
      project: z.record(z.string(), MODE).describe("The project's modes (fields not listed are open)"),
    }),
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      return { own: readColumns(dir, input.id), project: projectColumns(dir) };
    },
  }),
  command({
    name: "tests.setColumns",
    summary:
      "Set how the step fields of one test fold (open · filled: only on a step that holds something · collapsed); null or {} follows the project again. Folding never makes a test modified.",
    input: z.object({
      id,
      modes: z
        .record(z.string(), MODE)
        .nullable()
        .describe("Modes by field name for this test only, or null to follow the project"),
    }),
    output: z.object({ own: z.record(z.string(), MODE).nullable(), project: z.record(z.string(), MODE) }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      if (!input.modes || !Object.keys(input.modes).length) rmSync(columnsFile(dir, input.id), { force: true });
      else writeJson(columnsFile(dir, input.id), input.modes);
      return { own: readColumns(dir, input.id), project: projectColumns(dir) };
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
    output: z.object({ removed: z.boolean(), reason: z.string().optional() }),
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
    output: z.object({ id: z.string() }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const dir = projectOf(ctx);
      mustExist(dir, input.id);
      return { id: cloneLocalTest(dir, input.id, order(dir)) };
    },
  }),
  command({
    name: "tests.remove",
    summary: "Delete a test folder from the project (Jira is not touched).",
    input: z.object({ id }),
    output: z.object({ id: z.string(), removed: z.boolean() }),
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
