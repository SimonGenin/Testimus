import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { uncPath } from "../../shared/unc.ts";
import { UserError } from "../command.ts";
import { guessFromName } from "../rag/convert.ts";
import { docIds, readDoc } from "./docs.ts";
import { isImage, isVideo } from "./media.ts";
import { natural } from "./natural.ts";

export const FOLDER_REASONS = [
  "not-a-document",
  "lock-file",
  "not-supported",
  "empty",
  "twin",
  "in-project",
  "same-code",
] as const;
export type FolderReason = (typeof FOLDER_REASONS)[number];

export type FolderFile = {
  path: string;
  rel: string;
  size: number;
  importable: boolean;
  id?: string;
  twin?: string;
  group?: string;
  reason?: FolderReason;
  why?: string;
};

export type FolderScan = {
  dir: string;
  recursive: boolean;
  files: FolderFile[];
  documents: number;
  leftAside: number;
  truncated: boolean;
};

export const FOLDER_MAX_FILES = 2000;

const SYSTEM = /^(thumbs\.db|ehthumbs\.db|desktop\.ini|\.ds_store)$/i;
const TEMP = /\.(tmp|temp|bak|crdownload|part)$/i;
const LATER =
  /\.(docm|dotx?|xlsx?|xlsm|pptx?|rtf|odt|ods|odp|csv|html?|msg|eml|vsdx?|gif|bmp|tiff?|heic|mp3|wav|m4a)$/i;
const DOCUMENT = /\.(docx|pdf|txt|md)$/i;

const keyOf = (p: string) => join(dirname(p), basename(p, extname(p)).toLowerCase());
const isExt = (p: string, ext: string) => extname(p).toLowerCase() === ext;

// ponytail: the id a file gets is the code read from its name, made a valid folder name — so two files the import
// would give the same id are told apart before anything is copied
export function idOf(file: string): string {
  const code = guessFromName(
    basename(file)
      .replace(/œ/g, "oe")
      .replace(/Œ/g, "OE")
      .replace(/æ/g, "ae")
      .replace(/Æ/g, "AE")
      .normalize("NFD")
      .replace(/\p{M}+/gu, ""),
  )
    .code.replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "");
  return code || "document";
}

function asideOf(name: string, size: number): { reason: FolderReason; why: string } | null {
  if (name.startsWith("~$"))
    return { reason: "lock-file", why: /\.docx?$/i.test(name) ? "Word's lock file" : "an Office lock file" };
  if (SYSTEM.test(name) || name.startsWith(".") || TEMP.test(name))
    return { reason: "not-a-document", why: "not a document" };
  if (isExt(name, ".doc")) return { reason: "not-supported", why: "an old Word .doc: save it as .docx in Word first" };
  if (!DOCUMENT.test(name) && !isImage(name) && !isVideo(name))
    return LATER.test(name)
      ? { reason: "not-supported", why: `Testimus cannot convert ${extname(name).toLowerCase()} files yet` }
      : { reason: "not-a-document", why: "not a document" };
  if (!size) return { reason: "empty", why: "an empty file" };
  return null;
}

function walk(root: string, recursive: boolean, skip: string | null): { paths: string[]; truncated: boolean } {
  const paths: string[] = [];
  const dirs = [root];
  while (dirs.length) {
    const dir = dirs.shift() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => natural(a.name, b.name));
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isFile()) {
        if (paths.length >= FOLDER_MAX_FILES) return { paths, truncated: true };
        paths.push(path);
      } else if (recursive && e.isDirectory() && !e.name.startsWith(".") && resolve(path) !== skip) dirs.push(path);
    }
  }
  return { paths, truncated: false };
}

function checkDir(dir: string): string {
  if (!dir.trim()) throw new UserError("No folder given.", "Give the folder's full path, e.g. D:\\Specs\\J5.");
  if (uncPath(dir))
    throw new UserError(
      "A network path (\\\\server\\share) is not read.",
      "Copy the folder to this PC, or open it through a drive letter (S:\\…).",
    );
  if (!isAbsolute(dir.trim()))
    throw new UserError(`${dir} is not a full path.`, "Give the folder's full path, e.g. D:\\Specs\\J5.");
  const full = resolve(dir.trim());
  if (!existsSync(full) || !statSync(full).isDirectory())
    throw new UserError(`No folder ${full}.`, "Check the path: it must be a folder of this PC.");
  return full;
}

function projectNames(project: string | null): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const id of project ? docIds(project) : []) {
    ids.add(id.toLowerCase());
    const name = readDoc(project as string, id).source?.name;
    if (name) names.add(basename(name.replace(/\\/g, "/")).toLowerCase());
  }
  return { ids, names };
}

// ponytail: what an import of a folder would add, file by file — each .docx, .pdf or .txt is a document (a .pdf beside
// a .docx of the same name is its rendering, added with it), each video is one, and the images of one folder are one
// images document named after that folder (group = the folder's rel, « . » for the folder itself); everything else is
// left aside with the reason; the project's own folder is never read, and a document already in the project (same id
// or same file name) is not added twice
export function scanFolder(project: string | null, dir: string, recursive: boolean): FolderScan {
  const root = checkDir(dir);
  const { paths, truncated } = walk(root, recursive, project ? resolve(project) : null);
  const known = projectNames(project);
  const rel = (p: string) => relative(root, p).split(sep).join("/");
  const sizes = new Map(paths.map((p) => [p, statSync(p).size]));
  const fine = paths.filter((p) => !asideOf(basename(p), sizes.get(p) ?? 0));
  const words = new Map(fine.filter((p) => isExt(p, ".docx")).map((p) => [keyOf(p), p]));
  const renderings = new Map(fine.filter((p) => isExt(p, ".pdf")).map((p) => [keyOf(p), p]));
  const taken = new Map<string, string>();
  const files: FolderFile[] = paths.map((path) => {
    const name = basename(path);
    const base = { path, rel: rel(path), size: sizes.get(path) ?? 0, importable: false };
    const aside = asideOf(name, base.size);
    if (aside) return { ...base, ...aside };
    const word = isExt(name, ".pdf") ? words.get(keyOf(path)) : undefined;
    if (word) return { ...base, reason: "twin" as const, why: `the rendering of ${basename(word)}, added with it` };
    if (isImage(name)) {
      const group = rel(dirname(path)) || ".";
      const id = idOf(basename(dirname(path)));
      if (known.ids.has(id.toLowerCase()))
        return { ...base, id, group, reason: "in-project" as const, why: "already in the project" };
      const first = taken.get(id.toLowerCase());
      if (first && dirname(first) !== dirname(path))
        return { ...base, id, group, reason: "same-code" as const, why: `the same document code as ${rel(first)}` };
      taken.set(id.toLowerCase(), path);
      return { ...base, importable: true, id, group };
    }
    const id = idOf(path);
    if (known.ids.has(id.toLowerCase()) || known.names.has(name.toLowerCase()))
      return { ...base, id, reason: "in-project" as const, why: "already in the project" };
    const first = taken.get(id.toLowerCase());
    if (first) return { ...base, id, reason: "same-code" as const, why: `the same document code as ${rel(first)}` };
    taken.set(id.toLowerCase(), path);
    const twin = isExt(name, ".docx") ? renderings.get(keyOf(path)) : undefined;
    return { ...base, importable: true, id, ...(twin ? { twin: rel(twin) } : {}) };
  });
  return {
    dir: root,
    recursive,
    files,
    documents: new Set(files.filter((f) => f.importable).map((f) => f.group ?? f.rel)).size,
    leftAside: files.filter((f) => !f.importable && f.reason !== "twin").length,
    truncated,
  };
}
