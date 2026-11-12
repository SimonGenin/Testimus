import { basename, join } from "node:path";
import { z } from "zod";
import { sleep } from "../../shared/run/work.ts";
import { command, projectOf } from "../command.ts";
import { FOLDER_MAX_FILES, FOLDER_REASONS, scanFolder } from "../lib/docs-folder.ts";
import { addPending, type PendingUnit } from "../lib/docs-pending.ts";
import { docJson, kind } from "./docs-schemas.ts";
import { convertedSchema, rejectedSchema, startDocs, startOptions } from "./docs-start.ts";

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
      "Import the documents of a folder (docs.scanFolder says which). With start (the default here), each is copied into the project, then converted and indexed — one docs.convert job per document, several at a time, each indexed as it ends. With start false, they only enter the project waiting to start (their doc.json says where each original is and its size; nothing is copied): docs.planStart says what starting them takes, docs.start starts them, docs.remove takes one away. With files, only those.",
    input: z.object({
      dir,
      recursive,
      files: z
        .array(z.string())
        .optional()
        .describe("Only these files (their rel from docs.scanFolder); default: every document the folder holds"),
      kind: kind.optional().describe("What the documents are (default spec; other for images and videos)"),
      start: z
        .boolean()
        .default(true)
        .describe(
          "Copy and convert them now (default true: the command line asked); false adds them waiting to start, for docs.start — what the page does",
        ),
      ...startOptions,
    }),
    output: z.object({
      added: z
        .array(docJson)
        .describe("The documents added, in the folder's order: copied with start, waiting to start without"),
      rejected: rejectedSchema,
      converted: convertedSchema,
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
      // ponytail: the folder is read again on the next turn, so the page that started the import has the job's id at
      // once and goes on — the copies themselves never hold the server (copyFileAtomic streams them)
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
      const rejected: z.infer<typeof rejectedSchema> = [...(asked ?? [])]
        .filter((rel) => !chosen.some((f) => f.rel === rel))
        .map((rel) => ({
          name: rel,
          why: scan.files.find((f) => f.rel === rel)?.why ?? "not in the folder",
          code: "left-aside" as const,
        }));
      const groups = new Map<string, typeof chosen>();
      for (const f of chosen.filter((x) => x.group))
        groups.set(f.group as string, [...(groups.get(f.group as string) ?? []), f]);
      const sized = (f: { path: string; size: number }) => ({ path: f.path, size: f.size });
      const units: PendingUnit[] = [
        ...chosen
          .filter((x) => !x.group)
          .map((f) => {
            const twin = f.twin ? scan.files.find((x) => x.rel === f.twin) : undefined;
            return {
              files: [sized(f)],
              id: f.id,
              ...(twin ? { pdf: { path: join(scan.dir, f.twin as string), size: twin.size } } : {}),
            };
          }),
        ...[...groups.values()].map((unit) => ({
          files: unit.map(sized),
          id: unit[0].id,
          images: basename(unit[0].group === "." ? scan.dir : (unit[0].group as string)),
        })),
      ];
      if (!input.start) {
        ctx.steps?.([{ id: "add", label: "Add the documents, waiting to start" }]);
        ctx.step?.("add");
        ctx.progress({ message: `Adding ${units.length === 1 ? "1 document" : `${units.length} documents`}` });
      }
      const r = await addPending(project, units, { kind: input.kind }, ctx.signal);
      rejected.push(...r.rejected.map((x) => ({ ...x, code: "failed" as const })));
      if (!input.start) return { added: r.added, rejected, converted: [], truncated };
      const s = await startDocs(ctx, project, r.added, input);
      return { added: s.started, rejected: [...rejected, ...s.rejected], converted: s.converted, truncated };
    },
  }),
];
