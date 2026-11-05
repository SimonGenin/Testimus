import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describeFigures, shouldDescribeFigures } from "../claude/figures.ts";
import { docContexts, writeDocContexts } from "../claude/prompt.ts";
import { CONTEXT_IDS, EFFORT, MODEL, NOTE } from "../claude/schemas.ts";
import { type Ctx, command, projectOf, UserError } from "../command.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { recheckMechanical, testsCiting } from "../lib/check.ts";
import {
  amendedBy,
  contextMtime,
  docDir,
  headingAt,
  readContext,
  readDoc,
  readDocMd,
  readFigures,
  removeDoc,
  sectionOf,
  tocOf,
  writeContext,
  writeDoc,
} from "../lib/docs.ts";
import { attachDocx, attachPdf } from "../lib/docs-convert.ts";
import { docsFreshness } from "../lib/docs-index.ts";
import {
  addInputOf,
  afterConversion,
  convertSteps,
  convertWith,
  copyIn,
  inspect,
  nameOf,
  pairFiles,
  runOf,
  withUploads,
} from "../lib/docs-pipeline.ts";
import { findLot, updateLot, writePart } from "../lib/media.ts";
import { prepareLot, readLot, writeAnnex } from "../lib/media-pipeline.ts";
import { readProject } from "../lib/project.ts";
import { docFigures } from "../rag/chunk.ts";
import { chunksOf, withIndex } from "../rag/db.ts";
import { unindexDoc } from "../rag/indexer.ts";
import { renderPage } from "../rag/pdf.ts";
import { REVIEW } from "../schemas.ts";
import type { DocJson } from "../types.ts";
import { addLot, MEDIA_FILES } from "./media.ts";

const kind = z.enum(["spec", "minutes", "other"]);
const status = z.enum(["draft", "submitted", "validated"]);

const conversion = z
  .object({
    from: z
      .enum(["docx", "pdf"])
      .optional()
      .describe("Which copy is converted when the folder holds both (default: the .docx, the .pdf lending pictures)"),
    reader: z
      .enum(["tagged", "layout"])
      .optional()
      .describe(
        "PDF reader: tagged = the PDF's structure tags (Word, Chrome), layout = text positions and font sizes; default: tagged when the tags hold the text and its headings",
      ),
    numbers: z
      .array(
        z.object({
          number: z
            .string()
            .regex(/^(?:[A-Z]{1,3}\.)?\d{1,3}(?:\.\d{1,3}){0,8}$/)
            .describe("The heading number as printed, e.g. 5.2.1"),
          title: z.string().min(1).describe("The heading title as printed, without its number"),
        }),
      )
      .optional()
      .describe(
        "Heading numbers printed on the pages but missing from the PDF text, in reading order; a heading whose title matches gets the number",
      ),
    figures: z
      .array(
        z.object({
          key: z
            .string()
            .regex(/^[\w.-]{1,40}$/)
            .describe("The figure's key, as in its anchor fig:<key> and in the warning (« Figure 9 » → 9)"),
          page: z.coerce.number().int().min(1).describe("The page of the PDF copy that draws it, from 1"),
          region: z
            .tuple([
              z.number().min(0).max(1),
              z.number().min(0).max(1),
              z.number().min(0).max(1),
              z.number().min(0).max(1),
            ])
            .describe(
              "The drawing on that page as [left, top, right, bottom], fractions of the page — check it with docs.page first",
            ),
        }),
      )
      .optional()
      .describe(
        "Figures the conversion finds no picture for (a caption alone, a shape drawn in Word), taken from a region of a page of the PDF copy; every reconversion draws them again",
      ),
    notes: z
      .string()
      .optional()
      .describe("What the study saw: caption and numbering conventions, parts to check after the conversion"),
  })
  .describe("How the document is converted; kept in doc.json so that every reconversion gives the same result");

const captionStyle = z.object({
  style: z.string().describe("The caption pattern, e.g. « Figure N – … »"),
  count: z.number().describe("Captions written that way"),
  sample: z.string().describe("The first one, verbatim"),
  figure: z.boolean().describe("Whether the converter takes it as a figure caption (Figure / Fig. only)"),
});

const pdfProfile = z
  .object({
    pages: z.number().describe("Pages"),
    producer: z.string().describe("PDF producer, e.g. Microsoft® Word for Microsoft 365"),
    creator: z.string().describe("PDF creator application"),
    title: z.string().describe("Title in the PDF metadata"),
    tagged: z.boolean().describe("Whether the PDF has structure tags"),
    tagShare: z.number().nullable().describe("Share of the text inside the tags, 0–1; null when untagged"),
    reader: z
      .enum(["tagged", "layout"])
      .describe("The reader Testimus picks by itself: tagged when the tags hold ≥ 98 % of the text and a heading"),
    headings: z.number().describe("Heading tags (H, H1…H6) with text"),
    headingsNumbered: z.number().describe("Heading tags whose text starts with their number"),
    bookmarks: z.number().describe("Bookmarks (outline entries)"),
    bookmarksNumbered: z.number().describe("Bookmarks whose title starts with a number"),
    toc: z.number().describe("Entries of the tagged table of contents (TOCI)"),
    tocNumbered: z.number().describe("Tagged table of contents entries that start with a number"),
    textless: z.array(z.number()).describe("Pages with no text: a scan, or a page that is only a picture"),
    pictures: z.number().describe("Pictures painted on the pages"),
    figureTags: z.number().describe("Figure tags"),
    tables: z.number().describe("Table tags"),
    captions: z.array(captionStyle).describe("Caption styles found in the text, most frequent first"),
  })
  .describe("Profile of the PDF copy");

const docxProfile = z
  .object({
    paragraphs: z.number().describe("Paragraphs"),
    headings: z.number().describe("Paragraphs in a heading style (or with an outline level)"),
    headingsNumbered: z.number().describe("Headings numbered by Word (list numbering)"),
    headingsTyped: z.number().describe("Headings whose number is typed in their text"),
    headingStyles: z
      .array(
        z.object({
          style: z.string().describe("Style name"),
          level: z.number().describe("Heading level it gives"),
          count: z.number().describe("Paragraphs in that style"),
          numbered: z.boolean().describe("Whether Word numbers it"),
        }),
      )
      .describe("Heading styles in use"),
    tables: z.number().describe("Tables"),
    pictures: z.number().describe("Pictures placed in the text"),
    media: z.record(z.string(), z.number()).describe("Files under word/media by extension (png, emf, wmf…)"),
    shapes: z.number().describe("Shapes drawn in Word (their drawing is lost, only labels survive)"),
    charts: z.number().describe("Charts (not converted)"),
    objects: z.number().describe("Embedded objects (only their preview picture survives)"),
    comments: z.number().describe("Word comments (dropped)"),
    changes: z.number().describe("Tracked insertions and deletions"),
    captions: z.array(captionStyle).describe("Caption styles, most frequent first"),
  })
  .describe("Profile of the .docx copy");

const copy = z.object({
  file: z.string().describe("The copy in the document folder: source.docx or source.pdf"),
  sha256: z.string().describe("sha256 of the copy, to tell a changed original"),
});

const docJson = z.object({
  id: z.string().describe("Document id: its folder under docs/"),
  code: z.string().describe("The document's code, read from the file name (e.g. SOSIE_211_D401-1_3)"),
  title: z.string().describe("Title: read by the first conversion, or typed by the team"),
  version: z.string().describe("Version, e.g. 01.01"),
  date: z.string().describe("Date of the document, YYYY-MM-DD, or empty"),
  kind: kind.describe("What the document is: spec, minutes or other"),
  status: status.describe("Where the team is with it: draft, submitted or validated"),
  amends: z.array(z.string()).optional().describe("Ids of the documents this one amends"),
  contexts: z
    .array(z.string())
    .optional()
    .describe("Saved contexts Claude reads with this document (absent: the project's defaults)"),
  source: copy
    .extend({
      name: z.string().describe("Where the original came from: its path on this PC, or the uploaded file's name"),
      uploaded: z.boolean().optional().describe("Sent from the page rather than read from a path"),
    })
    .describe("The original that is converted"),
  twin: copy.optional().describe("The other original kept beside it (the .pdf of a .docx, or the reverse)"),
  converted: z
    .object({
      with: z.string().describe("The converter and its version"),
      at: z.string().describe("When, ISO time"),
      warnings: z.array(z.string()).describe("What the conversion could not keep"),
      stats: z
        .object({
          sections: z.number().describe("Sections anchored in doc.md"),
          figures: z.number().describe("Figures with a picture"),
          chars: z.number().describe("Length of doc.md"),
        })
        .optional()
        .describe("What doc.md holds"),
    })
    .optional()
    .describe("What the last conversion found; absent until the first one"),
  conversion: conversion.optional(),
});

const figure = z.object({
  file: z.string().describe("Picture file, relative to the document folder"),
  anchor: z.string().describe("Figure anchor, fig:N"),
  caption: z.string().describe("Caption from the document — the only quotable text of a figure"),
  description: z.string().describe("What Claude saw in the picture (never quotable)"),
  labels: z
    .array(z.string())
    .optional()
    .describe("Text visible in the picture, verbatim, as Claude read it — indexed for search, never quotable"),
  kind: z
    .enum(["screen", "diagram", "symbol", "table-image", "photo"])
    .optional()
    .describe("What the picture is, as Claude judged it"),
  table: z
    .string()
    .optional()
    .describe(
      "When the caption names a table of the text rather than a picture: that table's rows, as doc.md has them (file is empty, nothing to describe)",
    ),
});
const id = z.string().describe("Document id (the folder name under docs/, e.g. SOSIE_211_D401-1_3)");
const model = MODEL.optional().describe(
  "Claude model for the figure descriptions (default: project.json claude.model)",
);
const effort = EFFORT.optional().describe("Claude effort for the figure descriptions (default: low)");
const contexts = CONTEXT_IDS.optional().describe(
  "Saved contexts Claude reads for this conversion only, on top of the document's own (docs.set contexts)",
);
const after = {
  describeFigures: z
    .boolean()
    .optional()
    .describe(
      "Have Claude describe the figures not described yet, after the conversion (default: project.json rag.describeFigures, on)",
    ),
  triage: z
    .boolean()
    .optional()
    .describe(
      "Then have Claude look at the conversion warnings and propose a Claude action for those it can fix; skipped when Claude is not installed on this PC",
    ),
  study: z
    .boolean()
    .optional()
    .describe(
      "Claude studies the original first (docs.inspect, page images) and chooses how it is converted, then compares doc.md with the pages and may convert once more or propose Claude actions; needs a PDF copy. Replaces triage",
    ),
  index: z
    .boolean()
    .optional()
    .describe(
      "Then update the search index in the same job, once the other conversions running in this project are done (a failed index run keeps the conversion)",
    ),
};
const citedBy = z
  .array(
    z.object({
      id: z.string().describe("Test id (its folder under tests/)"),
      key: z.string().optional().describe("Jira key, once the test is in Xray"),
      summary: z.string().describe("Test summary"),
      review: REVIEW.describe("Where the test is in the review"),
      steps: z.number().describe("Steps with a source that cites the document"),
    }),
  )
  .describe("Tests whose sources cite this document; their mechanical check is redone against the new text");
const converted = docJson.extend({
  citedBy,
  index: z
    .object({
      chunks: z.number().optional().describe("Passages in the index after the run"),
      degraded: z.string().optional().describe("Why no vectors were built (no embedding model on this PC)"),
      error: z.string().optional().describe("Why the index run failed; the conversion is kept"),
    })
    .optional()
    .describe("With index: what the index run that followed the conversion did"),
});
const mtime = z
  .number()
  .nullable()
  .describe("Modification time of context.md in ms (null: no context.md yet), to notice a change made on disk");

const MEDIA_STEP = { id: "media", label: "Prepare and read the batches' photos" };

// ponytail: the batches in the document after its conversion — photos not prepared yet are, those not read are read by
// Claude when the figures are (describeFigures), each annex is written again and doc.md assembled
async function withBatches(
  ctx: Ctx,
  project: string,
  docId: string,
  claude: ReturnType<typeof runOf>,
  read: boolean,
): Promise<void> {
  const lots = (readDoc(project, docId).media ?? []).filter((l) => l.included);
  if (!lots.length) return;
  ctx.step?.("media");
  const language = readProject(project).language;
  for (const l of lots) {
    if (ctx.signal.aborted) break;
    if (l.items.some((i) => i.state === "new")) await prepareLot(ctx, project, docId, l.id);
    if (read && findLot(readDoc(project, docId), l.id).items.some((i) => i.state === "ready"))
      await readLot(ctx, project, docId, l.id, claude);
    writePart(project, docId, l.id, language);
  }
  await writeAnnex(project, docId);
}

const batchInput = z
  .array(
    z.object({
      files: MEDIA_FILES,
      title: z.string().optional().describe("The batch's title (e.g. Recette TCO 12/10)"),
      context: z.string().optional().describe("What the team says about the batch"),
      reference: z
        .boolean()
        .optional()
        .describe("The batch shows the reference behaviour (an expected result sourced from it alone is not flagged)"),
    }),
  )
  .optional()
  .describe(
    "Batches of photos to attach to the new document (media.add): created after the copy, read by Claude after the conversion, annexes of doc.md",
  );
const mediaPick = z
  .array(z.string())
  .optional()
  .describe(
    "The batches in the document for this conversion (media.list ids): each one listed becomes an annex of doc.md, the others are left out; absent: as they are",
  );

export const commands = [
  command({
    name: "docs.add",
    summary:
      "Copy a .docx (preferred) or .pdf into the project and convert it to doc.md with anchors and figures; with convert false, only copy it (docs.convert converts it later).",
    input: z.object({
      file: z
        .string()
        .optional()
        .describe("Path of the original .docx or .pdf; it is copied, never opened in place or changed"),
      name: z.string().optional().describe("File name of an uploaded document (with dataBase64, instead of file)"),
      dataBase64: z.string().optional().describe("Content of an uploaded .docx or .pdf, base64 (the UI's drop zone)"),
      pdfName: z.string().optional().describe("File name of an uploaded PDF rendering (with pdfBase64)"),
      pdfBase64: z.string().optional().describe("Content of an uploaded PDF rendering, base64"),
      id: z.string().optional().describe("Document id; default: the code read from the file name"),
      pdf: z
        .string()
        .optional()
        .describe("A .pdf rendering of the same .docx, used only to recover figures the .docx has no picture for"),
      kind: kind.optional().describe("What the document is (default spec)"),
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
      media: batchInput,
    }),
    output: converted,
    mutates: true,
    job: "docs.add",
    positional: ["file"],
    subject: (i) => i.file ?? i.name ?? "upload",
    run: (ctx, input) =>
      withUploads(projectOf(ctx), async (save) => {
        const project = projectOf(ctx);
        const studied = input.convert && (input.study || !!input.conversion);
        const batches = input.media ?? [];
        ctx.steps?.(
          input.convert
            ? convertSteps(
                [
                  ...(studied ? [{ id: "copy", label: "Copy the original" }] : []),
                  { id: "convert", label: studied ? "Study and convert" : "Copy and convert" },
                  ...(batches.length ? [MEDIA_STEP] : []),
                ],
                input,
              )
            : [{ id: "copy", label: "Copy the original" }],
        );
        ctx.step?.(studied || !input.convert ? "copy" : "convert");
        let doc = await copyIn(ctx, project, save, input, input.convert && !studied);
        for (const b of batches) await addLot(ctx, project, doc.id, b);
        if (!input.convert) {
          for (const l of readDoc(project, doc.id).media ?? []) await prepareLot(ctx, project, doc.id, l.id);
          return { ...readDoc(project, doc.id), citedBy: [] };
        }
        if (studied)
          try {
            ctx.step?.("convert");
            doc = await convertWith(ctx, project, doc.id, input, runOf(input));
          } catch (e) {
            rmSync(docDir(project, doc.id), { recursive: true, force: true });
            throw e;
          }
        const read = input.describeFigures ?? shouldDescribeFigures(project);
        await withBatches(ctx, project, doc.id, runOf(input), read);
        doc = readDoc(project, doc.id);
        return { ...doc, ...(await afterConversion(ctx, project, doc, runOf(input), input)) };
      }),
  }),
  command({
    name: "docs.addFiles",
    summary:
      "Add the documents among files dropped or picked together: a .docx and the .pdf of the same name become one document (the .pdf lends its pictures), a .pdf alone is one; each is only copied (docs.convert converts it), other files are refused.",
    input: z.object({
      files: z
        .array(
          z.object({
            path: z.string().optional().describe("Path of the file on this PC (the desktop app, the CLI)"),
            name: z.string().optional().describe("File name, with dataBase64 (a file sent from the page)"),
            dataBase64: z.string().optional().describe("Content of a file sent from the page, base64"),
          }),
        )
        .min(1)
        .describe("The files, each by path or by name and content"),
      kind: kind.optional().describe("What the documents are (default spec)"),
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
              .describe("not-a-document: neither a .docx nor a .pdf; failed: the copy was refused (see why)"),
          }),
        )
        .describe("The files not added: not a .docx or .pdf, unreadable, or already in the project"),
    }),
    mutates: true,
    job: "docs.add",
    subject: (i) => (i.files.length === 1 ? nameOf(i.files[0]) || "upload" : `${i.files.length} files`),
    run: (ctx, input) =>
      withUploads(projectOf(ctx), async (save) => {
        const project = projectOf(ctx);
        const { docs, rejected } = pairFiles(input.files);
        const out = {
          added: [] as DocJson[],
          rejected: rejected.map((f) => ({
            name: nameOf(f),
            why: "Only Word (.docx) and PDF files can be added.",
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
        return out;
      }),
  }),
  command({
    name: "docs.convert",
    summary:
      "Convert a document from its copied source (the first time for one added without conversion); team fields and figure descriptions are kept; with index, the search index follows in the same job.",
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
      media: mediaPick,
    }),
    output: converted,
    mutates: true,
    job: "docs.convert",
    positional: ["id"],
    subject: (i) => i.id,
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (input.pdf) attachPdf(project, input.id, input.pdf);
      if (input.docx) attachDocx(project, input.id, input.docx);
      const pick = input.media;
      if (pick) {
        const known = readDoc(project, input.id).media ?? [];
        for (const id of pick)
          if (!known.some((l) => l.id === id))
            throw new UserError(`${input.id} has no batch ${id}.`, `testimus media list --doc ${input.id}`);
        for (const l of known)
          updateLot(project, input.id, l.id, (x) => {
            x.included = pick.includes(l.id);
          });
      }
      const batches = (readDoc(project, input.id).media ?? []).some((l) => l.included);
      ctx.steps?.(
        convertSteps(
          [
            { id: "convert", label: input.study ? "Study and convert" : "Convert to text" },
            ...(batches ? [MEDIA_STEP] : []),
          ],
          input,
        ),
      );
      ctx.step?.("convert");
      await convertWith(ctx, project, input.id, input, runOf(input));
      const read = input.describeFigures ?? shouldDescribeFigures(project);
      await withBatches(ctx, project, input.id, runOf(input), read);
      const doc = readDoc(project, input.id);
      return { ...doc, ...(await afterConversion(ctx, project, doc, runOf(input), input)) };
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
  command({
    name: "docs.page",
    summary:
      "Draw one page of a document's PDF copy (the original, or the rendering beside its .docx), or a region of it, as a PNG to look at; returns its path.",
    input: z.object({
      id,
      page: z.coerce.number().int().min(1).describe("Page number, from 1"),
      region: z
        .array(z.number().min(0).max(1))
        .length(4)
        .optional()
        .describe("Part of the page as [left, top, right, bottom], fractions of the page from its top left corner"),
    }),
    output: z.object({
      file: z.string().describe("Absolute path of the PNG (under .testimus/pages/), to Read"),
      page: z.number().describe("The page drawn"),
      pages: z.number().describe("Pages in the PDF"),
      width: z.number().describe("Width in pixels"),
      height: z.number().describe("Height in pixels"),
    }),
    // ponytail: .testimus/pages/ is a cache, like the index — drawing a page changes nothing the project says, and a
    // study run (read-only tools) must be able to look at the pages
    mutates: false,
    positional: ["id", "page"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      readDoc(project, input.id);
      const pdf = join(docDir(project, input.id), "source.pdf");
      if (!existsSync(pdf))
        throw new UserError(
          `${input.id} has no PDF copy to draw.`,
          `Give its PDF rendering: testimus docs convert ${input.id} --pdf <file.pdf>`,
        );
      const r = input.region;
      if (r && (r[2] - r[0] < 0.02 || r[3] - r[1] < 0.02))
        throw new UserError(
          "The region is empty.",
          "Give [left, top, right, bottom] with left < right and top < bottom.",
        );
      let out: Awaited<ReturnType<typeof renderPage>>;
      try {
        out = await renderPage(readFileSync(pdf), input.page, r as [number, number, number, number] | undefined);
      } catch (e) {
        if (e instanceof RangeError) throw new UserError(e.message, "Give a page number the PDF has.");
        throw e;
      }
      const name = r ? `p${input.page}-${r.map((v) => Math.round(v * 100)).join("-")}.png` : `p${input.page}.png`;
      const file = join(project, ".testimus", "pages", input.id, name);
      mkdirSync(join(file, ".."), { recursive: true });
      writeAtomic(file, out.png);
      return { file, page: input.page, pages: out.pages, width: out.width, height: out.height };
    },
  }),
  command({
    name: "docs.list",
    summary: "List the project's documents with their status and index freshness.",
    input: z.object({ status: status.optional().describe("Only the documents with this status") }),
    output: z.array(
      docJson.extend({
        indexed: z
          .enum(["fresh", "stale", "missing"])
          .describe(
            "Index state: missing until an index run read it; stale when its text changed since, or the active model's vectors are incomplete; fresh otherwise (the rule of rag.status)",
          ),
      }),
    ),
    mutates: false,
    async run(ctx, input) {
      const all = await docsFreshness(projectOf(ctx));
      return input.status ? all.filter((d) => d.status === input.status) : all;
    },
  }),
  command({
    name: "docs.show",
    summary: "Show a document: metadata, context, table of contents, figures and its text.",
    input: z.object({
      id,
      anchor: z
        .string()
        .optional()
        .describe("Return only this part of doc.md: §5.6.6 (a section and its subsections), fig:40, page:59"),
      brief: z
        .boolean()
        .optional()
        .describe(
          "Leave the text out (md empty): the facts, outline and figures only — what a conversion has written so far",
        ),
    }),
    output: z.object({
      doc: docJson,
      context: z.string().describe("What the team says about this document (context.md)"),
      contextMtime: mtime,
      contexts: z
        .array(z.string())
        .describe("Saved contexts Claude reads with this document: its own list, else the project's defaults"),
      toc: z
        .array(
          z.object({
            anchor: z.string().describe("Section anchor, §N"),
            title: z.string().describe("Heading title, without its number"),
            level: z.number().describe("Depth, 1 for a chapter"),
          }),
        )
        .describe("The sections of doc.md, in order"),
      figures: z
        .array(figure)
        .describe(
          "The figures of the text in reading order: figures.json, and the captions with no picture (a table, or a lost picture)",
        ),
      md: z.string().describe("doc.md, or the asked part of it; empty with brief"),
      section: z
        .string()
        .optional()
        .describe("With an anchor: the section (§…) whose heading holds it, the toc entry to show as current"),
    }),
    mutates: false,
    positional: ["id", "anchor"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc = readDoc(project, input.id);
      const full = readDocMd(project, input.id);
      let md = full;
      let section: string | undefined;
      if (input.anchor) {
        const part = sectionOf(full, input.anchor);
        if (part === null)
          throw new UserError(
            `No anchor ${input.anchor} in ${input.id}.`,
            `testimus docs show ${input.id} lists its toc.`,
          );
        md = part;
        section = headingAt(full, input.anchor) ?? undefined;
      }
      return {
        doc,
        context: readContext(project, input.id),
        contextMtime: contextMtime(project, input.id),
        contexts: docContexts(project, input.id),
        toc: tocOf(full),
        figures: docFigures(full, readFigures(project, input.id)).map(({ n: _, ...f }) => f),
        md: input.brief ? "" : md,
        ...(section ? { section } : {}),
      };
    },
  }),
  command({
    name: "docs.set",
    summary: "Change what the team decides about a document: status, amends, title, context, saved contexts.",
    input: z.object({
      id,
      status: status.optional().describe("draft, submitted or validated"),
      amends: z.array(z.string()).optional().describe("Ids of the documents this one amends; empty list clears it"),
      title: z.string().optional().describe("Document title"),
      version: z.string().optional().describe("Document version, e.g. 01.01"),
      date: z.string().optional().describe("Document date, YYYY-MM-DD"),
      kind: kind.optional().describe("spec, minutes or other"),
      context: z.string().optional().describe("What the team says about this document; replaces context.md"),
      ifMtime: z
        .number()
        .nullable()
        .optional()
        .describe(
          "With context: the contextMtime docs.show gave; the save is refused (code conflict) when context.md changed on disk since",
        ),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved contexts Claude reads with this document, every time (doc.json contexts); replaces the list, [] = none",
      ),
    }),
    output: docJson.extend({ contextMtime: mtime }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc: DocJson = readDoc(project, input.id);
      for (const other of input.amends ?? [])
        if (other) {
          if (other === input.id)
            throw new UserError("A document cannot refer to itself.", "Give the ids of the documents it amends.");
          readDoc(project, other);
        }
      if (
        input.context !== undefined &&
        input.ifMtime !== undefined &&
        contextMtime(project, input.id) !== input.ifMtime
      )
        throw new UserError(
          `The context of ${input.id} changed on disk since it was read.`,
          "Read it again (docs.show), then save.",
          "conflict",
        );
      if (input.status) doc.status = input.status;
      if (input.title !== undefined) doc.title = input.title;
      if (input.version !== undefined) doc.version = input.version;
      if (input.date !== undefined) doc.date = input.date;
      if (input.kind) doc.kind = input.kind;
      if (input.amends !== undefined) {
        if (input.amends.length) doc.amends = input.amends;
        else delete doc.amends;
      }
      writeDoc(project, doc);
      if (input.context !== undefined) writeContext(project, input.id, input.context);
      if (input.contexts) writeDocContexts(project, input.id, input.contexts);
      return { ...readDoc(project, input.id), contextMtime: contextMtime(project, input.id) };
    },
  }),
  command({
    name: "docs.remove",
    summary:
      "Remove a document and every trace of it: its folder (copy, doc.md, figures, context), its passages, vectors and links in the search index, and the other documents' references to it. Tests that cite it keep their sources and are re-checked, so they report the missing document. dryRun says what would go and which tests cite it.",
    input: z.object({
      id,
      dryRun: z
        .boolean()
        .default(false)
        .describe("Return what would be removed and the tests that cite the document, without removing anything"),
    }),
    output: z.object({
      removed: z.string().describe("Id of the removed document (to be removed, with dryRun)"),
      folder: z.string().describe("The folder that was deleted (to be deleted, with dryRun)"),
      unlinked: z.array(z.string()).describe("Documents that named it in amends and no longer do (or would not)"),
      citedBy,
      passages: z.number().describe("Its passages in the search index, removed in every vector space (or to be)"),
      dryRun: z.boolean().describe("True when nothing was removed"),
    }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc = readDoc(project, input.id);
      const folder = docDir(project, input.id);
      const cited = testsCiting(project, doc);
      const passages = withIndex(project, 0, (db) => chunksOf(db, input.id).length);
      if (input.dryRun)
        return {
          removed: input.id,
          folder,
          unlinked: amendedBy(project, input.id),
          citedBy: cited,
          passages,
          dryRun: true,
        };
      const unlinked = removeDoc(project, input.id);
      unindexDoc(project, input.id);
      if (cited.length)
        recheckMechanical(
          project,
          cited.map((t) => t.id),
        );
      return { removed: input.id, folder, unlinked, citedBy: cited, passages, dryRun: false };
    },
  }),
  command({
    name: "docs.describeFigures",
    summary:
      "Have Claude describe the figures of a document (or of every document) in figures.json, for search and review.",
    input: z.object({
      docId: z.string().optional().describe("Document id (folder under docs/); default: every document"),
      force: z.boolean().default(false).describe("Describe again the figures that already have a description"),
      anchors: z
        .array(z.string())
        .optional()
        .describe("Only these figures (fig:… anchors, with docId), described again even when they have a description"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Effort level (default: low)"),
    }),
    output: z.object({
      docs: z
        .array(
          z.object({
            docId: z.string().describe("The document"),
            figures: z.number().describe("Its figures"),
            described: z.number().describe("Figures with a description now"),
            missing: z.array(z.string()).describe("Figure anchors Claude gave no description for"),
            runIds: z.array(z.string()).describe("The Claude runs"),
            costUsd: z.number().describe("What they cost"),
          }),
        )
        .describe("Each document looked at"),
    }),
    mutates: true,
    job: "describe-figures",
    subject: (i) => i.docId ?? "all documents",
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (input.anchors && !input.docId)
        throw new UserError("anchors names figures of one document: give its docId too.", "testimus docs list");
      const root = join(project, "docs");
      const ids = input.docId
        ? [input.docId]
        : existsSync(root)
          ? readdirSync(root).filter((d) => existsSync(join(root, d, "doc.md")))
          : [];
      const docs = [];
      for (const id of ids) {
        if (ctx.signal.aborted) break;
        docs.push(
          await describeFigures(project, id, ctx, {
            force: input.force,
            anchors: input.anchors,
            model: input.model,
            effort: input.effort,
          }),
        );
      }
      return { docs };
    },
  }),
];
