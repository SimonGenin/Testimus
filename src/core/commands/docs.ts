import { rmSync } from "node:fs";
import { z } from "zod";
import { shouldDescribeFigures } from "../claude/figures.ts";
import { NOTE } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { docDir, readDoc, writeDoc } from "../lib/docs.ts";
import { attachDocx, attachPdf } from "../lib/docs-convert.ts";
import {
  addInputOf,
  afterConversion,
  convertSteps,
  convertWith,
  copyIn,
  inSlot,
  inspect,
  nameOf,
  pairFiles,
  runOf,
  withUploads,
} from "../lib/docs-pipeline.ts";
import { filesOf, isImage, isMediaDoc, isVideo } from "../lib/media.ts";
import { addMediaDocs } from "../lib/media-add.ts";
import { convertMedia, MEDIA_STEPS } from "../lib/media-pipeline.ts";
import { docName } from "../lib/names.ts";
import type { DocJson } from "../types.ts";
import {
  after,
  contexts,
  conversion,
  converted,
  docJson,
  docxProfile,
  effort,
  id,
  kind,
  model,
  pdfProfile,
} from "./docs-schemas.ts";
import { applyChoices } from "./media-args.ts";
import { PICKED, VIDEO_CHOICES } from "./media-schemas.ts";

// ponytail: what was chosen for the videos added is kept on each of them before the first conversion hears it
function chooseVideos(project: string, docs: DocJson[], choices: z.infer<typeof VIDEO_CHOICES>): void {
  for (const d of docs)
    for (const f of filesOf(readDoc(project, d.id)).filter((x) => x.kind === "video"))
      applyChoices(project, d.id, f.n, choices);
}

// ponytail: a document the team keeps from Claude is converted by this PC alone — no figure described, no study, no
// look at the warnings
const withoutClaude = <T extends object>(input: T): T => ({
  ...input,
  describeFigures: false,
  triage: false,
  study: false,
});

export const commands = [
  command({
    name: "docs.add",
    summary:
      "Copy a .docx (preferred), .pdf, .txt, an image, a video or a sound recording (.mp3, .m4a, .wav…) into the project and convert it: doc.md with anchors and figures, or for an image or a video a document of its own (img:<n>, t:mm:ss, frame:mm:ss); with convert false, only copy it (docs.convert converts it later).",
    input: z.object({
      file: z
        .string()
        .optional()
        .describe(
          "Path of the original .docx, .pdf, .txt, image or video; it is copied, never opened in place or changed",
        ),
      name: z.string().optional().describe("File name of an uploaded document (with dataBase64, instead of file)"),
      dataBase64: z.string().optional().describe("Content of an uploaded file, base64 (the UI's drop zone)"),
      video: VIDEO_CHOICES.optional().describe(
        "A video: what to hear of it — the languages spoken, the sound track, the part to transcribe",
      ),
      pdfName: z.string().optional().describe("File name of an uploaded PDF rendering (with pdfBase64)"),
      pdfBase64: z.string().optional().describe("Content of an uploaded PDF rendering, base64"),
      id: z.string().optional().describe("Document id; default: the code read from the file name"),
      pdf: z
        .string()
        .optional()
        .describe("A .pdf rendering of the same .docx, used only to recover figures the .docx has no picture for"),
      kind: kind.optional().describe("What the document is (default spec; other for an image or a video)"),
      private: z
        .boolean()
        .optional()
        .describe(
          "Never give this document to Claude: its conversion runs no Claude, and no run reads, searches or cites it afterwards (docs.set private gives it back)",
        ),
      convert: z
        .boolean()
        .default(true)
        .describe(
          "Convert it now; false only copies it, so the team can set its status, amends and context before docs.convert",
        ),
      model,
      effort,
      note: NOTE,
      contexts,
      ...after,
      conversion: conversion.optional(),
    }),
    output: converted,
    mutates: true,
    job: "docs.add",
    positional: ["file"],
    subject: (i) => i.file ?? i.name ?? "upload",
    run: (ctx, given) =>
      withUploads(projectOf(ctx), async (save) => {
        const project = projectOf(ctx);
        const input = given.private ? withoutClaude(given) : given;
        const keep = (id: string) => {
          if (given.private) writeDoc(project, { ...readDoc(project, id), private: true });
        };
        const named = input.file ?? input.name ?? "";
        if (isImage(named) || isVideo(named)) {
          ctx.steps?.([{ id: "copy", label: "Copy the file" }, ...(input.convert ? MEDIA_STEPS : [])]);
          ctx.step?.("copy");
          const picked = input.file ? { path: input.file } : { name: input.name, dataBase64: input.dataBase64 };
          const { added, rejected } = addMediaDocs(project, [picked], { kind: input.kind, id: input.id });
          if (!added.length)
            throw new UserError(
              rejected[0]?.why ?? "The file was not added.",
              "Give a JPEG, PNG or WebP image, a video or a sound recording.",
            );
          if (input.video) chooseVideos(project, added, input.video);
          keep(added[0].id);
          if (!input.convert) return { ...readDoc(project, added[0].id), citedBy: [] };
          const steps = convertSteps([{ id: "copy", label: "Copy the file" }, ...MEDIA_STEPS], {
            ...input,
            study: true,
          });
          ctx.steps?.(steps);
          return inSlot(ctx, project, steps, async () => {
            ctx.step?.("convert");
            const read = !given.private && (input.describeFigures ?? shouldDescribeFigures(project));
            const d = await convertMedia(ctx, project, added[0].id, { read, run: runOf(input) });
            return afterConversion(ctx, project, d, runOf(input), { ...input, describeFigures: false, study: true });
          });
        }
        const studied = input.convert && (input.study || !!input.conversion);
        if (!input.convert) {
          ctx.steps?.([{ id: "copy", label: "Copy the original" }]);
          ctx.step?.("copy");
          const doc = await copyIn(ctx, project, save, input, false);
          keep(doc.id);
          return { ...readDoc(project, doc.id), citedBy: [] };
        }
        const steps = convertSteps(
          [
            ...(studied ? [{ id: "copy", label: "Copy the original" }] : []),
            { id: "convert", label: studied ? "Study and convert" : "Copy and convert" },
          ],
          input,
        );
        ctx.steps?.(steps);
        return inSlot(ctx, project, steps, async () => {
          ctx.step?.(studied ? "copy" : "convert");
          let doc = await copyIn(ctx, project, save, input, !studied);
          keep(doc.id);
          if (studied)
            try {
              ctx.step?.("convert");
              doc = await convertWith(ctx, project, doc.id, input, runOf(input));
            } catch (e) {
              rmSync(docDir(project, doc.id), { recursive: true, force: true });
              throw e;
            }
          return afterConversion(ctx, project, readDoc(project, doc.id), runOf(input), input);
        });
      }),
  }),
  command({
    name: "docs.addFiles",
    summary:
      "Add the documents among files dropped or picked together: a .docx and the .pdf of the same name become one document (the .pdf lends its pictures), a .pdf or a .txt alone is one, images picked together are one images document (or one each), a video is one; each is only copied (docs.convert converts it), other files are refused.",
    input: z.object({
      files: PICKED,
      kind: kind.optional().describe("What the documents are (default spec; other for images and videos)"),
      images: z
        .enum(["together", "each"])
        .default("together")
        .describe("Images picked together: one images document (together, default) or one document each"),
      title: z
        .string()
        .optional()
        .describe("Title of the images document made from the images picked together (default « Images <date> »)"),
      video: VIDEO_CHOICES.optional().describe(
        "The videos among them: what to hear — the languages spoken, the sound track, the part to transcribe",
      ),
    }),
    output: z.object({
      added: z.array(docJson).describe("The documents added, in the order of the files"),
      rejected: z
        .array(
          z.object({
            name: z.string().describe("The file's name"),
            why: z.string().describe("Why it was not added"),
            code: z
              .enum(["not-a-document", "failed"])
              .describe(
                "not-a-document: not a .docx, .pdf, .txt, image or video; failed: the copy was refused (see why)",
              ),
          }),
        )
        .describe("The files not added: not a document, unreadable, or already in the project"),
    }),
    mutates: true,
    job: "docs.add",
    subject: (i) => (i.files.length === 1 ? nameOf(i.files[0]) || "upload" : `${i.files.length} files`),
    run: (ctx, input) =>
      withUploads(projectOf(ctx), async (save) => {
        const project = projectOf(ctx);
        const media = input.files.filter((f) => isImage(nameOf(f)) || isVideo(nameOf(f)));
        const { docs, rejected } = pairFiles(input.files.filter((f) => !media.includes(f)));
        const out = {
          added: [] as DocJson[],
          rejected: rejected.map((f) => ({
            name: nameOf(f),
            why: "Only Word (.docx), PDF, text (.txt), image and video files can be added.",
            code: "not-a-document" as "not-a-document" | "failed",
          })),
        };
        for (const [i, d] of docs.entries()) {
          ctx.progress({ message: `Adding ${nameOf(d.main)}`, done: i, total: docs.length });
          try {
            out.added.push(await copyIn(ctx, project, save, { ...addInputOf(d), kind: input.kind }, false));
          } catch (e) {
            if (ctx.signal.aborted) throw e;
            const why = e instanceof Error ? e.message : String(e);
            out.rejected.push({ name: nameOf(d.main), why, code: "failed" });
          }
        }
        if (media.length) {
          ctx.progress({ message: "Adding the images and videos" });
          const r = addMediaDocs(project, media, { images: input.images, title: input.title, kind: input.kind });
          if (input.video) chooseVideos(project, r.added, input.video);
          out.added.push(...r.added.map((d) => readDoc(project, d.id)));
          out.rejected.push(...r.rejected.map((x) => ({ name: x.name, why: x.why, code: "failed" as const })));
        }
        return out;
      }),
  }),
  command({
    name: "docs.convert",
    summary:
      "Convert a document from its copied source (the first time for one added without conversion); team fields and figure descriptions are kept; an images or video document prepares its files, has Claude read the pictures and writes doc.md again; with index, the search index follows in the same job.",
    input: z.object({
      id,
      pdf: z
        .string()
        .optional()
        .describe(
          "Path of a .pdf rendering of the same .docx, copied beside it first: the figures the .docx has no picture for are taken from it",
        ),
      model,
      effort,
      note: NOTE,
      contexts,
      docx: z
        .string()
        .optional()
        .describe(
          "Path of the .docx of a document added from its .pdf, copied beside it first: it becomes the source, the .pdf lends its pictures",
        ),
      ...after,
      conversion: conversion
        .optional()
        .describe(
          "Convert with these options, kept in doc.json for every later reconversion: they replace the current ones (docs.show gives them), {} clears them",
        ),
      force: z
        .boolean()
        .optional()
        .describe(
          "An images or video document: prepare, transcribe, survey and read every file again (default: only what is not done yet)",
        ),
    }),
    output: converted,
    mutates: true,
    job: "docs.convert",
    positional: ["id"],
    subject: (i) => i.id,
    label: (i, project) => docName(project, i.id),
    async run(ctx, given) {
      const project = projectOf(ctx);
      const kept = !!readDoc(project, given.id).private;
      const input = kept ? withoutClaude(given) : given;
      if (isMediaDoc(readDoc(project, input.id))) {
        const steps = convertSteps(MEDIA_STEPS, { ...input, study: true });
        ctx.steps?.(steps);
        return inSlot(ctx, project, steps, async () => {
          ctx.step?.("convert");
          const read = !kept && (input.describeFigures ?? shouldDescribeFigures(project));
          const d = await convertMedia(ctx, project, input.id, { read, force: input.force, run: runOf(input) });
          return afterConversion(ctx, project, d, runOf(input), { ...input, describeFigures: false, study: true });
        });
      }
      if (input.pdf) attachPdf(project, input.id, input.pdf);
      if (input.docx) attachDocx(project, input.id, input.docx);
      const steps = convertSteps(
        [{ id: "convert", label: input.study ? "Study and convert" : "Convert to text" }],
        input,
      );
      ctx.steps?.(steps);
      return inSlot(ctx, project, steps, async () => {
        ctx.step?.("convert");
        await convertWith(ctx, project, input.id, input, runOf(input));
        return afterConversion(ctx, project, readDoc(project, input.id), runOf(input), input);
      });
    },
  }),
  command({
    name: "docs.inspect",
    summary:
      "Profile a document's original copies before or after converting it — tags, bookmarks, table of contents, heading numbers in the text or only drawn, pages without text, pictures, captions, tables, Word styles, shapes, charts, EMF/WMF, comments — and what that means for the conversion.",
    input: z.object({
      id: id.optional(),
      file: z
        .string()
        .optional()
        .describe("A .docx or .pdf not added yet (instead of id); the other copy saved beside it is profiled too"),
    }),
    output: z.object({
      id: z.string().optional().describe("Document id, when an added document was inspected"),
      files: z
        .object({
          docx: z.string().optional().describe("The .docx profiled (relative to the project for an added document)"),
          pdf: z.string().optional().describe("The .pdf profiled"),
        })
        .describe("The copies profiled"),
      converts: z.enum(["docx", "pdf"]).describe("The copy the conversion reads, with the current options"),
      twin: z
        .string()
        .nullable()
        .describe("The original's other copy, saved beside it under the same name and not in the project yet"),
      conversion: conversion.optional(),
      docx: docxProfile.optional(),
      pdf: pdfProfile.optional(),
      hints: z.array(z.string()).describe("What the profile means for the conversion, one fact per line"),
    }),
    // ponytail: not a job although it reads a whole PDF — a study run (read-only tools) calls it, and read-only
    // excludes jobs (claude/run.ts)
    mutates: false,
    positional: ["id"],
    run: (ctx, input) => inspect(ctx.project, input, ctx.signal),
  }),
];
