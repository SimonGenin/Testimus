import { basename } from "node:path";
import { z } from "zod";
import { throwIfAborted } from "../../shared/run/work.ts";
import { NOTE } from "../claude/schemas.ts";
import { type Ctx, command, projectOf, UserError } from "../command.ts";
import { showJob, waitJob } from "../jobs.ts";
import { copyingLine } from "../lib/atomic.ts";
import { findDoc } from "../lib/docs.ts";
import { pendingIds, pendingPlan, queueCopies, startPending } from "../lib/docs-pending.ts";
import type { DocJson } from "../types.ts";
import { after, contexts, docJson, effort, model } from "./docs-schemas.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MB = 1024 * 1024;

export const startOptions = {
  convert: z
    .boolean()
    .default(true)
    .describe("Convert each document once copied (default true); false only copies them"),
  model,
  effort,
  note: NOTE,
  contexts,
  ...after,
  index: z
    .boolean()
    .default(true)
    .describe(
      "Update the search index as the conversions end (default true): each document is searchable once indexed",
    ),
};

export const rejectedSchema = z
  .array(
    z.object({
      name: z.string().describe("The file, or the document"),
      why: z.string().describe("Why it was not added or started"),
      code: z
        .enum(["left-aside", "failed", "not-pending"])
        .describe(
          "left-aside: named but not a document to add (see why); failed: the copy was refused; not-pending: the document was not waiting to start",
        ),
    }),
  )
  .describe("What was asked for and not added, copied or started");

export const convertedSchema = z
  .array(
    z.object({
      id: z.string().describe("The document"),
      jobId: z.string().describe("Its docs.convert job"),
      status: z.enum(["done", "failed", "cancelled"]).describe("How its conversion ended"),
      error: z.string().optional().describe("Why it failed"),
    }),
  )
  .describe("Each conversion, once ended (empty with convert false)");

type Rejected = z.infer<typeof rejectedSchema>[number];
type Options = { convert: boolean } & Record<string, unknown>;

// ponytail: a start copies the pending documents one after the other (each queued until its turn — docs.list says
// so), then starts one docs.convert job per document copied, children of this one, and waits for them: they share the
// conversion pool and are indexed as they end. A copy that fails leaves its document pending with the reason; the
// others go on
export async function startDocs(
  ctx: Ctx,
  project: string,
  docs: DocJson[],
  input: Options,
): Promise<{ started: DocJson[]; rejected: Rejected[]; converted: z.infer<typeof convertedSchema> }> {
  const plan = pendingPlan(
    project,
    docs.map((d) => d.id),
  );
  if (plan.short && plan.freeBytes !== null)
    throw new UserError(
      `Not enough room on the project's drive: the copies need about ${Math.ceil(plan.needBytes / MB)} MB and ${Math.floor(plan.freeBytes / MB)} MB are free.`,
      "Free some room on the project's drive, or start fewer documents.",
      "no-room",
    );
  ctx.steps?.([
    { id: "copy", label: "Copy the documents" },
    ...(input.convert ? [{ id: "convert", label: "Convert and index each document" }] : []),
  ]);
  ctx.step?.("copy");
  const started: DocJson[] = [];
  const rejected: Rejected[] = [];
  const release = queueCopies(project, docs);
  try {
    for (const [i, d] of docs.entries()) {
      throwIfAborted(ctx.signal);
      const of = docs.length > 1 ? ` (file ${i + 1} of ${docs.length})` : "";
      try {
        const r = await startPending(project, d.id, ctx.signal, (name, done, total) =>
          ctx.progress({ message: `${copyingLine(name, done, total)}${of}`, done, total }),
        );
        started.push(r.doc);
        rejected.push(...r.rejected.map((x) => ({ name: x.name, why: x.why, code: "failed" as const })));
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        const name = d.pending?.files[0] ? basename(d.pending.files[0].path) : d.id;
        rejected.push({ name, why: message(e), code: "failed" });
      }
    }
  } finally {
    release();
  }
  if (!input.convert || !started.length || !ctx.invoke) return { started, rejected, converted: [] };
  ctx.step?.("convert");
  const invoke = ctx.invoke;
  const total = started.length;
  let ended = 0;
  ctx.progress({ message: `Converting ${total === 1 ? "1 document" : `${total} documents`}`, done: 0, total });
  const converted = await Promise.all(
    started.map(async (d) => {
      const { jobId } = (await invoke(
        "docs.convert",
        {
          id: d.id,
          model: input.model,
          effort: input.effort,
          note: input.note,
          contexts: input.contexts,
          describeFigures: input.describeFigures,
          triage: input.triage,
          study: input.study,
          index: input.index,
        },
        { signal: ctx.signal, wait: false },
      )) as { jobId: string };
      const error = await waitJob(jobId).then(
        () => undefined,
        (e) => message(e),
      );
      const said = showJob(project, jobId)?.job.status;
      const status = said === "done" || said === "cancelled" ? said : error ? "failed" : "done";
      ended++;
      ctx.progress({ message: `Converted ${ended} of ${total}`, done: ended, total });
      return { id: d.id, jobId, status, ...(error && status === "failed" ? { error } : {}) } as const;
    }),
  );
  return { started, rejected, converted };
}

const ids = z
  .array(z.string())
  .optional()
  .describe("The documents (their ids); default: every document waiting to start");

export const commands = [
  command({
    name: "docs.planStart",
    summary:
      "What starting the documents waiting to start would take, before anything is copied: the documents by type, the bytes to copy against the room on the project's drive, Claude's runs and an estimated duration.",
    input: z.object({ ids }),
    output: z.object({
      ids: z.array(z.string()).describe("The documents waiting to start that the plan counts"),
      byType: z
        .object({
          docx: z.number().describe("Word documents"),
          pdf: z.number().describe("PDF documents"),
          txt: z.number().describe("Text documents"),
          images: z.number().describe("Images documents (the images of a folder)"),
          video: z.number().describe("Videos and sound recordings"),
          mixed: z.number().describe("Images and videos together (never pending: kept for the shape)"),
        })
        .describe("How many of each type"),
      files: z.number().describe("Files to copy (a .docx and its .pdf count two, each image one)"),
      bytes: z.number().describe("Bytes to copy"),
      needBytes: z
        .number()
        .describe("Room they take on the project's drive: the copies, half a video's size again, and 200 MB kept free"),
      freeBytes: z.number().nullable().describe("Room free on the project's drive (null: unknown)"),
      short: z.boolean().describe("True when the room free does not cover needBytes: docs.start refuses"),
      claudeRuns: z
        .number()
        .describe(
          "Claude runs planned: one per Word or PDF document, one per 20 photos, about 3 per video under 10 min and 12 beyond",
        ),
      slots: z.number().describe("Conversions side by side on this PC (the agents setting, the cores)"),
      copySeconds: z.number().describe("Estimated time to copy, seconds"),
      convertSeconds: z.number().describe("Estimated time to convert and read them, seconds"),
      seconds: z
        .number()
        .describe("Estimated time in all, seconds — an estimate from the rates measured on 2026-11-10"),
    }),
    mutates: false,
    run: async (ctx, input) => pendingPlan(projectOf(ctx), input.ids),
  }),
  command({
    name: "docs.start",
    summary:
      "Start the documents waiting to start (docs.addFolder with start false): copy each original into the project, then convert and index each document — one docs.convert job per document, several at a time, each indexed as it ends. Refused when the project's drive lacks room for the copies.",
    input: z.object({ ids, ...startOptions }),
    output: z.object({
      started: z.array(docJson).describe("The documents copied into the project, in order"),
      rejected: rejectedSchema,
      converted: convertedSchema,
    }),
    mutates: true,
    job: "docs.add",
    positional: ["ids"],
    subject: (i) => (i.ids?.length === 1 ? i.ids[0] : i.ids ? `${i.ids.length} documents` : "documents waiting"),
    label: (i) => (i.ids?.length === 1 ? `Start ${i.ids[0]}` : "Start the documents waiting"),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const waiting = new Set(pendingIds(project));
      const asked = input.ids ?? [...waiting];
      const refused: Rejected[] = asked
        .filter((id) => !waiting.has(id))
        .map((id) => ({
          name: id,
          why: findDoc(project, id) ? `${id} is not waiting to start.` : `No document ${id}.`,
          code: "not-pending",
        }));
      const docs = asked.filter((id) => waiting.has(id)).map((id) => findDoc(project, id) as DocJson);
      if (!docs.length)
        throw new UserError(
          refused[0]?.why ?? "No document is waiting to start.",
          "testimus docs list shows the documents and their stage; docs addFolder <dir> --start=false adds a folder's documents waiting.",
          "nothing-pending",
        );
      const r = await startDocs(ctx, project, docs, input);
      return { ...r, rejected: [...refused, ...r.rejected] };
    },
  }),
];
