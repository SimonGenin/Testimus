import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { triage } from "../claude/actions.ts";
import { describeFigures, shouldDescribeFigures } from "../claude/figures.ts";
import { docContexts, docRunLines, type JobRun, writeDocContexts } from "../claude/prompt.ts";
import { type Command, type Ctx, command, projectOf, UserError } from "../command.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { recheckMechanical, testsCiting } from "../lib/check.ts";
import {
  addDoc,
  attachPdf,
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
  writeContext,
  writeDoc,
} from "../lib/docs.ts";
import { parseSections } from "../rag/chunk.ts";
import { anchorsOf } from "../rag/convert.ts";
import { unindexDoc } from "../rag/indexer.ts";
import { type EvidenceOpts, evidenceOptions, statementsOf } from "../rag/statements.ts";
import type { DocJson } from "../types.ts";
import { CONTEXT_IDS, EFFORT, MODEL, NOTE } from "./claude.ts";

// ponytail: a traced section is fine when it is the defining section or one of its ancestors (the matrix
// often names the chapter); anything else is reported, never corrected
export function tracedElsewhere(docId: string, md: string, opts: EvidenceOpts) {
  const known = new Set(parseSections(md).map((s) => s.anchor));
  const out: { req: string; defined: string; traced: string[]; message: string }[] = [];
  for (const st of statementsOf(docId, md, opts).values()) {
    if (st.anchor.includes("@matrix") || !st.traced.length || !st.section) continue;
    const inside = (t: string) => st.section === t || st.section.startsWith(`${t}.`);
    if (st.traced.some(inside)) continue;
    const missing = st.traced.filter((t) => !known.has(t));
    out.push({
      req: st.id,
      defined: st.section,
      traced: st.traced,
      message: missing.length
        ? `${st.id} is defined in ${st.section} but the matrix traces it to ${st.traced.join(", ")}, which this document does not have.`
        : `${st.id} is defined in ${st.section} but the matrix traces it to ${st.traced.join(", ")}.`,
    });
  }
  return out;
}

async function withFigures(ctx: Ctx, doc: DocJson, claude: JobRun): Promise<DocJson> {
  const project = projectOf(ctx);
  if (!shouldDescribeFigures(project) || !doc.stats?.figures) return doc;
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

const kind = z.enum(["spec", "requirements", "minutes", "other"]);
const status = z.enum(["draft", "submitted", "validated"]);

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
  stats: z
    .object({ sections: z.number(), figures: z.number(), requirements: z.number(), chars: z.number() })
    .optional(),
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
      triage: triageOn,
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
        const added = await addDoc(
          project,
          { file, pdf, id: input.id, kind: input.kind, convert: input.convert },
          ctx.signal,
          (message) => ctx.progress({ message }),
        );
        const doc = input.dataBase64
          ? { ...added, source: { ...added.source, path: `upload: ${basename(input.name || "document.docx")}` } }
          : added;
        if (doc !== added) writeDoc(project, doc);
        if (!input.convert) return { ...doc, citedBy: [] };
        await withFigures(ctx, doc, runOf(input));
        const citing = recheckCiting(ctx, doc);
        await withTriage(ctx, doc, runOf(input), input.triage);
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
      triage: triageOn,
    }),
    output: docJson.extend({ citedBy }),
    mutates: true,
    job: "docs.convert",
    positional: ["id"],
    subject: (i) => i.id,
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (input.pdf) attachPdf(project, input.id, input.pdf);
      const doc = await withFigures(
        ctx,
        await reconvertDoc(project, input.id, ctx.signal, (message) => ctx.progress({ message })),
        runOf(input),
      );
      const citing = recheckCiting(ctx, doc);
      await withTriage(ctx, doc, runOf(input), input.triage);
      return { ...doc, citedBy: citing };
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
    summary: "Show a document: metadata, context, table of contents, requirement ids, figures and its text.",
    input: z.object({
      id,
      anchor: z
        .string()
        .optional()
        .describe(
          "Return only this part of doc.md: §5.6.6 (a section and its subsections), req:EXI_…, fig:40, page:59",
        ),
      brief: z
        .boolean()
        .optional()
        .describe(
          "Leave the text out (md empty, no info): the facts, outline and figures only — what a conversion has written so far",
        ),
    }),
    output: z.object({
      doc: docJson,
      context: z.string().describe("What the team says about this document (context.md)"),
      contexts: z
        .array(z.string())
        .describe("Saved contexts Claude reads with this document: its own list, else the project's defaults"),
      toc: z.array(z.object({ anchor: z.string(), title: z.string(), level: z.number() })),
      requirements: z.array(z.string()),
      figures: z.array(figure),
      md: z.string(),
      section: z
        .string()
        .optional()
        .describe("With an anchor: the section (§…) whose heading holds it, the toc entry to show as current"),
      info: z
        .array(
          z.object({
            req: z.string().describe("Requirement id"),
            defined: z.string().describe("Section whose text defines it, e.g. §3.2.4.2"),
            traced: z.array(z.string()).describe("Sections the requirement matrix traces it to, e.g. [§3.2.4]"),
            message: z.string().describe("What differs, in a sentence"),
          }),
        )
        .describe(
          "Requirements whose matrix Section column names another section than the one defining them — often the sign that the matrix and the body disagree",
        ),
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
        requirements: [...new Set(anchorsOf(full).requirements)],
        figures: readFigures(project, input.id),
        md: input.brief ? "" : md,
        ...(section ? { section } : {}),
        info: input.brief ? [] : tracedElsewhere(input.id, full, evidenceOptions(project)),
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
      kind: kind.optional().describe("spec, requirements, minutes or other"),
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
