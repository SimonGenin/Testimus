import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { UserError } from "../command.ts";
import type { DocJson, DocKind, FigureEntry, MediaFile, SourceType } from "../types.ts";
import { copyFileAtomic, writeAtomic } from "./atomic.ts";
import { docDir, readDoc, readFigures, writeDoc, writeFigures } from "./docs.ts";
import { sha256 } from "./hash.ts";
import { overCap, shortOfRoom } from "./video/disk.ts";

export const IMAGE = /\.(jpe?g|png|webp)$/i;
// ponytail: a recording of sound alone (a voice memo, a meeting) is a video without its picture — the same document,
// the same chain: heard, cut into chapters, cited to the second; it has no frame to look at
export const SOUND = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;
export const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|mp3|m4a|aac|wav|ogg|opus|flac)$/i;
export const TEXT = /\.(txt|md)$/i;
// ponytail: what a later version reads (HEIC needs a decoder sharp does not ship): refused with that reason, never as
// « not a document »
export const LATER = /\.(heic|heif)$/i;
const MAX_SIDE = 2000;

export type Picked = { path?: string; name?: string; dataBase64?: string };
export type Rejected = {
  name: string;
  why: string;
  code: "not-media" | "later" | "duplicate" | "failed" | "disk-cap";
};

export const nameOf = (p: Picked) => basename((p.name || p.path || "").replace(/\\/g, "/"));
export const isImage = (name: string) => IMAGE.test(name);
export const isVideo = (name: string) => VIDEO.test(name);

// ponytail: the type a document's source has — written in doc.json for the files of its own, read from the copy's
// extension for a Word, PDF or text document
export function sourceType(doc: Pick<DocJson, "source">): SourceType {
  if (doc.source.type) return doc.source.type;
  const ext = extname(doc.source.file || doc.source.name || "").toLowerCase();
  return ext === ".pdf" ? "pdf" : ext === ".txt" || ext === ".md" ? "txt" : "docx";
}

export const isMediaType = (t: SourceType) => t === "images" || t === "video" || t === "mixed";
export const isMediaDoc = (doc: Pick<DocJson, "source">) => isMediaType(sourceType(doc));

// ponytail: pictures and videos show what the real system does, not what it must do — a source from such a document
// says how to do a step; the team may say one is the reference
export const isObserved = (doc: Pick<DocJson, "source" | "reference">) => isMediaDoc(doc) && !doc.reference;

export const filesOf = (doc: Pick<DocJson, "source">): MediaFile[] => doc.source.files ?? [];

export function typeOfFiles(files: Pick<MediaFile, "kind">[]): SourceType {
  const videos = files.filter((f) => f.kind === "video").length;
  if (!videos) return "images";
  return videos === files.length && videos === 1 ? "video" : "mixed";
}

// ponytail: the source's own hash follows its files (their hashes in their numbers' order), so a document whose
// files changed is read again by the index
export function withFiles(doc: DocJson, files: MediaFile[]): DocJson {
  const sorted = [...files].sort((a, b) => a.n - b.n);
  return {
    ...doc,
    source: {
      ...doc.source,
      type: typeOfFiles(sorted),
      file: "files",
      sha256: sha256(sorted.map((f) => f.sha256).join("\n")),
      files: sorted,
      last: Math.max(doc.source.last ?? 0, ...sorted.map((f) => f.n), 0),
    },
  };
}

// ponytail: doc.json is read again right before every change of its files, so two jobs on one document never write
// over each other's work
export function updateFiles(project: string, docId: string, change: (files: MediaFile[]) => MediaFile[] | undefined) {
  const doc = readDoc(project, docId);
  const files = filesOf(doc).map((f) => ({ ...f }));
  const next = change(files) ?? files;
  const out = withFiles(doc, next);
  writeDoc(project, out);
  return out;
}

export const updateFile = (project: string, docId: string, n: number, change: (f: MediaFile) => void) =>
  updateFiles(project, docId, (files) => {
    const f = files.find((x) => x.n === n);
    if (f) change(f);
  });

// ponytail: a file on this PC is hashed and copied as it streams, never held whole — a video passes 2 GiB, which a
// Buffer cannot hold
function sha256Of(path: string): string {
  const h = createHash("sha256");
  const chunk = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    for (let n = readSync(fd, chunk); n > 0; n = readSync(fd, chunk)) h.update(chunk.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

function bytesOf(f: Picked, name: string): { hash: string; size: number; write: (to: string) => void } {
  if (f.dataBase64 !== undefined) {
    const data = Buffer.from(f.dataBase64, "base64");
    return { hash: sha256(data), size: data.length, write: (to) => writeAtomic(to, data) };
  }
  const path = f.path;
  if (!path || !existsSync(path)) throw new Error(`File not found: ${path ?? name}`);
  return {
    hash: sha256Of(path),
    size: statSync(path).size,
    write: (to) => copyFileAtomic(path, to),
  };
}

// ponytail: each file is copied as it is under files/ (its own name, made unique — never over a file already there)
// and numbered after the highest number the document ever gave — a number is never reused, so an anchor img:<n>
// stays the picture it was; the same file twice is refused, and what is neither an image nor a video is said why
export function copyMediaFiles(project: string, docId: string, picked: Picked[]) {
  const doc = readDoc(project, docId);
  const dir = join(docDir(project, docId), "files");
  const files = filesOf(doc);
  const names = new Set(files.map((f) => basename(f.file).toLowerCase()));
  const hashes = new Set(files.map((f) => f.sha256));
  let next = Math.max(doc.source.last ?? 0, ...files.map((f) => f.n), 0) + 1;
  const added: MediaFile[] = [];
  const rejected: Rejected[] = [];
  for (const p of picked) {
    const name = nameOf(p);
    if (LATER.test(name)) {
      rejected.push({ name, why: "HEIC photos come in a later version: export them as JPEG.", code: "later" });
      continue;
    }
    const kind = isImage(name) ? "image" : isVideo(name) ? "video" : null;
    if (!kind) {
      rejected.push({
        name,
        why: "Only images (JPEG, PNG, WebP), videos and sound recordings can be added here.",
        code: "not-media",
      });

      continue;
    }
    let data: ReturnType<typeof bytesOf>;
    try {
      data = bytesOf(p, name);
    } catch (e) {
      rejected.push({ name, why: e instanceof Error ? e.message : String(e), code: "failed" });
      continue;
    }
    const hash = data.hash;
    if (hashes.has(hash)) {
      rejected.push({ name, why: "This file is already in the document.", code: "duplicate" });
      continue;
    }
    const short = kind === "video" ? shortOfRoom(project, data.size) : null;
    if (short) {
      rejected.push({
        name,
        why: `Not enough room on the project's drive: ${name} needs about ${short.needMB} MB (the copy, its sound and its frames) and ${short.freeMB} MB are free.`,
        code: "failed",
      });
      continue;
    }
    const over = kind === "video" ? overCap(project, data.size) : null;
    if (over) {
      rejected.push({
        name,
        why: `The project's videos take ${over.usedMB} MB of the ${over.capMB} MB the team allows them: this one does not fit. Raise the cap in Settings › Project › Videos (testimus project set --video.disk-cap-gb=<n>), or remove a video.`,
        code: "disk-cap",
      });
      continue;
    }
    hashes.add(hash);
    const n = next++;
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    let file = safe;
    for (let k = 1; names.has(file.toLowerCase()) || existsSync(join(dir, file)); k++)
      file = k === 1 ? `${n}-${safe}` : `${n}-${k}-${safe}`;
    names.add(file.toLowerCase());
    mkdirSync(dir, { recursive: true });
    data.write(join(dir, file));
    added.push({ n, name, file: `files/${file}`, kind, sha256: hash, state: "new" });
  }
  if (added.length)
    updateFiles(project, docId, (fs) => {
      fs.push(...added);
    });
  return { added, rejected };
}

export function newMediaDoc(
  project: string,
  o: { id: string; title: string; kind?: DocKind; name: string; uploaded?: boolean; date?: string },
): DocJson {
  const dir = docDir(project, o.id);
  if (existsSync(join(dir, "doc.json")))
    throw new UserError(`Document ${o.id} already exists.`, "Give another id, or add the files to that document.");
  mkdirSync(dir, { recursive: true });
  const doc: DocJson = {
    id: o.id,
    code: o.id,
    title: o.title,
    version: "",
    date: o.date ?? "",
    kind: o.kind ?? "other",
    status: "draft",
    source: {
      type: "images",
      name: o.name,
      file: "files",
      sha256: "",
      files: [],
      ...(o.uploaded ? { uploaded: true } : {}),
    },
  };
  writeDoc(project, doc);
  return doc;
}

// ponytail: the earliest date written in the EXIF block (the shot, before any later edit), as local time
export function exifDate(exif: Uint8Array | undefined): string | undefined {
  if (!exif) return undefined;
  const text = Buffer.from(exif).toString("latin1");
  const dates = [...text.matchAll(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/g)]
    .map((m) => `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)
    .filter((d) => !d.startsWith("0000"))
    .sort();
  return dates[0];
}

export const imageFigure = (n: number) => `figures/img-${n}.jpg`;
export const imageAnchor = (n: number) => `img:${n}`;

// ponytail: the picture Claude and the tester see — a JPEG of at most 2000 px a side, turned as the camera held it
// (EXIF orientation), a transparent PNG laid on white; the original stays as it was under files/
export async function prepareImage(
  project: string,
  docId: string,
  f: MediaFile,
): Promise<Pick<MediaFile, "figure" | "takenAt" | "width" | "height">> {
  const { default: sharp } = await import("sharp");
  const input = readFileSync(join(docDir(project, docId), f.file));
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const out = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const figure = imageFigure(f.n);
  writeAtomic(join(docDir(project, docId), figure), out.data);
  const takenAt = exifDate(meta.exif);
  return { figure, width: out.info.width, height: out.info.height, ...(takenAt ? { takenAt } : {}) };
}

// ponytail: the pictures read in the order they were taken; one without a date keeps its number's place after them
export function ordered<T extends Pick<MediaFile, "n" | "takenAt">>(files: T[]): T[] {
  return [...files].sort((a, b) =>
    a.takenAt && b.takenAt
      ? a.takenAt.localeCompare(b.takenAt) || a.n - b.n
      : a.takenAt
        ? -1
        : b.takenAt
          ? 1
          : a.n - b.n,
  );
}

const when = (d: string) => `${d.slice(0, 10)} ${d.slice(11, 16)}`;

// ponytail: an image's caption is its file's name and when it was taken — what the team gave, so it is the image's
// quotable text; what Claude read in it (description, visible text) never is
export const imageCaption = (f: Pick<MediaFile, "name" | "takenAt">) =>
  (f.takenAt ? `${f.name} — ${when(f.takenAt)}` : f.name)
    .replace(/[[\]()<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function imageEntry(f: MediaFile, previous?: FigureEntry): FigureEntry {
  return {
    file: f.figure ?? "",
    anchor: imageAnchor(f.n),
    caption: imageCaption(f),
    description: previous?.description ?? "",
    ...(previous?.labels ? { labels: previous.labels } : {}),
    kind: previous?.kind ?? "photo",
  };
}

// ponytail: figures.json keeps an entry per prepared image (img:<n>), what Claude read kept; the key frames of the
// videos (frame:…) are written by the video pipeline and kept here
export function syncImageEntries(project: string, docId: string): FigureEntry[] {
  const doc = readDoc(project, docId);
  const all = readFigures(project, docId);
  const mine = new Map(all.filter((f) => f.anchor.startsWith("img:")).map((f) => [f.anchor, f]));
  const kept = all.filter((f) => !f.anchor.startsWith("img:"));
  const images = ordered(filesOf(doc).filter((f) => f.kind === "image" && f.figure)).map((f) =>
    imageEntry(f, mine.get(imageAnchor(f.n))),
  );
  const out = [...images, ...kept];
  writeFigures(project, docId, out);
  return out;
}

// ponytail: a file goes with everything it put in the document's folder — its copy, its picture, its entries, a
// video's own folder and key frames
export function dropMediaFile(project: string, docId: string, n: number): MediaFile {
  const doc = readDoc(project, docId);
  const f = filesOf(doc).find((x) => x.n === n);
  if (!f) throw new UserError(`${docId} has no file ${n}.`, `testimus media show ${docId} lists its files.`);
  if (filesOf(doc).length === 1)
    throw new UserError(
      `${f.name} is the last file of ${docId}.`,
      `Remove the document instead: testimus docs remove ${docId}.`,
    );
  const dir = docDir(project, docId);
  rmSync(join(dir, f.file), { force: true });
  if (f.figure) rmSync(join(dir, f.figure), { force: true });
  rmSync(join(dir, "video", String(n)), { recursive: true, force: true });
  rmSync(join(dir, "video", `${n}.json`), { force: true });
  const frames = n === 1 ? /^frame:(?!\d+\/)/ : new RegExp(`^frame:${n}/`);
  writeFigures(
    project,
    docId,
    readFigures(project, docId).filter((e) => e.anchor !== imageAnchor(n) && !frames.test(e.anchor)),
  );
  updateFiles(project, docId, (files) => files.filter((x) => x.n !== n));
  return f;
}

export function titleOfFiles(names: string[]): string {
  if (names.length === 1) return basename(names[0], extname(names[0]));
  return `${names.length} images`;
}
