import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describeFigures } from "../claude/figures.ts";
import { readPictures } from "../claude/media.ts";
import { writeDocContexts } from "../claude/prompt.ts";
import { CONTEXT_IDS, EFFORT, MODEL } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { recheckMechanical, testsCiting } from "../lib/check.ts";
import {
  amendedBy,
  contextMtime,
  docDir,
  readDoc,
  readFigures,
  removeDoc,
  writeContext,
  writeDoc,
} from "../lib/docs.ts";
import { copyOf } from "../lib/docs-pending.ts";
import { filesOf, isMediaDoc } from "../lib/media.ts";
import { writeMediaMd } from "../lib/media-md.ts";
import { docName } from "../lib/names.ts";
import { overviewAfterImport } from "../lib/overview-after.ts";
import { fixedFrames, frameContext } from "../lib/video/pipeline.ts";
import { reportSeen } from "../lib/video/report.ts";
import { chunksOf, withIndex } from "../rag/db.ts";
import { unindexDoc } from "../rag/indexer.ts";
import type { DocJson } from "../types.ts";
import { citedBy, docJson, id, kind, mtime, status } from "./docs-schemas.ts";

export const commands = [
  command({
    name: "docs.set",
    summary:
      "Change what the team decides about a document: status, amends, title, context, saved contexts; for an images or video document, whether it is the reference (not observed) and the documents it is about.",
    input: z.object({
      id,
      status: status.optional().describe("draft, submitted or validated"),
      amends: z.array(z.string()).optional().describe("Ids of the documents this one amends; empty list clears it"),
      title: z.string().optional().describe("Document title"),
      version: z.string().optional().describe("Document version, e.g. 01.01"),
      date: z
        .string()
        .regex(/^(\d{4}-\d{2}-\d{2})?$/, "A date is written YYYY-MM-DD (or empty to clear it)")
        .optional()
        .describe("Document date, YYYY-MM-DD; empty clears it"),
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
      reference: z
        .boolean()
        .optional()
        .describe(
          "An images or video document: true when the team says it shows the reference behaviour (its sources then back an expected result), false when it only shows what the real system does (observed, the default); the citing tests are checked again",
        ),
      relatesTo: z
        .array(z.string())
        .optional()
        .describe("Ids of the documents this one is about; empty list clears it"),
    }),
    output: docJson.extend({ contextMtime: mtime }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const doc: DocJson = readDoc(project, input.id);
      for (const other of [...(input.amends ?? []), ...(input.relatesTo ?? [])])
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
      if (input.relatesTo !== undefined) {
        if (input.relatesTo.length) doc.relatesTo = input.relatesTo;
        else delete doc.relatesTo;
      }
      const flipped = input.reference !== undefined && !!doc.reference !== input.reference;
      if (input.reference !== undefined && !isMediaDoc(doc))
        throw new UserError(
          `${input.id} is a written document: it is a reference already.`,
          "Only an images or video document is observed until marked as the reference.",
        );
      if (input.reference) doc.reference = true;
      else if (input.reference === false) delete doc.reference;
      writeDoc(project, doc);
      if (isMediaDoc(doc) && input.title !== undefined && doc.converted) writeMediaMd(project, input.id);
      if (flipped)
        recheckMechanical(
          project,
          testsCiting(project, doc).map((t) => t.id),
        );
      if (input.context !== undefined) writeContext(project, input.id, input.context);
      if (input.contexts) writeDocContexts(project, input.id, input.contexts);
      return { ...readDoc(project, input.id), contextMtime: contextMtime(project, input.id) };
    },
  }),
  command({
    name: "docs.remove",
    summary:
      "Remove a document and every trace of it (one waiting to start leaves none: nothing was copied): its folder (copy, doc.md, figures, context), its passages, vectors and links in the search index, and the other documents' references to it. Tests that cite it keep their sources and are re-checked, so they report the missing document. dryRun says what would go and which tests cite it.",
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
      if (doc.pending && copyOf(project, input.id))
        throw new UserError(
          `${input.id} is being copied.`,
          "Cancel the start that copies it (its job), then remove it: it is then waiting to start again.",
          "copying",
        );
      const unlinked = removeDoc(project, input.id);
      unindexDoc(project, input.id);
      if (cited.length)
        recheckMechanical(
          project,
          cited.map((t) => t.id),
        );
      if (!doc.pending) overviewAfterImport(project);
      return { removed: input.id, folder, unlinked, citedBy: cited, passages, dryRun: false };
    },
  }),
  command({
    name: "docs.describeFigures",
    summary:
      "Have Claude describe the figures of a document (or of every document) in figures.json, for search and review; an images or video document's pictures (img:, frame:) are read the same way.",
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
    label: (i, project) => (i.docId ? docName(project, i.docId) : "All documents"),
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
      const run = { force: input.force, anchors: input.anchors, model: input.model, effort: input.effort };
      for (const id of ids) {
        if (ctx.signal.aborted) break;
        if (!isMediaDoc(readDoc(project, id))) {
          docs.push(await describeFigures(project, id, ctx, run));
          continue;
        }
        // ponytail: the same reading as a conversion's — a frame a person described is left alone, doc.md is
        // written again (a description is quotable there), and a test quoting what was written before is told
        const r = await readPictures(project, id, ctx, {
          ...run,
          context: frameContext(project, id),
          kept: fixedFrames(project, id),
        });
        writeMediaMd(project, id);
        reportSeen(
          project,
          id,
          filesOf(readDoc(project, id))
            .filter((x) => x.kind === "video")
            .map((x) => x.n),
        );
        const pictures = readFigures(project, id).filter((f) => f.file);
        docs.push({
          docId: id,
          figures: pictures.length,
          described: pictures.filter((f) => f.description.trim()).length,
          missing: r.missing,
          runIds: r.runIds,
          costUsd: r.costUsd,
        });
      }
      return { docs };
    },
  }),
];
