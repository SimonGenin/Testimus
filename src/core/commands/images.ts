import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { findPictures } from "../claude/picture.ts";
import { CONTEXT_IDS, DIAGNOSIS, EFFORT, MODEL, WITHOUT } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { fieldOrder } from "../lib/columns.ts";
import { testName } from "../lib/names.ts";
import { pictureFile } from "../lib/pictures.ts";
import { readXray } from "../lib/project.ts";
import { addImage, readTest, testExists, writeTest } from "../lib/store.ts";
import { imageRef } from "../lib/test-blocks.ts";
import { fieldName } from "../lib/testfile.ts";
import { BUILTIN_FIELDS, type StepImage } from "../types.ts";

const IMAGE_EXT = /^\.?(png|jpe?g|gif|bmp|webp|svg)$/i;

export type AttachInput = { id: string; step?: number; field?: string; file?: string; figure?: string };
export type Attached = { id: string; step: number; field: string; file: string; from: string };

// ponytail: a relative path is the project's (Claude's, a figure's) and may not climb out of it; an
// absolute path is one the user picked, taken as it is — either way only a picture is copied
function sourceFile(project: string, file: string): string {
  const abs = isAbsolute(file) ? file : resolve(project, file);
  if (!isAbsolute(file)) {
    const rel = relative(resolve(project), abs);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new UserError(
        `${file} is outside the project.`,
        "Give a path inside the project, or the absolute path of the file.",
      );
  }
  if (!IMAGE_EXT.test(extname(abs)))
    throw new UserError(`${file} is not a picture.`, "Attach a .png, .jpg, .gif, .bmp, .webp or .svg file.");
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new UserError(`No file ${file}.`, "Check the path.");
  return abs;
}

// ponytail: the editor's paste — the picture is only stored; the editor splices the ref into the
// field itself and saves the whole test, so nothing here touches test.md
export function storeImage(project: string, id: string, dataBase64: string, ext: string): StepImage {
  if (!testExists(project, id))
    throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.");
  const e = ext.trim().replace(/^\./, "").toLowerCase().replace("jpeg", "jpg") || "png";
  if (!IMAGE_EXT.test(e))
    throw new UserError(`.${e} is not a picture.`, "Paste a .png, .jpg, .gif, .bmp, .webp or .svg.");
  const bytes = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (!bytes.length) throw new UserError("The picture is empty.", "Paste or drop the screenshot again.");
  return addImage(project, id, new Uint8Array(bytes), e);
}

export async function attachImage(project: string, input: AttachInput): Promise<Attached> {
  if (!input.file === !input.figure)
    throw new UserError("Give either a file or a figure.", 'tests.addImage --file shot.png, or --figure "DOC#fig:40".');
  if (!input.step) throw new UserError("Say which step shows the picture.", "Add --step <n> (1-based).");
  const field = fieldName(
    input.field?.trim() || "Expected Result",
    readXray(project).fields.map((f) => f.name),
  );
  if (!BUILTIN_FIELDS.includes(field))
    throw new UserError(
      `A picture cannot be embedded in ${field}.`,
      `Xray embeds pictures only in ${BUILTIN_FIELDS.join(", ")}.`,
    );
  const { test } = readTest(project, input.id);
  const step = test.steps[input.step - 1];
  if (!step || input.step < 1)
    throw new UserError(
      `Step ${input.step} does not exist — the test has ${test.steps.length} step(s).`,
      `Give a step from 1 to ${test.steps.length}, or add the step first (tests.edit).`,
    );
  const fig = input.figure ? pictureFile(project, input.figure) : null;
  const src = fig ? fig.path : sourceFile(project, input.file as string);
  const img = addImage(project, input.id, new Uint8Array(await readFile(src)), extname(src));
  if (fig) img.figure = fig.figure;
  step.images.push(img);
  const text = (step.fields[field] ?? "").replace(/\s+$/, "");
  step.fields[field] = text ? `${text}\n\n${imageRef(img.file)}` : imageRef(img.file);
  writeTest(project, input.id, test, fieldOrder(project));
  return { id: input.id, step: input.step, field, file: img.file, from: input.figure?.trim() || input.file || "" };
}

const testId = z.string().describe("Test id: the folder under tests/ — a Jira key or local-<8hex>");

export const commands = [
  command({
    name: "tests.addImage",
    summary:
      "Add a picture to a step: a file or a document figure is copied into tests/<id>/images/ and embedded at the end of one of the step's fields.",
    input: z.object({
      id: testId,
      step: z.number().int().min(1).optional().describe("Step number, 1-based (required)"),
      field: z
        .string()
        .optional()
        .describe("Field to embed the picture in: Action, Data or Expected Result (default Expected Result)"),
      file: z
        .string()
        .optional()
        .describe("Picture to copy: a path inside the project, or an absolute path the user chose"),
      figure: z
        .string()
        .optional()
        .describe(
          "Document figure to copy instead of a file: docId#fig:40, or a picture of an images or video document: docId#img:3, docId#frame:04:30",
        ),
    }),
    output: z.object({
      id: z.string().describe("The test"),
      step: z.number().describe("The step that shows the picture, 1-based"),
      field: z.string().describe("The field the picture was embedded in"),
      file: z.string().describe("The copy, relative to the test folder: images/img-<8hex>.<ext>"),
      from: z.string().describe("Where it came from: the file given, or the figure docId#fig:N"),
    }),
    mutates: true,
    positional: ["id", "step"],
    subject: (i) => (i.step ? `${i.id} step ${i.step}` : i.id),
    run: async (ctx, input) => attachImage(projectOf(ctx), input),
  }),
  command({
    name: "tests.findImage",
    summary:
      "Look for pictures of one step's screen with a short Claude run: a document figure first, then a photo of the interface (img:), then a video key frame (frame:). Proposes at most 3, each with what it shows; adds nothing — tests.addImage adds the one picked.",
    input: z.object({
      id: testId,
      step: z.number().int().min(1).describe("Step number, 1-based"),
      model: MODEL.optional().describe("Model alias or name (default: sonnet)"),
      effort: EFFORT.optional().describe("Effort level (default: low)"),
      contexts: CONTEXT_IDS.optional().describe(
        "Context ids to attach (default: the test's own list, else the project's)",
      ),
      without: WITHOUT,
    }),
    output: z.object({
      ok: z.boolean().describe("Whether Claude finished and its answer could be read"),
      runId: z.string().describe("The Claude run"),
      summary: z.string().describe("Claude's last words, or why it failed"),
      pictures: z
        .array(
          z.object({
            figure: z
              .string()
              .describe("Its anchor, as tests.addImage takes it: docId#fig:N, docId#img:N, docId#frame:T"),
            file: z.string().describe("The picture's file, relative to the project"),
            field: z
              .enum(["Action", "Expected Result"])
              .describe("Where it goes: Action when it shows where to act, Expected Result what to see"),
            why: z.string().describe("What it shows of the step, in Claude's words"),
          }),
        )
        .describe("0 to 3 pictures, the best first; empty when none truly shows the screen"),
      diagnosis: DIAGNOSIS.optional(),
    }),
    mutates: true,
    job: "find-image",
    positional: ["id", "step"],
    subject: (i) => `${i.id} step ${i.step}`,
    label: (i, project) => `Pictures for step ${i.step} of ${project ? testName(project, i.id) : i.id}`,
    run: async (ctx, input) => findPictures(ctx, projectOf(ctx), input.id, input.step, input),
  }),
  command({
    name: "tests.storeImage",
    summary:
      "Store a picture pasted or dropped in the editor in tests/<id>/images/ and return its file; test.md is not touched — the editor puts the reference where the caret is and saves the test.",
    input: z.object({
      id: testId,
      dataBase64: z.string().describe("The picture, base64 (a data: URL prefix is accepted)"),
      name: z.string().optional().describe("Original file name (its extension is the fallback for ext)"),
      ext: z
        .string()
        .optional()
        .describe("Extension: png, jpg, gif, bmp, webp, svg (default: from the name, else png)"),
    }),
    output: z.object({
      file: z.string().describe("The copy, relative to the test folder: images/img-<8hex>.<ext>"),
      remoteId: z.string().optional().describe("Never set for a new picture (Xray gives it on push)"),
      figure: z.string().optional().describe("Never set for a pasted picture"),
    }),
    mutates: true,
    positional: ["id"],
    subject: (i) => i.id,
    run: async (ctx, input) =>
      storeImage(projectOf(ctx), input.id, input.dataBase64, input.ext || extname(input.name ?? "") || "png"),
  }),
];
