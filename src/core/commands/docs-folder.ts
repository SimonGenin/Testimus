import { basename, extname, join } from "node:path";
import { z } from "zod";
import { sleep, throwIfAborted } from "../../shared/run/work.ts";
import { NOTE } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";
import { showJob, waitJob } from "../jobs.ts";
import { copyingLine } from "../lib/atomic.ts";
import { addDoc } from "../lib/docs-convert.ts";
import { FOLDER_MAX_FILES, FOLDER_REASONS, scanFolder } from "../lib/docs-folder.ts";
import { isVideo } from "../lib/media.ts";
import { addMediaDocs } from "../lib/media-add.ts";
import type { DocJson } from "../types.ts";
import { after, contexts, docJson, effort, kind, model } from "./docs-schemas.ts";

const dir = z
  .string()
  .describe("Full path of the folder on this PC (a network path \\\\server\\share is refused: use a drive letter)");
const recursive = z.boolean().default(true).describe("Read its sub-folders too (default true)");

const scanned = z.object({
  dir: z.string().describe("The folder read, as a full path"),
  recursive: z.boolean().describe("Whether its sub-folders were read"),
  files: z
    .array(
      z.object({
        path: z.string().describe("Full path of the file"),
        rel: z.string().describe("Its path inside the folder, with / — what docs.addFolder files names"),
        size: z.number().describe("Size in bytes"),
        importable: z.boolean().describe("True when docs.addFolder adds it as a document"),
        id: z
          .string()
          .optional()
          .describe("The document id it gets (the code read from its name); with in-project, the one already there"),
        twin: z
          .string()
          .optional()
          .describe("The .pdf of the same name beside a .docx (its rel): added with it, as its rendering"),
        group: z
          .string()
          .optional()
          .describe(
            "An image: the folder it is in (its rel, « . » for the folder itself) — the images of one folder are one images document, named after the folder",
          ),
        reason: z
          .enum(FOLDER_REASONS)
          .optional()
          .describe(
            "Why it is not a document to add: not-a-document (Thumbs.db, desktop.ini, a hidden or temporary file), lock-file (Word's ~$…), not-supported (a kind Testimus cannot convert yet), empty, twin (the .pdf of a .docx of the same name, added with it), in-project (the same id or file name is already a document), same-code (another file found gets the same id)",
          ),
        why: z.string().optional().describe("The reason in words, for a person"),
      }),
    )
    .describe("Every file found, in the folder's order (sub-folders after the files)"),
  documents: z.number().describe("Documents an import would add"),
  leftAside: z
    .number()
    .describe(
      "Files left aside: neither a document to import nor one already in the project (the renderings added with their .docx are not counted)",
    ),
  truncated: z
    .boolean()
    .describe(`True when the folder holds more than ${FOLDER_MAX_FILES} files: only those were read`),
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const commands = [
  command({
    name: "docs.scanFolder",
    summary:
      "Read a folder (and its sub-folders) and say what an import would add: each .docx or .pdf is a document (a .pdf beside a .docx of the same name is its rendering), every other file is left aside with the reason — not a document, Word's lock file, a kind Testimus cannot convert yet, already in the project. Nothing is copied.",
    input: z.object({ dir, recursive }),
    output: scanned,
    mutates: false,
    positional: ["dir"],
    run: async (ctx, input) => scanFolder(projectOf(ctx), input.dir, input.recursive),
  }),
  command({
    name: "docs.addFolder",
    summary:
      "Import the documents of a folder (docs.scanFolder says which): each is copied into the project, then converted and indexed — one docs.convert job per document, several at a time, each indexed as it ends (the next index pass takes every document converted meanwhile). With files, only those.",
    input: z.object({
      dir,
      recursive,
      files: z
        .array(z.string())
        .optional()
        .describe("Only these files (their rel from docs.scanFolder); default: every document the folder holds"),
      kind: kind.optional().describe("What the documents are (default spec)"),
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
        .describe("Update the search index once the conversions are done, in one run (default true)"),
    }),
    output: z.object({
      added: z.array(docJson).describe("The documents copied into the project, in the folder's order"),
      rejected: z
        .array(
          z.object({
            name: z.string().describe("The file, as its rel in the folder"),
            why: z.string().describe("Why it was not added"),
            code: z
              .enum(["left-aside", "failed"])
              .describe("left-aside: named in files but not a document to add (see why); failed: the copy was refused"),
          }),
        )
        .describe("The files asked for and not added"),
      converted: z
        .array(
          z.object({
            id: z.string().describe("The document"),
            jobId: z.string().describe("Its docs.convert job"),
            status: z.enum(["done", "failed", "cancelled"]).describe("How its conversion ended"),
            error: z.string().optional().describe("Why it failed"),
          }),
        )
        .describe("Each conversion, once ended (empty with convert false)"),
      truncated: z
        .boolean()
        .describe(`True when the folder holds more than ${FOLDER_MAX_FILES} files: only the first ones were read`),
    }),
    mutates: true,
    job: "docs.add",
    positional: ["dir"],
    subject: (i) => basename(i.dir.replace(/[\\/]+$/, "")) || i.dir,
    label: (i) => basename(i.dir.replace(/[\\/]+$/, "")) || i.dir,
    async run(ctx, input) {
      const project = projectOf(ctx);
      // ponytail: the folder is read again and copied on the next turn, so the page that started the import has the
      // job's id at once and goes on — the copies themselves never hold the server (copyFileAtomic streams them)
      await sleep(0, ctx.signal);
      const scan = scanFolder(project, input.dir, input.recursive);
      const { truncated } = scan;
      if (truncated)
        ctx.log(
          "warn",
          `The folder holds more than ${FOLDER_MAX_FILES} files: only the first ${FOLDER_MAX_FILES} were read — import its subfolders one by one for the rest.`,
        );
      const asked = input.files ? new Set(input.files.map((f) => f.replace(/\\/g, "/"))) : null;
      const chosen = scan.files.filter((f) => f.importable && (!asked || asked.has(f.rel)));
      const rejected = [...(asked ?? [])]
        .filter((rel) => !chosen.some((f) => f.rel === rel))
        .map((rel) => ({
          name: rel,
          why: scan.files.find((f) => f.rel === rel)?.why ?? "not in the folder",
          code: "left-aside" as "left-aside" | "failed",
        }));
      ctx.steps?.([
        { id: "copy", label: "Copy the documents" },
        ...(input.convert ? [{ id: "convert", label: "Convert and index each document" }] : []),
      ]);
      ctx.step?.("copy");
      const added: DocJson[] = [];
      const groups = new Map<string, typeof chosen>();
      for (const f of chosen.filter((x) => x.group))
        groups.set(f.group as string, [...(groups.get(f.group as string) ?? []), f]);
      const one = chosen.filter((x) => !x.group);
      const units: (typeof chosen)[] = [...one.map((f) => [f]), ...groups.values()];
      for (const [i, unit] of units.entries()) {
        throwIfAborted(ctx.signal);
        const f = unit[0];
        const of = units.length > 1 ? ` (file ${i + 1} of ${units.length})` : "";
        const said = (message: string, done?: number, total?: number) =>
          ctx.progress({ message: `${message}${of}`, done, total });
        said(`Copying ${f.group ? `${f.group}/` : f.rel}`);
        try {
          if (f.group || isVideo(f.path)) {
            const title = f.group ? basename(f.group === "." ? scan.dir : f.group) : basename(f.path, extname(f.path));
            const r = await addMediaDocs(
              project,
              unit.map((x) => ({ path: x.path })),
              { title, kind: input.kind, id: f.id },
              ctx.signal,
              (name, done, total) => said(copyingLine(name, done, total), done, total),
            );
            added.push(...r.added);
            rejected.push(...r.rejected.map((x) => ({ name: x.name, why: x.why, code: "failed" as const })));
            continue;
          }
          const pdf = f.twin ? join(scan.dir, f.twin) : undefined;
          added.push(
            await addDoc(project, { file: f.path, pdf, id: f.id, kind: input.kind, convert: false }, ctx.signal, said),
          );
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          rejected.push({ name: f.rel, why: message(e), code: "failed" });
        }
      }
      if (!input.convert || !added.length || !ctx.invoke) return { added, rejected, converted: [], truncated };
      ctx.step?.("convert");
      const invoke = ctx.invoke;
      const total = added.length;
      let ended = 0;
      ctx.progress({ message: `Converting ${total === 1 ? "1 document" : `${total} documents`}`, done: 0, total });
      const converted = await Promise.all(
        added.map(async (d) => {
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
      return { added, rejected, converted, truncated };
    },
  }),
];
