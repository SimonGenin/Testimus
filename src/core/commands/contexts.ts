import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  contextDir,
  effectiveContexts,
  isShared,
  projectContexts,
  readContexts,
  readTestContexts,
  sharedContexts,
  writeTestContexts,
} from "../claude/prompt.ts";
import { command, projectOf, UserError } from "../command.ts";
import { copyDirAtomic } from "../lib/atomic.ts";
import { isProject, readJson, readProject, writeJson } from "../lib/project.ts";
import { hex8, testExists, writeAtomic } from "../lib/store.ts";

const ID = z.string().regex(/^[\w-]+$/, "A context id: letters, digits, _ and -");
const id = ID.describe("Context id: the folder under contexts/ (ctx-<8hex>)");
const testId = z.string().describe("Test id: the folder under tests/ — a Jira key or local-<8hex>");

const summary = z.object({
  id: z.string(),
  name: z.string(),
  paths: z.array(z.string()).describe("Folders or files outside the project Claude may read in place"),
  files: z.array(z.string()).describe("Files copied into contexts/<id>/files/"),
  hasNotes: z.boolean(),
  shared: z.boolean().describe("In the shared library every project sees, not in this project's contexts/"),
});
const detail = summary.extend({ notes: z.string().describe("contexts/<id>/notes.md") });

type Meta = { name?: string; paths?: string[] };

const metaFile = (project: string, cid: string) => join(contextDir(project, cid), "context.json");

function otherProject(from: string, project: string): string {
  const dir = resolve(from);
  if (!isProject(dir)) throw new UserError(`${from} is not a project folder.`, "testimus project list shows them.");
  if (dir === resolve(project)) throw new UserError("That is this project.", "Pick another project folder.");
  return dir;
}

function mustExist(project: string, cid: string): string {
  const dir = contextDir(project, cid);
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new UserError(`No context ${cid} in this project.`, "testimus contexts list shows them.");
  return dir;
}

function show(project: string, cid: string) {
  const [c] = readContexts(project, [cid]);
  if (!c) throw new UserError(`No context ${cid} in this project.`, "testimus contexts list shows them.");
  return {
    id: c.id,
    name: c.name,
    paths: c.paths,
    files: c.files,
    hasNotes: !!c.text.trim(),
    shared: isShared(project, c.id),
    notes: c.text,
  };
}

const idsIn = (root: string) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^[\w-]+$/.test(d.name))
        .map((d) => d.name)
    : [];

function list(project: string, withShared = true) {
  const ids = [...new Set([...idsIn(join(project, "contexts")), ...(withShared ? idsIn(sharedContexts()) : [])])];
  return readContexts(project, ids)
    .map((c) => ({
      id: c.id,
      name: c.name,
      paths: c.paths,
      files: c.files,
      hasNotes: !!c.text.trim(),
      shared: isShared(project, c.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const safeName = (name: string) => basename(name).replace(/[<>:"/\\|?*]+/g, "_") || "file";

function freeName(dir: string, name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let out = name;
  for (let k = 2; existsSync(join(dir, out)); k++) out = `${stem} (${k})${ext}`;
  return out;
}

export const commands = [
  command({
    name: "contexts.list",
    summary:
      "List the contexts this project sees — its own and the shared library's: reference bundles (notes, copied files, outside paths) Claude reads before it works.",
    input: z.object({
      from: z
        .string()
        .optional()
        .describe("Another project folder to list its own contexts instead (to pick one for contexts copy)"),
    }),
    output: z.array(summary),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      return input.from ? list(otherProject(input.from, project), false) : list(project);
    },
  }),
  command({
    name: "contexts.show",
    summary: "Show one context: its name, notes, outside paths and copied files.",
    input: z.object({ id }),
    output: detail,
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      return show(projectOf(ctx), input.id);
    },
  }),
  command({
    name: "contexts.create",
    summary: "Create an empty context (contexts/ctx-<8hex>/, or in the shared library with --shared).",
    input: z.object({
      name: z.string().optional().describe("Name shown in the UI and in Claude's prompt (default: New context)"),
      shared: z
        .boolean()
        .optional()
        .describe("Put it in the shared library every project sees (default: this project)"),
    }),
    output: detail,
    mutates: true,
    async run(ctx, input) {
      const project = projectOf(ctx);
      let cid = `ctx-${hex8()}`;
      while (existsSync(contextDir(project, cid))) cid = `ctx-${hex8()}`;
      const dir = join(input.shared ? sharedContexts() : join(project, "contexts"), cid);
      mkdirSync(join(dir, "files"), { recursive: true });
      writeJson(join(dir, "context.json"), { name: input.name?.trim() || "New context", paths: [] });
      writeAtomic(join(dir, "notes.md"), "");
      return show(project, cid);
    },
  }),
  command({
    name: "contexts.copy",
    summary:
      "Copy a context from another project into this one (notes, outside paths and files); a taken id gets a new one.",
    input: z.object({
      from: z.string().describe("The other project's folder (testimus project list)"),
      id: ID.describe("The context id in that project"),
    }),
    output: detail,
    mutates: true,
    positional: ["from", "id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const source = mustExist(otherProject(input.from, project), input.id);
      let cid = input.id;
      while (existsSync(contextDir(project, cid))) cid = `ctx-${hex8()}`;
      mkdirSync(join(project, "contexts"), { recursive: true });
      copyDirAtomic(source, contextDir(project, cid));
      return show(project, cid);
    },
  }),
  command({
    name: "contexts.share",
    summary:
      "Move a context into the shared library every project sees (shared: true), or back into this project only (false).",
    input: z.object({
      id,
      shared: z.boolean().describe("true: every project sees it; false: only this project keeps it"),
    }),
    output: detail,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const from = mustExist(project, input.id);
      if (isShared(project, input.id) === input.shared) return show(project, input.id);
      const to = join(input.shared ? sharedContexts() : join(project, "contexts"), input.id);
      if (existsSync(to)) throw new UserError(`A context ${input.id} is already there.`);
      mkdirSync(join(to, ".."), { recursive: true });
      // ponytail: copy then delete — the library sits in AppData, the project often on another drive
      copyDirAtomic(from, to);
      rmSync(from, { recursive: true, force: true });
      return show(project, input.id);
    },
  }),
  command({
    name: "contexts.set",
    summary: "Change a context: its name, its notes (notes.md) or its list of outside paths.",
    input: z.object({
      id,
      name: z.string().optional().describe("New name"),
      notes: z.string().optional().describe("New text of notes.md (markdown, may be empty)"),
      paths: z
        .array(z.string())
        .optional()
        .describe(
          "Folders or files Claude may read in place, absolute or relative to the project folder (replaces the list)",
        ),
    }),
    output: detail,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const dir = mustExist(project, input.id);
      const meta = readJson<Meta>(metaFile(project, input.id), {});
      if (input.name !== undefined) meta.name = input.name.trim() || meta.name || input.id;
      // ponytail: a path is kept as typed (Xray Editor); a relative one is read from the project folder, Claude's cwd
      if (input.paths) meta.paths = [...new Set(input.paths.map((p) => p.trim()).filter(Boolean))];
      if (input.name !== undefined || input.paths) writeJson(metaFile(project, input.id), meta);
      if (input.notes !== undefined) writeAtomic(join(dir, "notes.md"), input.notes);
      return show(project, input.id);
    },
  }),
  command({
    name: "contexts.addFile",
    summary: "Copy a file into a context (contexts/<id>/files/): an absolute path, or an upload as base64 from the UI.",
    input: z.object({
      id,
      file: z.string().optional().describe("Absolute path of the file to copy"),
      name: z.string().optional().describe("File name of the upload (with dataBase64)"),
      dataBase64: z.string().optional().describe("The uploaded file, base64"),
    }),
    output: detail.extend({ added: z.string().describe("Name of the copy under files/") }),
    mutates: true,
    positional: ["id", "file"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const files = join(mustExist(project, input.id), "files");
      mkdirSync(files, { recursive: true });
      let added: string;
      if (input.dataBase64 !== undefined) {
        added = freeName(files, safeName(input.name ?? "file"));
        writeAtomic(join(files, added), Buffer.from(input.dataBase64.replace(/^data:[^,]*,/, ""), "base64"));
      } else if (input.file) {
        if (!isAbsolute(input.file) || !existsSync(input.file) || !statSync(input.file).isFile())
          throw new UserError(`No file ${input.file}.`, "Give the absolute path of an existing file.");
        added = freeName(files, safeName(input.file));
        writeAtomic(join(files, added), readFileSync(input.file));
      } else throw new UserError("Give a file or an upload.", "contexts addFile <id> /path/to/glossary.pdf");
      return { ...show(project, input.id), added };
    },
  }),
  command({
    name: "contexts.removeFile",
    summary: "Delete one copied file of a context.",
    input: z.object({ id, name: z.string().describe("File name under files/") }),
    output: detail,
    mutates: true,
    positional: ["id", "name"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const files = join(mustExist(project, input.id), "files");
      if (basename(input.name) !== input.name || input.name.includes(".."))
        throw new UserError(`"${input.name}" is not a file of this context.`);
      rmSync(join(files, input.name), { force: true });
      return show(project, input.id);
    },
  }),
  command({
    name: "contexts.remove",
    summary:
      "Delete a context folder (a shared one for every project); tests and project defaults that named it simply stop attaching it (outside paths are not touched).",
    input: z.object({ id }),
    output: z.object({ id: z.string(), removed: z.boolean() }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      rmSync(mustExist(project, input.id), { recursive: true, force: true });
      return { id: input.id, removed: true };
    },
  }),
  command({
    name: "contexts.ofTest",
    summary:
      "The contexts attached to a test: its own list (tests/<id>/claude.json) when it has one, else the project's defaults.",
    input: z.object({ testId }),
    output: z.object({
      effective: z.array(z.string()).describe("Context ids a run on this test attaches (existing ones only)"),
      own: z.array(z.string()).nullable().describe("The test's own list, null when it follows the project"),
      project: z.array(z.string()).describe("The project's default contexts (project.json claude.contexts)"),
    }),
    mutates: false,
    positional: ["testId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!testExists(project, input.testId)) throw new UserError(`No test ${input.testId} in this project.`);
      return {
        effective: effectiveContexts(project, input.testId),
        own: readTestContexts(project, input.testId),
        project: readProject(project).claude.contexts,
      };
    },
  }),
  command({
    name: "contexts.ofProject",
    summary:
      "The contexts a request on the whole project attaches: the project's defaults and every test's own list, each once.",
    input: z.object({}),
    output: z.object({
      effective: z.array(z.string()).describe("Context ids a run on the project attaches (existing ones only)"),
    }),
    mutates: false,
    async run(ctx) {
      return { effective: projectContexts(projectOf(ctx)) };
    },
  }),
  command({
    name: "contexts.setTest",
    summary:
      "Set the full list of contexts of one test (tests/<id>/claude.json; [] = none); null goes back to the project's defaults.",
    input: z.object({
      testId,
      contexts: z.array(ID).nullable().describe("Context ids for this test, or null to follow the project"),
    }),
    output: z.object({ effective: z.array(z.string()), own: z.array(z.string()).nullable() }),
    mutates: true,
    positional: ["testId"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!testExists(project, input.testId)) throw new UserError(`No test ${input.testId} in this project.`);
      writeTestContexts(project, input.testId, input.contexts);
      return { effective: effectiveContexts(project, input.testId), own: readTestContexts(project, input.testId) };
    },
  }),
];
