import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { describeFigures, shouldDescribeFigures } from "../claude/figures.ts";
import { type Command, type Ctx, command, projectOf, UserError } from "../command.ts";
import {
  addDoc,
  docDir,
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
import { type EvidenceOpts, evidenceOptions, statementsOf } from "../rag/statements.ts";
import type { DocJson } from "../types.ts";

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

async function withFigures(ctx: Ctx, doc: DocJson): Promise<DocJson> {
  const project = projectOf(ctx);
  if (!shouldDescribeFigures(project) || !doc.stats?.figures) return doc;
  try {
    ctx.progress({ message: "Claude describes the figures" });
    await describeFigures(project, doc.id, ctx);
  } catch (e) {
    ctx.log("warn", `Figure descriptions skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}

const kind = z.enum(["spec", "requirements", "minutes", "other"]);
const status = z.enum(["draft", "submitted", "validated", "superseded"]);
const binding = z.enum(["mandatory", "applicable", "informative"]);

const docJson = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  version: z.string(),
  date: z.string(),
  kind,
  status,
  binding,
  supersededBy: z.string().optional(),
  amends: z.array(z.string()).optional(),
  source: z.object({ path: z.string(), sha256: z.string(), file: z.string() }),
  convertedWith: z.string(),
  convertedAt: z.string(),
  warnings: z.array(z.string()),
  stats: z
    .object({ sections: z.number(), figures: z.number(), requirements: z.number(), chars: z.number() })
    .optional(),
});

const figure = z.object({ file: z.string(), anchor: z.string(), caption: z.string(), description: z.string() });
const id = z.string().describe("Document id (the folder name under docs/, e.g. SOSIE_211_D401-1_3)");

export const commands: Command[] = [
  command({
    name: "docs.add",
    summary: "Copy a .docx (preferred) or .pdf into the project and convert it to doc.md with anchors and figures.",
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
    }),
    output: docJson,
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
        writeFileSync(path, Buffer.from(b64, "base64"));
        return path;
      };
      const file = input.dataBase64 ? save(input.name, input.dataBase64) : input.file;
      if (!file) throw new UserError("No document given.", "Give --file <path>, or name + dataBase64.");
      const pdf = input.pdfBase64 ? save(input.pdfName ?? "rendering.pdf", input.pdfBase64) : input.pdf;
      try {
        const added = await addDoc(project, { file, pdf, id: input.id, kind: input.kind }, ctx.signal, (message) =>
          ctx.progress({ message }),
        );
        const doc = input.dataBase64
          ? { ...added, source: { ...added.source, path: `upload: ${basename(input.name || "document.docx")}` } }
          : added;
        if (doc !== added) writeDoc(project, doc);
        return await withFigures(ctx, doc);
      } finally {
        rmSync(up, { recursive: true, force: true });
      }
    },
  }),
  command({
    name: "docs.convert",
    summary: "Reconvert a document from its copied source; team fields and figure descriptions are kept.",
    input: z.object({ id }),
    output: docJson,
    mutates: true,
    job: "docs.convert",
    positional: ["id"],
    subject: (i) => i.id,
    async run(ctx, input) {
      return await withFigures(
        ctx,
        await reconvertDoc(projectOf(ctx), input.id, ctx.signal, (message) => ctx.progress({ message })),
      );
    },
  }),
  command({
    name: "docs.list",
    summary: "List the project's documents with their status, binding and index freshness.",
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
    }),
    output: z.object({
      doc: docJson,
      context: z.string(),
      toc: z.array(z.object({ anchor: z.string(), title: z.string(), level: z.number() })),
      requirements: z.array(z.string()),
      figures: z.array(figure),
      md: z.string(),
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
      if (input.anchor) {
        const part = sectionOf(full, input.anchor);
        if (part === null)
          throw new UserError(
            `No anchor ${input.anchor} in ${input.id}.`,
            `testimus docs show ${input.id} lists its toc.`,
          );
        md = part;
      }
      return {
        doc,
        context: readContext(project, input.id),
        toc: tocOf(full),
        requirements: [...new Set(anchorsOf(full).requirements)],
        figures: readFigures(project, input.id),
        md,
        info: tracedElsewhere(input.id, full, evidenceOptions(project)),
      };
    },
  }),
  command({
    name: "docs.set",
    summary: "Change what the team decides about a document: status, binding, supersededBy, amends, title, context.",
    input: z.object({
      id,
      status: status.optional().describe("draft, submitted, validated or superseded"),
      binding: binding.optional().describe("mandatory, applicable or informative"),
      supersededBy: z
        .string()
        .optional()
        .describe("Id of the document that replaces this one (sets status superseded); empty string clears it"),
      amends: z.array(z.string()).optional().describe("Ids of the documents this one amends; empty list clears it"),
      title: z.string().optional().describe("Document title"),
      version: z.string().optional().describe("Document version, e.g. 01.01"),
      date: z.string().optional().describe("Document date, YYYY-MM-DD"),
      kind: kind.optional().describe("spec, requirements, minutes or other"),
      context: z.string().optional().describe("What the team says about this document; replaces context.md"),
    }),
    output: docJson,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc: DocJson = readDoc(project, input.id);
      for (const other of [input.supersededBy, ...(input.amends ?? [])])
        if (other) {
          if (other === input.id) throw new UserError("A document cannot refer to itself.");
          readDoc(project, other);
        }
      if (input.status) doc.status = input.status;
      if (input.binding) doc.binding = input.binding;
      if (input.title !== undefined) doc.title = input.title;
      if (input.version !== undefined) doc.version = input.version;
      if (input.date !== undefined) doc.date = input.date;
      if (input.kind) doc.kind = input.kind;
      if (input.supersededBy !== undefined) {
        if (input.supersededBy) {
          doc.supersededBy = input.supersededBy;
          doc.status = "superseded";
        } else delete doc.supersededBy;
      }
      if (input.amends !== undefined) {
        if (input.amends.length) doc.amends = input.amends;
        else delete doc.amends;
      }
      writeDoc(project, doc);
      if (input.context !== undefined) writeContext(project, input.id, input.context);
      return doc;
    },
  }),
  command({
    name: "docs.remove",
    summary: "Remove a document folder (its copy, doc.md, figures and context) from the project.",
    input: z.object({ id }),
    output: z.object({ removed: z.string(), folder: z.string() }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const folder = docDir(project, input.id);
      removeDoc(project, input.id);
      return { removed: input.id, folder };
    },
  }),
];
