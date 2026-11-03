import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { z } from "zod";
import { triage } from "../claude/actions.ts";
import { describeFigures, shouldDescribeFigures } from "../claude/figures.ts";
import { docContexts, docRunLines, type JobRun, writeDocContexts } from "../claude/prompt.ts";
import { checkConversion, sameConversion, studyDoc } from "../claude/study.ts";
import { type Command, type Ctx, command, projectOf, UserError } from "../command.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { recheckMechanical, testsCiting } from "../lib/check.ts";
import {
  addDoc,
  attachDocx,
  attachPdf,
  convertedCopy,
  docDir,
  headingAt,
  listDocs,
  readContext,
  readDoc,
  readDocMd,
  readFigures,
  reconvertDoc,
  removeDoc,
  sectionOf,
  tocOf,
  twinOf,
  writeContext,
  writeDoc,
} from "../lib/docs.ts";
import { unindexDoc } from "../rag/indexer.ts";
import { hintsOf, inspectDocx, inspectPdf } from "../rag/inspect.ts";
import { renderPage } from "../rag/pdf.ts";
import type { DocConversion, DocJson } from "../types.ts";
import { CONTEXT_IDS, EFFORT, MODEL, NOTE } from "./claude.ts";

const AFTER_CONVERT = [
  { id: "figures", label: "Describe the figures" },
  { id: "cited", label: "Re-check the tests citing it" },
  { id: "triage", label: "Look at the conversion problems" },
];

async function withFigures(ctx: Ctx, doc: DocJson, claude: JobRun, on: boolean | undefined): Promise<DocJson> {
  const project = projectOf(ctx);
  if (!(on ?? shouldDescribeFigures(project)) || !doc.stats?.figures) return doc;
  ctx.step?.("figures");
  try {
    ctx.progress({ message: "Claude describes the figures" });
    await describeFigures(project, doc.id, ctx, claude);
  } catch (e) {
    ctx.log("warn", `Figure descriptions skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}

// ponytail: the conversion warnings are shown to Claude with the import's own model and effort — it leaves a
// Claude action for those it can fix; a failed look never fails the import
async function withTriage(ctx: Ctx, doc: DocJson, claude: JobRun, on: boolean | undefined): Promise<void> {
  if (!on || !doc.warnings.length) return;
  ctx.step?.("triage");
  try {
    const problems = doc.warnings.map((text) => ({ where: `doc:${doc.id}`, text }));
    const project = projectOf(ctx);
    await triage(
      ctx,
      project,
      problems,
      `the document ${doc.id}`,
      claude,
      "import",
      docRunLines(project, doc.id, claude),
    );
  } catch (e) {
    ctx.log("warn", `Claude did not look at the warnings: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ponytail: the profile Claude studies — of the copies in the document's folder, or of a file not added yet and
// the other copy saved beside it
function inspectFiles(files: { docx?: string; pdf?: string }, signal: AbortSignal) {
  return Promise.all([
    files.docx ? inspectDocx(readFileSync(files.docx)) : undefined,
    files.pdf ? inspectPdf(readFileSync(files.pdf), signal) : undefined,
  ]);
}

async function inspect(ctx: Ctx, input: { id?: string; file?: string }) {
  if (!input.id === !input.file) throw new UserError("Give either id or file.");
  if (input.file) {
    const ext = extname(input.file).toLowerCase();
    if (!existsSync(input.file) || (ext !== ".docx" && ext !== ".pdf"))
      throw new UserError(`Not a .docx or .pdf file: ${input.file}`);
    const twin = twinOf(input.file);
    const files =
      ext === ".docx" ? { docx: input.file, pdf: twin ?? undefined } : { pdf: input.file, docx: twin ?? undefined };
    const [docx, pdf] = await inspectFiles(files, ctx.signal);
    const converts = files.docx ? "docx" : "pdf";
    return {
      files,
      converts,
      twin,
      ...(docx && { docx }),
      ...(pdf && { pdf }),
      hints: hintsOf({ docx, pdf, converts }),
    } as const;
  }
  const project = projectOf(ctx);
  const doc = readDoc(project, input.id!);
  const dir = docDir(project, doc.id);
  const at = (f: string) => (existsSync(join(dir, f)) ? join(dir, f) : undefined);
  const files = { docx: at("source.docx"), pdf: at("source.pdf") };
  const [docx, pdf] = await inspectFiles(files, ctx.signal);
  const converts = extname(convertedCopy(project, doc)).toLowerCase() === ".pdf" ? "pdf" : "docx";
  const other = twinOf(doc.source.path);
  const twin = other && !at(`source${extname(other).toLowerCase()}`) ? other : null;
  return {
    id: doc.id,
    files: Object.fromEntries(
      Object.entries(files)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, relative(project, v!).replace(/\\/g, "/")]),
    ),
    converts,
    twin,
    ...(doc.conversion && { conversion: doc.conversion }),
    ...(docx && { docx }),
    ...(pdf && { pdf }),
    hints: hintsOf({ docx, pdf, twin, converts }),
  } as const;
}

function setConversion(project: string, id: string, conversion: DocConversion): DocJson {
  const { conversion: _, ...doc } = readDoc(project, id);
  const next: DocJson = Object.keys(conversion).length ? { ...doc, conversion } : doc;
  writeDoc(project, next);
  return next;
}

// ponytail: with study, Claude looks at the original before converting (its choice is kept in doc.json, so every
// reconversion gives the same result) and compares the result with the pages after; it may ask for one more
// conversion with other options. A Claude run that fails never fails the conversion.
async function convertWith(
  ctx: Ctx,
  id: string,
  o: { study?: boolean; conversion?: DocConversion },
  claude: JobRun,
): Promise<DocJson> {
  const project = projectOf(ctx);
  const progress = (message: string) => ctx.progress({ message });
  const hasPdf = () => existsSync(join(docDir(project, id), "source.pdf"));
  if (o.conversion) setConversion(project, id, o.conversion);
  else if (o.study && hasPdf())
    try {
      const doc = readDoc(project, id);
      const r = await studyDoc(ctx, project, doc, await inspect(ctx, { id }), claude);
      if (r.conversion) setConversion(project, id, r.conversion);
      else ctx.log("warn", `Claude's study of ${id} gave no options: ${r.summary.slice(0, 300)}`);
    } catch (e) {
      ctx.log("warn", `Claude did not study ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  else if (o.study) ctx.log("info", `${id} has no PDF to look at: Claude's study and check are skipped.`);
  let doc = await reconvertDoc(project, id, ctx.signal, progress);
  if (!o.study || !hasPdf()) return doc;
  try {
    const r = await checkConversion(ctx, project, doc, claude);
    if (r.conversion && !sameConversion(r.conversion, doc.conversion)) {
      setConversion(project, id, r.conversion);
      progress("Converting again with the options Claude chose");
      doc = await reconvertDoc(project, id, ctx.signal, progress);
    } else if (r.conversion?.notes && r.conversion.notes !== doc.conversion?.notes)
      doc = setConversion(project, id, { ...doc.conversion, notes: r.conversion.notes });
  } catch (e) {
    ctx.log("warn", `Claude did not check ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}

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

const docJson = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  version: z.string(),
  date: z.string(),
  kind,
  status,
  amends: z.array(z.string()).optional(),
  source: z.object({ path: z.string(), sha256: z.string(), file: z.string() }),
  convertedWith: z.string(),
  convertedAt: z.string(),
  warnings: z.array(z.string()),
  stats: z.object({ sections: z.number(), figures: z.number(), chars: z.number() }).optional(),
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
});
const id = z.string().describe("Document id (the folder name under docs/, e.g. SOSIE_211_D401-1_3)");
const model = MODEL.optional().describe(
  "Claude model for the figure descriptions (default: project.json claude.model)",
);
const effort = EFFORT.optional().describe("Claude effort for the figure descriptions (default: low)");
const triageOn = z
  .boolean()
  .optional()
  .describe("Then have Claude look at the conversion warnings and propose a Claude action for those it can fix");
const figuresOn = z
  .boolean()
  .optional()
  .describe(
    "Have Claude describe the figures not described yet, after the conversion (default: project.json rag.describeFigures, on)",
  );
const studyOn = z
  .boolean()
  .optional()
  .describe(
    "Claude studies the original first (docs.inspect, page images) and chooses how it is converted, then compares doc.md with the pages and may convert once more or propose Claude actions; needs a PDF copy. Replaces triage",
  );
const contexts = CONTEXT_IDS.optional().describe(
  "Saved contexts Claude reads for this conversion only, on top of the document's own (docs.set contexts)",
);
const runOf = (i: { model?: string; effort?: JobRun["effort"]; note?: string; contexts?: string[] }): JobRun => ({
  model: i.model,
  effort: i.effort,
  note: i.note,
  contexts: i.contexts,
});
const citedBy = z
  .array(
    z.object({
      id: z.string().describe("Test id (its folder under tests/)"),
      key: z.string().optional().describe("Jira key, once the test is in Xray"),
      summary: z.string().describe("Test summary"),
      review: z.enum(["draft", "checked", "to-fix", "validated"]).describe("Where the test is in the review"),
      steps: z.number().describe("Steps with a source that cites the document"),
    }),
  )
  .describe("Tests whose sources cite this document; their mechanical check is redone against the new text");

// ponytail: a test whose document changed did not change itself, so its check.json would stay « fresh » —
// the tests that cite the document are re-checked whenever its text appears, changes or goes
function recheckCiting(ctx: Ctx, doc: DocJson): z.input<typeof citedBy> {
  const project = projectOf(ctx);
  const cited = testsCiting(project, doc);
  if (!cited.length) return cited;
  ctx.progress({
    message: `Re-checking the ${cited.length === 1 ? "test" : `${cited.length} tests`} citing ${doc.code}`,
  });
  recheckMechanical(
    project,
    cited.map((t) => t.id),
  );
  return cited;
}

export const commands: Command[] = [
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
      describeFigures: figuresOn,
      triage: triageOn,
      study: studyOn,
      conversion: conversion.optional(),
    }),
    output: docJson.extend({ citedBy }),
    mutates: true,
    job: "docs.add",
    positional: ["file"],
    subject: (i) => i.file ?? i.name ?? "upload",
    async run(ctx, input) {
      const project = projectOf(ctx);
      const up = join(project, ".testimus", "uploads", randomBytes(4).toString("hex"));
      const save = (name: string | undefined, b64: string) => {
        mkdirSync(up, { recursive: true });
        const path = join(up, basename(name || "document.docx"));
        writeAtomic(path, Buffer.from(b64, "base64"));
        return path;
      };
      const file = input.dataBase64 ? save(input.name, input.dataBase64) : input.file;
      if (!file) throw new UserError("No document given.", "Give --file <path>, or name + dataBase64.");
      const pdf = input.pdfBase64 ? save(input.pdfName ?? "rendering.pdf", input.pdfBase64) : input.pdf;
      try {
        const studied = input.convert && (input.study || !!input.conversion);
        ctx.steps?.(
          input.convert
            ? [
                ...(studied ? [{ id: "copy", label: "Copy the original" }] : []),
                { id: "convert", label: studied ? "Study and convert" : "Copy and convert" },
                ...AFTER_CONVERT,
              ]
            : [{ id: "copy", label: "Copy the original" }],
        );
        ctx.step?.(studied || !input.convert ? "copy" : "convert");
        const added = await addDoc(
          project,
          { file, pdf, id: input.id, kind: input.kind, convert: input.convert && !studied },
          ctx.signal,
          (message) => ctx.progress({ message }),
        );
        let doc = input.dataBase64
          ? { ...added, source: { ...added.source, path: `upload: ${basename(input.name || "document.docx")}` } }
          : added;
        if (doc !== added) writeDoc(project, doc);
        if (!input.convert) return { ...doc, citedBy: [] };
        if (studied)
          try {
            ctx.step?.("convert");
            doc = await convertWith(ctx, doc.id, input, runOf(input));
          } catch (e) {
            rmSync(docDir(project, doc.id), { recursive: true, force: true });
            throw e;
          }
        await withFigures(ctx, doc, runOf(input), input.describeFigures);
        ctx.step?.("cited");
        const citing = recheckCiting(ctx, doc);
        if (!input.study) await withTriage(ctx, doc, runOf(input), input.triage);
        return { ...doc, citedBy: citing };
      } finally {
        rmSync(up, { recursive: true, force: true });
      }
    },
  }),
  command({
    name: "docs.convert",
    summary:
      "Convert a document from its copied source (the first time for one added without conversion); team fields and figure descriptions are kept.",
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
      describeFigures: figuresOn,
      triage: triageOn,
      study: studyOn,
      conversion: conversion
        .optional()
        .describe("Convert with these options, kept in doc.json for every later reconversion; {} clears them"),
    }),
    output: docJson.extend({ citedBy }),
    mutates: true,
    job: "docs.convert",
    positional: ["id"],
    subject: (i) => i.id,
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (input.pdf) attachPdf(project, input.id, input.pdf);
      if (input.docx) attachDocx(project, input.id, input.docx);
      ctx.steps?.([{ id: "convert", label: input.study ? "Study and convert" : "Convert to text" }, ...AFTER_CONVERT]);
      ctx.step?.("convert");
      const doc = await withFigures(
        ctx,
        await convertWith(ctx, input.id, input, runOf(input)),
        runOf(input),
        input.describeFigures,
      );
      ctx.step?.("cited");
      const citing = recheckCiting(ctx, doc);
      if (!input.study) await withTriage(ctx, doc, runOf(input), input.triage);
      return { ...doc, citedBy: citing };
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
    mutates: false,
    positional: ["id"],
    run: (ctx, input) => inspect(ctx, input),
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
        if (e instanceof RangeError) throw new UserError(e.message);
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
    output: z.array(docJson.extend({ indexed: z.enum(["fresh", "stale", "missing"]) })),
    mutates: false,
    async run(ctx, input) {
      const all = listDocs(projectOf(ctx));
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
      contexts: z
        .array(z.string())
        .describe("Saved contexts Claude reads with this document: its own list, else the project's defaults"),
      toc: z.array(z.object({ anchor: z.string(), title: z.string(), level: z.number() })),
      figures: z.array(figure),
      md: z.string(),
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
        contexts: docContexts(project, input.id),
        toc: tocOf(full),
        figures: readFigures(project, input.id),
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
      contexts: CONTEXT_IDS.optional().describe(
        "Saved contexts Claude reads with this document, every time (docs/<id>/claude.json); replaces the list, [] = none",
      ),
    }),
    output: docJson,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc: DocJson = readDoc(project, input.id);
      for (const other of input.amends ?? [])
        if (other) {
          if (other === input.id) throw new UserError("A document cannot refer to itself.");
          readDoc(project, other);
        }
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
      return doc;
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
      dryRun: z.boolean().describe("True when nothing was removed"),
    }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc = readDoc(project, input.id);
      const folder = docDir(project, input.id);
      const cited = testsCiting(project, doc);
      if (input.dryRun) {
        const unlinked = listDocs(project)
          .filter((d) => d.amends?.includes(input.id))
          .map((d) => d.id);
        return { removed: input.id, folder, unlinked, citedBy: cited, dryRun: true };
      }
      const unlinked = removeDoc(project, input.id);
      unindexDoc(project, input.id);
      if (cited.length)
        recheckMechanical(
          project,
          cited.map((t) => t.id),
        );
      return { removed: input.id, folder, unlinked, citedBy: cited, dryRun: false };
    },
  }),
];
