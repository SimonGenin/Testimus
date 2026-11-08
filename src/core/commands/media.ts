import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EFFORT, MODEL } from "../claude/schemas.ts";
import { type Ctx, command, projectOf, UserError } from "../command.ts";
import { docIds, readDoc, readFigures } from "../lib/docs.ts";
import {
  copyFiles,
  dropItem,
  dropLot,
  ensureMediaDir,
  findLot,
  itemAnchor,
  itemFigure,
  lotAnchor,
  lotCounts,
  mediaDir,
  newLot,
  ordered,
  type Rejected,
  readLotContext,
  updateLot,
  writeLotContext,
} from "../lib/media.ts";
import { afterAnnex, lotSteps, prepareLot, readLot, testsCitingLot, writeAnnex } from "../lib/media-pipeline.ts";
import { batchName, docName } from "../lib/names.ts";
import { REVIEW } from "../schemas.ts";
import type { DocJson, MediaLot } from "../types.ts";

const doc = z.string().describe("Document id (the folder name under docs/, e.g. SOSIE_211_D401-1_3)");
const lot = z.string().describe("Batch id, as media.list gives it (e.g. recette-tco-12-10)");
export const MEDIA_FILES = z
  .array(
    z.object({
      path: z.string().optional().describe("Path of the photo on this PC (the desktop app, the CLI); it is copied"),
      name: z.string().optional().describe("File name, with dataBase64 (a file sent from the page)"),
      dataBase64: z.string().optional().describe("Content of a file sent from the page, base64"),
    }),
  )
  .min(1)
  .describe("The photos (JPEG, PNG, WebP), each by path or by name and content; they are copied into the project");
const model = MODEL.optional().describe("Claude model that reads the photos (default: project.json claude.model)");
const effort = EFFORT.optional().describe("Claude effort for the photos (default: low)");
const index = z
  .boolean()
  .default(true)
  .describe(
    "Then update the search index in the same job, once the conversions running in this project are done (a failed index run keeps the batch)",
  );
const title = z.string().describe("The batch's title, as the annex heading shows it (e.g. Recette TCO 12/10)");
const context = z
  .string()
  .describe(
    "What the team says about the batch: where and when the photos were taken, which version (e.g. photos du TCO réel en recette, version 3.2); Claude reads it with the photos and the annex shows it",
  );
const reference = z
  .boolean()
  .describe(
    "The team says the batch shows the reference behaviour: an expected result sourced from it alone is no longer flagged observed-only",
  );

const kind = z.enum(["screen", "diagram", "symbol", "table-image", "photo"]);
const STATE = z
  .enum(["new", "ready", "analysed", "failed"])
  .describe(
    "new: copied, not prepared; ready: its picture is made, Claude has not read it; analysed; failed: unreadable",
  );

const lotSummary = z.object({
  doc: z.string().describe("The document the batch is attached to"),
  id: z.string().describe("Batch id"),
  title: z.string().describe("Batch title"),
  included: z.boolean().describe("Whether the batch is an annex of doc.md (in the document)"),
  reference: z.boolean().describe("Whether the team marked it as showing the reference behaviour"),
  added: z.string().describe("When the batch was created, ISO time"),
  anchor: z.string().describe("The annex's anchor, §lot-<id>"),
  photos: z.number().describe("Photos in the batch"),
  videos: z.number().describe("Videos in the batch (a later version)"),
  analysed: z.number().describe("Photos Claude has read"),
  failed: z.number().describe("Photos that could not be read as pictures"),
  state: z
    .enum(["empty", "ready", "unread", "failed"])
    .describe(
      "empty: no file; ready: every photo read; unread: some photos not read by Claude yet (media.analyse); failed: some photos unreadable",
    ),
});

const rejected = z
  .array(
    z.object({
      name: z.string().describe("The file's name"),
      why: z.string().describe("Why it was not added"),
      code: z
        .enum(["not-a-photo", "later", "duplicate", "failed"])
        .describe(
          "not-a-photo: not JPEG, PNG or WebP; later: a video, sound or HEIC photo (a later version); duplicate: already in the batch; failed: unreadable",
        ),
    }),
  )
  .describe("The files not added, and why");

const citedBy = z
  .array(
    z.object({
      id: z.string().describe("Test id (its folder under tests/)"),
      key: z.string().optional().describe("Jira key, once the test is in Xray"),
      summary: z.string().describe("Test summary"),
      review: REVIEW.describe("Where the test is in the review"),
      steps: z.number().describe("Steps with a source that cites it"),
    }),
  )
  .describe("Tests whose sources cite the document; their mechanical check was redone against the new doc.md");

const indexOut = z
  .object({
    chunks: z.number().optional().describe("Passages in the index after the run"),
    degraded: z.string().optional().describe("Why no vectors were built (no embedding model on this PC)"),
    error: z.string().optional().describe("Why the index run failed; the batch is kept"),
  })
  .optional()
  .describe("With index: what the index run that followed did");

const jobOut = z.object({
  lot: lotSummary.nullable().describe("The batch after the job (null once removed)"),
  added: z.array(z.string()).describe("Ids of the items added"),
  rejected,
  analysed: z.number().describe("Photos Claude read in this job"),
  unread: z.array(z.string()).describe("Photos Claude was asked to read and gave nothing for (their figure anchors)"),
  costUsd: z.number().describe("What the Claude runs cost"),
  changed: z.boolean().describe("Whether doc.md changed (the annex is in the document and moved)"),
  citedBy,
  index: indexOut,
});

const lotStateOf = (l: MediaLot): z.infer<typeof lotSummary>["state"] => {
  const c = lotCounts(l);
  if (!c.photos) return "empty";
  if (c.failed) return "failed";
  return c.analysed === c.photos ? "ready" : "unread";
};

export function summaryOf(docId: string, l: MediaLot): z.input<typeof lotSummary> {
  const { photos, videos, analysed, failed } = lotCounts(l);
  return {
    doc: docId,
    id: l.id,
    title: l.title,
    included: l.included,
    reference: !!l.reference,
    added: l.added,
    anchor: lotAnchor(l.id),
    photos,
    videos,
    analysed,
    failed,
    state: lotStateOf(l),
  };
}

const lotOf = (project: string, docId: string, id: string) => findLot(readDoc(project, docId), id);
const runOf = (i: { model?: string; effort?: z.infer<typeof EFFORT>; index?: boolean }) => ({
  model: i.model,
  effort: i.effort,
  index: i.index,
});

// ponytail: a batch job's common end — the photos read (when asked), the annex written, the citing tests checked
// again, the index updated
async function finish(
  ctx: Ctx,
  project: string,
  docId: string,
  id: string,
  o: { read?: boolean; items?: string[]; force?: boolean } & ReturnType<typeof runOf>,
  extra: { added?: string[]; rejected?: Rejected[] } = {},
): Promise<z.input<typeof jobOut>> {
  let analysed = 0;
  let unread: string[] = [];
  let costUsd = 0;
  if (o.read) {
    ctx.step?.("prepare");
    await prepareLot(ctx, project, docId, id, o.force);
    ctx.step?.("read");
    const r = await readLot(ctx, project, docId, id, o, { items: o.items, force: o.force });
    if (r) {
      analysed = r.analysed;
      unread = r.missing;
      costUsd = r.costUsd;
    }
  }
  ctx.step?.("annex");
  ctx.progress({ message: "Writing the annex" });
  const changed = await writeAnnex(project, docId, id);
  const after = await afterAnnex(ctx, project, docId, changed, o);
  return {
    lot: summaryOf(docId, lotOf(project, docId, id)),
    added: extra.added ?? [],
    rejected: extra.rejected ?? [],
    analysed,
    unread,
    costUsd,
    changed,
    ...after,
  };
}

// ponytail: creating a batch and filling it, shared by media.add and docs.add (its batches come after the conversion)
export async function addLot(
  ctx: Ctx,
  project: string,
  docId: string,
  input: {
    files: z.output<typeof MEDIA_FILES>;
    title?: string;
    context?: string;
    reference?: boolean;
    include?: boolean;
  },
): Promise<{ lot: MediaLot; added: string[]; rejected: Rejected[] }> {
  const l = newLot(project, docId, { title: input.title, reference: input.reference, included: input.include });
  ensureMediaDir(project, docId, l.id);
  if (input.context?.trim()) writeLotContext(project, docId, l.id, input.context);
  ctx.progress({ message: "Copying the files" });
  const { items, rejected } = copyFiles(project, docId, l.id, input.files);
  return { lot: l, added: items.map((i) => i.id), rejected };
}

export const commands = [
  command({
    name: "media.add",
    summary:
      "Attach a batch of photos to a document: they are copied into the project, made into pictures, read by Claude with the batch's context (20 a run), and the batch becomes an annex at the end of doc.md (§lot-<id>), searched, cited and checked like the rest of the document. A source taken from an annex says how to do a step, never what is expected.",
    input: z.object({
      doc,
      files: MEDIA_FILES,
      title: title.optional(),
      context: context.optional(),
      reference: reference.optional(),
      include: z
        .boolean()
        .default(true)
        .describe("Put the batch in the document as an annex (default true); false keeps it beside, out of doc.md"),
      model,
      effort,
      index,
    }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      readDoc(project, input.doc);
      ctx.steps?.(lotSteps({ copy: true, read: true, index: input.index }));
      ctx.step?.("copy");
      const { lot: l, added, rejected } = await addLot(ctx, project, input.doc, input);
      if (!added.length && rejected.length) ctx.log("warn", `No photo was added: ${rejected[0].why}`);
      return finish(ctx, project, input.doc, l.id, { read: true, ...runOf(input) }, { added, rejected });
    },
  }),
  command({
    name: "media.addFiles",
    summary:
      "Add photos to a batch; only the new ones are prepared and read by Claude, then the annex is written again.",
    input: z.object({ doc, lot, files: MEDIA_FILES, model, effort, index }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc", "lot"],
    subject: (i) => `${i.doc} · ${i.lot}`,
    label: (i, project) => batchName(project, i.doc, i.lot),
    async run(ctx, input) {
      const project = projectOf(ctx);
      lotOf(project, input.doc, input.lot);
      ctx.steps?.(lotSteps({ copy: true, read: true, index: input.index }));
      ctx.step?.("copy");
      const { items, rejected } = copyFiles(project, input.doc, input.lot, input.files);
      const added = items.map((i) => i.id);
      return finish(
        ctx,
        project,
        input.doc,
        input.lot,
        { read: !!added.length, items: added, ...runOf(input) },
        { added, rejected },
      );
    },
  }),
  command({
    name: "media.removeFile",
    summary:
      "Remove one photo from a batch: its copy, its picture and its section of the annex; the tests citing the document are checked again.",
    input: z.object({ doc, lot, item: z.string().describe("Item id, as media.show lists it (e.g. img-0042)"), index }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc", "lot", "item"],
    subject: (i) => `${i.doc} · ${i.lot} · ${i.item}`,
    label: (i, project) => `${batchName(project, i.doc, i.lot)} · ${i.item}`,
    async run(ctx, input) {
      const project = projectOf(ctx);
      dropItem(project, input.doc, input.lot, input.item);
      ctx.steps?.(lotSteps({ index: input.index }));
      return finish(ctx, project, input.doc, input.lot, runOf(input));
    },
  }),
  command({
    name: "media.include",
    summary:
      "Put a batch in its document as an annex, or take it out (its files stay): doc.md is assembled again, the citing tests are checked again and the index follows.",
    input: z.object({
      doc,
      lot,
      included: z
        .boolean()
        .describe("true: the batch is an annex of doc.md; false: it is kept beside, out of the text"),
      index,
    }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc", "lot"],
    subject: (i) => `${i.doc} · ${i.lot}`,
    label: (i, project) => batchName(project, i.doc, i.lot),
    async run(ctx, input) {
      const project = projectOf(ctx);
      updateLot(project, input.doc, input.lot, (l) => {
        l.included = input.included;
      });
      ctx.steps?.(lotSteps({ index: input.index }));
      return finish(ctx, project, input.doc, input.lot, runOf(input));
    },
  }),
  command({
    name: "media.analyse",
    summary:
      "Prepare and have Claude read the photos of a batch again: those not read yet (or failed to prepare), the items given, or every one with force; the annex is written again.",
    input: z.object({
      doc,
      lot,
      items: z.array(z.string()).optional().describe("Only these items (media.show ids), read again even when read"),
      force: z.boolean().default(false).describe("Prepare and read every photo again"),
      model,
      effort,
      index,
    }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc", "lot"],
    subject: (i) => `${i.doc} · ${i.lot}`,
    label: (i, project) => batchName(project, i.doc, i.lot),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const l = lotOf(project, input.doc, input.lot);
      for (const id of input.items ?? [])
        if (!l.items.some((i) => i.id === id))
          throw new UserError(`The batch ${l.id} has no item ${id}.`, `testimus media show ${input.doc} ${l.id}`);
      if (input.force || input.items)
        updateLot(project, input.doc, input.lot, (x) => {
          for (const i of x.items) if (input.force || input.items?.includes(i.id)) i.state = "new";
        });
      else
        updateLot(project, input.doc, input.lot, (x) => {
          for (const i of x.items) if (i.state === "failed") i.state = "new";
        });
      ctx.steps?.(lotSteps({ read: true, index: input.index }));
      return finish(ctx, project, input.doc, input.lot, {
        read: true,
        items: input.items,
        force: input.force,
        ...runOf(input),
      });
    },
  }),
  command({
    name: "media.context",
    summary:
      "Change what the team says about a batch — its context, its title, whether it shows the reference behaviour — and write its annex again.",
    input: z.object({
      doc,
      lot,
      text: context.optional().describe("The batch's context; replaces media/<lot>/context.md, empty clears it"),
      title: title.optional(),
      reference: reference.optional(),
      index,
    }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc", "lot"],
    subject: (i) => `${i.doc} · ${i.lot}`,
    label: (i, project) => batchName(project, i.doc, i.lot),
    async run(ctx, input) {
      const project = projectOf(ctx);
      lotOf(project, input.doc, input.lot);
      if (input.text !== undefined) writeLotContext(project, input.doc, input.lot, input.text);
      updateLot(project, input.doc, input.lot, (l) => {
        if (input.title?.trim()) l.title = input.title.trim();
        if (input.reference !== undefined) {
          if (input.reference) l.reference = true;
          else delete l.reference;
        }
      });
      ctx.steps?.(lotSteps({ index: input.index }));
      return finish(ctx, project, input.doc, input.lot, runOf(input));
    },
  }),
  command({
    name: "media.remove",
    summary:
      "Remove a batch and everything it put in the document's folder (copies, pictures, annex); doc.md is assembled again and the tests that cite it are checked again, so they report the missing annex.",
    input: z.object({ doc, lot, index }),
    output: jobOut,
    mutates: true,
    job: "media",
    positional: ["doc", "lot"],
    subject: (i) => `${i.doc} · ${i.lot}`,
    label: (i, project) => batchName(project, i.doc, i.lot),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const was = lotOf(project, input.doc, input.lot);
      ctx.steps?.(lotSteps({ index: input.index }));
      ctx.step?.("annex");
      dropLot(project, input.doc, input.lot);
      const changed = await writeAnnex(project, input.doc);
      const after = await afterAnnex(ctx, project, input.doc, changed || was.included, runOf(input));
      return { lot: null, added: [], rejected: [], analysed: 0, unread: [], costUsd: 0, changed, ...after };
    },
  }),
  command({
    name: "media.list",
    summary: "List the batches of photos of a document (or of every document), with what they hold and their state.",
    input: z.object({ doc: doc.optional().describe("Only this document's batches; default: every document") }),
    output: z.array(lotSummary),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const ids = input.doc ? [readDoc(project, input.doc).id] : docIds(project);
      return ids.flatMap((id) => (readDoc(project, id).media ?? []).map((l) => summaryOf(id, l)));
    },
  }),
  command({
    name: "media.show",
    summary:
      "Show a batch: its context, each photo with its picture and what Claude read in it (description, visible text, sections it illustrates), its annex as doc.md carries it, and the tests that cite it.",
    input: z.object({ doc, lot }),
    output: lotSummary.extend({
      context: z.string().describe("What the team says about the batch (media/<lot>/context.md)"),
      items: z
        .array(
          z.object({
            id: z.string().describe("Item id"),
            name: z.string().describe("The original file's name"),
            file: z.string().describe("The copy, relative to the document folder (media/<lot>/files/…)"),
            kind: z.enum(["photo"]).describe("What the item is"),
            state: STATE,
            error: z.string().optional().describe("Why it failed"),
            figure: z.string().optional().describe("Its picture, relative to the document folder (figures/lot-…)"),
            anchor: z.string().describe("Its section in the annex, §lot-<batch>.<item>"),
            figureAnchor: z.string().describe("Its figure anchor, fig:lot-<batch>.<item>"),
            takenAt: z.string().optional().describe("When it was taken (EXIF), local time"),
            width: z.number().optional().describe("Width of the picture, px"),
            height: z.number().optional().describe("Height of the picture, px"),
            description: z.string().describe("What Claude saw in it; empty until read"),
            labels: z.array(z.string()).describe("Text visible in it, verbatim, as Claude read it"),
            seen: kind.optional().describe("What the picture is, as Claude judged it"),
            illustrates: z.array(z.string()).describe("Sections of the document's body it illustrates (§…)"),
          }),
        )
        .describe("The photos, in the order they were taken"),
      part: z.string().describe("The annex as written (media/<lot>/part.md); in doc.md while included"),
      analysedAt: z.string().optional().describe("When Claude last read photos of the batch"),
      citedBy: citedBy.describe("Tests with a source in this batch's annex"),
    }),
    mutates: false,
    positional: ["doc", "lot"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const d: DocJson = readDoc(project, input.doc);
      const l = findLot(d, input.lot);
      const figures = new Map(readFigures(project, d.id).map((f) => [f.anchor, f]));
      const partFile = join(mediaDir(project, d.id, l.id), "part.md");
      return {
        ...summaryOf(d.id, l),
        context: readLotContext(project, d.id, l.id),
        items: ordered(l.items).map((i) => {
          const f = figures.get(itemFigure(l.id, i.id));
          return {
            id: i.id,
            name: i.name,
            file: `media/${l.id}/${i.file}`,
            kind: i.kind,
            state: i.state,
            ...(i.error ? { error: i.error } : {}),
            ...(i.figure ? { figure: i.figure } : {}),
            anchor: itemAnchor(l.id, i.id),
            figureAnchor: itemFigure(l.id, i.id),
            ...(i.takenAt ? { takenAt: i.takenAt } : {}),
            ...(i.width ? { width: i.width, height: i.height } : {}),
            description: f?.description ?? "",
            labels: f?.labels ?? [],
            ...(f?.kind ? { seen: f.kind } : {}),
            illustrates: i.illustrates ?? [],
          };
        }),
        part: existsSync(partFile) ? readFileSync(partFile, "utf8") : "",
        ...(l.analysed ? { analysedAt: l.analysed.at } : {}),
        citedBy: testsCitingLot(project, d.id, l.id),
      };
    },
  }),
];
