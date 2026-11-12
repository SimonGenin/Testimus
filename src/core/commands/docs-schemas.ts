import { z } from "zod";
import { CONTEXT_IDS, EFFORT, MODEL } from "../claude/schemas.ts";
import { REVIEW } from "../schemas.ts";
import { DOC_STAGES, STAGE_STEPS } from "../types.ts";
import { MEDIA_FILE, SOURCE_TYPE } from "./media-schemas.ts";

export const kind = z.enum(["spec", "minutes", "other"]);
export const status = z.enum(["draft", "submitted", "validated"]);

export const conversion = z
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

export const pdfProfile = z
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

export const docxProfile = z
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

const pendingFile = z.object({
  path: z.string().describe("Full path of the original on this PC"),
  size: z.number().describe("Its size in bytes"),
  duration: z.number().optional().describe("A video: its length in seconds, read when it came in"),
  audio: z.boolean().optional().describe("A video: whether it has sound"),
  tracks: z.number().optional().describe("A video: its sound tracks"),
  picture: z.boolean().optional().describe("A video: false for a recording of sound alone"),
});

export const pending = z
  .object({
    files: z.array(pendingFile).describe("The originals it will copy (several for the images of a folder)"),
    pdf: pendingFile.optional().describe("The .pdf rendering of a .docx, copied with it"),
    at: z.string().describe("When it came in, ISO time"),
    failed: z.string().optional().describe("Why the last start could not copy it"),
  })
  .describe("Set while the document waits for docs.start: nothing is copied nor converted yet");

export const docStage = z
  .object({
    name: z
      .enum(DOC_STAGES)
      .describe(
        "pending: waiting for docs.start · copying · not-converted: copied, never converted · converting · waiting-index: converted, waiting for an index pass · indexing · not-indexed · ready: search reads its current text · stale: search reads an older text · failed",
      ),
    step: z
      .enum(STAGE_STEPS)
      .optional()
      .describe(
        "copying or converting: waiting (its turn has not come); converting: text, figures (Word, PDF), pictures (images read by Claude), transcribing, frames (a video), checking (the citing tests, the warnings); failed: copy, convert or index",
      ),
    done: z.number().optional().describe("How far it got (bytes copied, items done)"),
    total: z.number().optional().describe("Out of"),
    percent: z.number().optional().describe("done of total, 0 to 100"),
    before: z.number().optional().describe("waiting-index: the documents the running index pass reads first"),
    bytes: z.number().optional().describe("pending: the bytes a start will copy"),
    message: z.string().optional().describe("failed: why"),
  })
  .describe("Where the document is, worked out from its files and the jobs running; never stored");

export const docJson = z.object({
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
      type: SOURCE_TYPE.optional().describe(
        "What the document is made of (absent: read from file's extension — docx, pdf or txt)",
      ),
      name: z
        .string()
        .describe(
          "Where the original came from: its path on this PC, or the uploaded file's name (an images document: its first file)",
        ),
      uploaded: z.boolean().optional().describe("Sent from the page rather than read from a path"),
      files: z
        .array(MEDIA_FILE)
        .optional()
        .describe("An images or video document's files, by number (file is then « files », sha256 their hashes')"),
      last: z.number().optional().describe("The highest number a file of the document ever had"),
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
  reference: z
    .boolean()
    .optional()
    .describe(
      "An images or video document the team marked as showing the reference behaviour: an expected result sourced from it alone is not flagged observed-only",
    ),
  relatesTo: z
    .array(z.string())
    .optional()
    .describe("Ids of the documents this one is about (photos once attached to a document): shown, never an amendment"),
  pending: pending.optional(),
});

export const figure = z.object({
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
export const id = z.string().describe("Document id (the folder name under docs/, e.g. SOSIE_211_D401-1_3)");
export const model = MODEL.optional().describe(
  "Claude model for the figure descriptions (default: project.json claude.model)",
);
export const effort = EFFORT.optional().describe("Claude effort for the figure descriptions (default: low)");
export const contexts = CONTEXT_IDS.optional().describe(
  "Saved contexts Claude reads for this conversion only, on top of the document's own (docs.set contexts)",
);
export const after = {
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
export const citedBy = z
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
export const converted = docJson.extend({
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
export const mtime = z
  .number()
  .nullable()
  .describe("Modification time of context.md in ms (null: no context.md yet), to notice a change made on disk");
