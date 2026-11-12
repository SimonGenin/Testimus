import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  contextDir,
  isShared,
  readContextFile,
  readContexts,
  sharedContexts,
  writeContextFile,
} from "../claude/prompt.ts";
import { UserError } from "../command.ts";
import { copyDirAtomic, fileMtime, writeAtomic } from "./atomic.ts";
import { isProject, readProject, writeProject } from "./project.ts";
import { hex8 } from "./store.ts";

// ponytail: a context is a folder — contexts/<id>/ in the project, or the shared library every project sees —
// holding context.md (name and outside paths in its frontmatter, the notes as its body) and files/ (copies)

export type ContextSummary = {
  id: string;
  name: string;
  paths: string[];
  files: string[];
  hasNotes: boolean;
  shared: boolean;
};
export type ContextDetail = ContextSummary & { notes: string; mtime: number };

const LIST = "testimus contexts list shows them.";

export function otherProject(from: string, project: string): string {
  const dir = resolve(from);
  if (!isProject(dir)) throw new UserError(`${from} is not a project folder.`, "testimus project list shows them.");
  if (dir === resolve(project)) throw new UserError("That is this project.", "Pick another project folder.");
  return dir;
}

export function contextFolder(project: string, cid: string): string {
  const dir = contextDir(project, cid);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UserError(`No context ${cid} in this project.`, LIST);
  return dir;
}

export function showContext(project: string, cid: string): ContextDetail {
  const [c] = readContexts(project, [cid]);
  if (!c) throw new UserError(`No context ${cid} in this project.`, LIST);
  return {
    id: c.id,
    name: c.name,
    paths: c.paths,
    files: c.files,
    hasNotes: !!c.text.trim(),
    shared: isShared(project, c.id),
    notes: c.text,
    mtime: fileMtime(join(contextDir(project, cid), "context.md")),
  };
}

const idsIn = (root: string) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^[\w-]+$/.test(d.name))
        .map((d) => d.name)
    : [];

export function listContexts(project: string, withShared = true): ContextSummary[] {
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

const freshId = (project: string, cid = `ctx-${hex8()}`): string => {
  let id = cid;
  while (existsSync(contextDir(project, id))) id = `ctx-${hex8()}`;
  return id;
};

// ponytail: a path is kept as typed (Xray Editor); a relative one is read from the project folder, Claude's cwd
const cleanPaths = (paths: string[]) => [...new Set(paths.map((p) => p.trim()).filter(Boolean))];

export function createContext(
  project: string,
  c: { name?: string; shared?: boolean; notes?: string; paths?: string[] },
): ContextDetail {
  const cid = freshId(project);
  const dir = join(c.shared ? sharedContexts() : join(project, "contexts"), cid);
  mkdirSync(join(dir, "files"), { recursive: true });
  writeContextFile(dir, {
    name: c.name?.trim() || "New context",
    paths: cleanPaths(c.paths ?? []),
    notes: c.notes ?? "",
  });
  return showContext(project, cid);
}

export function copyContext(project: string, from: string, cid: string): ContextDetail {
  const source = contextFolder(otherProject(from, project), cid);
  const id = freshId(project, cid);
  mkdirSync(join(project, "contexts"), { recursive: true });
  copyDirAtomic(source, contextDir(project, id));
  return showContext(project, id);
}

export function shareContext(project: string, cid: string, shared: boolean): ContextDetail {
  const from = contextFolder(project, cid);
  if (isShared(project, cid) === shared) return showContext(project, cid);
  const to = join(shared ? sharedContexts() : join(project, "contexts"), cid);
  if (existsSync(to))
    throw new UserError(
      `A context ${cid} is already there.`,
      "Copy it under another id first (contexts copy), or delete the other one.",
    );
  mkdirSync(join(to, ".."), { recursive: true });
  // ponytail: copy then delete — the library sits in AppData, the project often on another drive
  copyDirAtomic(from, to);
  rmSync(from, { recursive: true, force: true });
  return showContext(project, cid);
}

export function setContext(
  project: string,
  cid: string,
  change: { name?: string; notes?: string; paths?: string[] },
): ContextDetail {
  const dir = contextFolder(project, cid);
  const c = readContextFile(dir);
  if (change.name !== undefined) c.name = change.name.trim() || c.name || cid;
  if (change.paths) c.paths = cleanPaths(change.paths);
  if (change.notes !== undefined) c.notes = change.notes;
  if (change.name !== undefined || change.paths || change.notes !== undefined) writeContextFile(dir, c);
  return showContext(project, cid);
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

export function addContextFile(
  project: string,
  cid: string,
  f: { file?: string; name?: string; dataBase64?: string },
): string {
  const files = join(contextFolder(project, cid), "files");
  mkdirSync(files, { recursive: true });
  if (f.dataBase64 !== undefined) {
    const added = freeName(files, safeName(f.name ?? "file"));
    writeAtomic(join(files, added), Buffer.from(f.dataBase64.replace(/^data:[^,]*,/, ""), "base64"));
    return added;
  }
  if (f.file) {
    if (!isAbsolute(f.file) || !existsSync(f.file) || !statSync(f.file).isFile())
      throw new UserError(`No file ${f.file}.`, "Give the absolute path of an existing file.");
    const added = freeName(files, safeName(f.file));
    writeAtomic(join(files, added), readFileSync(f.file));
    return added;
  }
  throw new UserError("Give a file or an upload.", "contexts addFile <id> /path/to/glossary.pdf");
}

export function removeContextFile(project: string, cid: string, name: string): ContextDetail {
  const files = join(contextFolder(project, cid), "files");
  if (basename(name) !== name || name.includes(".."))
    throw new UserError(`"${name}" is not a file of this context.`, "contexts show lists the context's files.");
  rmSync(join(files, name), { force: true });
  return showContext(project, cid);
}

// ponytail: what the conversations with Claude taught — an ordinary context of the project, created by its first
// learning run and attached to the project's defaults then (unticked like any other afterwards). Its learning run
// rewrites it whole after each chat turn, without asking, and these rules hold it short and free of the documents
export const CONVERSATIONS = "conversations";
export const CONVERSATIONS_FILE = `contexts/${CONVERSATIONS}/context.md`;
export const LEARN_MAX = 4000;
const CITED = /[A-Za-z0-9][\w.-]*#(?:§|fig:|page:|img:|t:|v:|frame:)\S/;
const DATED = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;

export function learnConversations(project: string, text: string): ContextDetail {
  const notes = text.replace(/\r\n/g, "\n").trim();
  if (notes.length > LEARN_MAX)
    throw new UserError(
      `${notes.length} characters: the conversations context keeps ${LEARN_MAX} at most.`,
      "Condense it: merge what repeats, drop what no other run needs, then save the whole text again.",
    );
  if (CITED.test(notes))
    throw new UserError(
      "The text cites a document (docId#anchor).",
      "Keep no passage or source of the documents: the runs read them themselves. Say the decision or the preference alone.",
    );
  if (DATED.test(notes))
    throw new UserError(
      "The text holds a date.",
      "No dates and no log: write what holds now, as if it had always been so.",
    );
  const dir = join(project, "contexts", CONVERSATIONS);
  if (!existsSync(join(dir, "context.md"))) {
    mkdirSync(join(dir, "files"), { recursive: true });
    writeContextFile(dir, { name: "Conversations", paths: [], notes });
    const p = readProject(project);
    if (!p.claude.contexts.includes(CONVERSATIONS))
      writeProject(project, { ...p, claude: { ...p.claude, contexts: [...p.claude.contexts, CONVERSATIONS] } });
  } else writeContextFile(dir, { ...readContextFile(dir), notes });
  return showContext(project, CONVERSATIONS);
}
