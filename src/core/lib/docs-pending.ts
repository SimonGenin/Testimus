import { existsSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import { basename, extname, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { guessFromName } from "../rag/convert.ts";
import type { DocJson, DocKind, PendingFile, SourceType } from "../types.ts";
import { agentsSetting } from "./agents.ts";
import { byteSteps, copyFileAtomic } from "./atomic.ts";
import { docDir, docIds, readDoc, writeDoc } from "./docs.ts";
import { idOf } from "./docs-folder.ts";
import { copyMediaFiles, isVideo, sourceType } from "./media.ts";
import { freeId } from "./media-add.ts";
import { freeMB } from "./models-download.ts";
import { estimateOf } from "./video/estimate.ts";
import { videoIo } from "./video/io.ts";

const MB = 1024 * 1024;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isPending = (doc: Pick<DocJson, "pending">) => !!doc.pending;

// ponytail: what a pending document will be, as the folder scan found it — one file (a .docx with its .pdf rendering,
// a .pdf, a text file, a video) or the images of one folder
export type PendingUnit = {
  files: { path: string; size: number }[];
  pdf?: { path: string; size: number };
  id?: string;
  images?: string;
};

// ponytail: a video's facts are read when it comes in (ffprobe, a few hundred ms), so the plan weighs its length;
// a video ffprobe cannot read is still added, its length unknown
async function factsOf(f: { path: string; size: number }, signal?: AbortSignal): Promise<PendingFile> {
  if (!isVideo(f.path)) return { path: f.path, size: f.size };
  try {
    const p = await videoIo.probe(f.path, signal ?? new AbortController().signal);
    return {
      path: f.path,
      size: f.size,
      duration: p.duration,
      audio: p.audio,
      tracks: p.tracks.length,
      ...(p.picture === false ? { picture: false } : {}),
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { path: f.path, size: f.size };
  }
}

// ponytail: a pending document is its doc.json alone — the title, the type, where its originals are and how big; nothing
// is copied nor converted until docs.start. A Word, PDF or text document takes the id read from its name (refused when
// a document has it), the images of a folder and a video a free one, as when they are copied at once
export async function addPending(
  project: string,
  units: PendingUnit[],
  o: { kind?: DocKind },
  signal?: AbortSignal,
): Promise<{ added: DocJson[]; rejected: { name: string; why: string }[] }> {
  const added: DocJson[] = [];
  const rejected: { name: string; why: string }[] = [];
  const taken = new Set<string>();
  for (const u of units) {
    const first = u.files[0];
    const media = u.images !== undefined || isVideo(first.path);
    const stem = basename(first.path, extname(first.path));
    const title = u.images ?? stem;
    let id: string;
    if (media) id = freeId(project, u.id ?? title, taken);
    else {
      id = u.id || idOf(first.path);
      if (existsSync(join(docDir(project, id), "doc.json"))) {
        rejected.push({ name: basename(first.path), why: `Document ${id} already exists.` });
        continue;
      }
    }
    const files = await Promise.all(u.files.map((f) => factsOf(f, signal)));
    const type: SourceType | undefined = u.images !== undefined ? "images" : media ? "video" : undefined;
    const doc: DocJson = {
      id,
      code: media ? id : idOf(first.path),
      title,
      version: media ? "" : guessFromName(first.path).version,
      date: "",
      kind: o.kind ?? (media ? "other" : "spec"),
      status: "draft",
      source: { ...(type ? { type } : {}), name: first.path, file: "", sha256: "" },
      pending: { files, ...(u.pdf ? { pdf: u.pdf } : {}), at: env.now().toISOString() },
    };
    writeDoc(project, doc);
    added.push(doc);
  }
  return { added, rejected };
}

type Copy = { done: number; total: number; queued: boolean };
const copies = new Map<string, Copy>();
const keyOf = (project: string, id: string) => `${project.toLowerCase()}|${id}`;

// ponytail: the copies a start holds — queued until their turn, then their bytes as they pass; what docs.list says
// of a pending document being copied (lost with the process: the document is then pending again)
export const copyOf = (project: string, id: string): Copy | undefined => copies.get(keyOf(project, id));

export function copyAt(project: string, id: string, done: number, total: number): void {
  copies.set(keyOf(project, id), { done, total, queued: false });
}

export function queueCopies(project: string, docs: DocJson[]): () => void {
  for (const d of docs) copies.set(keyOf(project, d.id), { done: 0, total: bytesOf(d), queued: true });
  return () => {
    for (const d of docs) copies.delete(keyOf(project, d.id));
  };
}

export const bytesOf = (d: Pick<DocJson, "pending">) =>
  (d.pending?.files ?? []).reduce((n, f) => n + f.size, 0) + (d.pending?.pdf?.size ?? 0);

function clean(project: string, id: string): void {
  const dir = docDir(project, id);
  rmSync(join(dir, "files"), { recursive: true, force: true });
  for (const f of ["source.docx", "source.pdf", "source.txt", "source.md"]) rmSync(join(dir, f), { force: true });
}

const settled = (doc: DocJson): DocJson => {
  const { pending: _, ...rest } = doc;
  return rest;
};

// ponytail: starting a pending document copies its originals (streamed, hashed as they pass, in bytes) and drops
// pending from its doc.json once every copy is in place — whatever the team set meanwhile (title, status, context)
// stays. A copy that fails leaves the document pending with the reason (failed), and nothing copied; a cancel leaves it
// pending as it was
export async function startPending(
  project: string,
  id: string,
  signal?: AbortSignal,
  onBytes?: (name: string, done: number, total: number) => void,
): Promise<{ doc: DocJson; rejected: { name: string; why: string }[] }> {
  const doc = readDoc(project, id);
  const p = doc.pending;
  if (!p) throw new UserError(`${id} is not waiting to start.`, `testimus docs convert ${id} converts it again.`);
  const key = keyOf(project, id);
  const total = bytesOf(doc);
  const said = (name: string, done: number) => {
    copyAt(project, id, done, total);
    onBytes?.(name, done, total);
  };
  const back = { ...doc, pending: { ...p, failed: undefined } };
  delete back.pending.failed;
  try {
    clean(project, id);
    const gone = [...p.files, ...(p.pdf ? [p.pdf] : [])].find((f) => !existsSync(f.path));
    if (gone)
      throw new UserError(
        `${gone.path} is no longer there.`,
        "Put the file back where it was, or remove the document and import its folder again.",
      );
    if (sourceType(doc) === "images" || sourceType(doc) === "video" || sourceType(doc) === "mixed") {
      writeDoc(project, { ...back, source: { ...doc.source, file: "files", sha256: "", files: [] } });
      let before = 0;
      let name = "";
      const r = await copyMediaFiles(
        project,
        id,
        p.files.map((f) => ({ path: f.path })),
        signal,
        (n, done, size) => {
          if (n !== name) {
            before += name ? (p.files.find((f) => basename(f.path) === name)?.size ?? 0) : 0;
            name = n;
          }
          said(n, Math.min(total, before + Math.min(done, size)));
        },
      );
      if (!r.added.length)
        throw new UserError(
          r.rejected.map((x) => `${x.name}: ${x.why}`).join(" · ") || "No file could be copied.",
          "Check the files, or remove the document.",
        );
      const next = settled(readDoc(project, id));
      writeDoc(project, next);
      return { doc: next, rejected: r.rejected };
    }
    const room = freeMB(project);
    const needMB = Math.ceil(total / MB) + 200;
    if (room !== null && needMB > room)
      throw new UserError(
        `Not enough room on the project's drive: ${doc.title} needs about ${needMB} MB and ${room} MB are free.`,
        "Free some room on the project's drive, then start it again.",
      );
    const file = p.files[0].path;
    const ext = extname(file).toLowerCase();
    const dir = docDir(project, id);
    let done = 0;
    const copy = async (from: string) => {
      const size = statSync(from).size;
      const steps = byteSteps(size, (d) => said(basename(from), done + d));
      const hash = await copyFileAtomic(from, join(dir, from === file ? `source${ext}` : "source.pdf"), {
        signal,
        onBytes: steps,
      });
      done += size;
      return hash;
    };
    said(basename(file), 0);
    const sha256 = await copy(file);
    const twin = p.pdf ? { file: "source.pdf", sha256: await copy(p.pdf.path) } : undefined;
    const next: DocJson = {
      ...settled(readDoc(project, id)),
      source: { name: file, file: `source${ext}`, sha256 },
      ...(twin ? { twin } : {}),
    };
    writeDoc(project, next);
    return { doc: next, rejected: [] };
  } catch (e) {
    clean(project, id);
    if (existsSync(join(docDir(project, id), "doc.json"))) {
      const now = readDoc(project, id);
      const kept = { ...now, source: doc.source, pending: back.pending };
      writeDoc(project, signal?.aborted ? kept : { ...kept, pending: { ...back.pending, failed: message(e) } });
    }
    throw e;
  } finally {
    copies.delete(key);
  }
}

// ponytail: the documents waiting to start — those a start is copying are not (docs.list says copying)
export const pendingIds = (project: string): string[] =>
  docIds(project).filter((id) => {
    try {
      return isPending(readDoc(project, id)) && !copyOf(project, id);
    } catch {
      return false;
    }
  });

const COPY_BYTES_S = 60 * MB;
const DOC_S = 60;
const TEXT_S = 5;
const RUN_S = 60;
const PICTURES_A_RUN = 20;
const SHORT_VIDEO_S = 600;
const VIDEO_UNKNOWN_S = 12 * 60;

export type PendingPlan = {
  ids: string[];
  byType: Record<SourceType, number>;
  files: number;
  bytes: number;
  needBytes: number;
  freeBytes: number | null;
  short: boolean;
  claudeRuns: number;
  slots: number;
  copySeconds: number;
  convertSeconds: number;
  seconds: number;
};

// ponytail: what starting pending documents would take, said before the go — the documents by type, the bytes to
// copy against the room on the project's drive (a video takes half its size again: its sound, its frames, a lighter
// copy; 200 MB are left free), Claude's runs (one per Word or PDF document, one per 20 photos, about 3 for a video
// under 10 min and 12 beyond — ARCHITECTURE.md §16) and the time: the copies one after the other at a local disk's
// pace, then the conversions side by side in the pool's places (about 5 Word documents a minute with 5 places, measured
// 2026-11-10), the videos one at a time (one transcription at a time on the PC: media.estimate's figure, else about
// 12 min — a 50 min video took that). An estimate, said as one
export function pendingPlan(project: string, ids?: string[]): PendingPlan {
  const all = pendingIds(project);
  const chosen = ids ? all.filter((id) => ids.includes(id)) : all;
  const docs = chosen.map((id) => readDoc(project, id));
  const byType: Record<SourceType, number> = { docx: 0, pdf: 0, txt: 0, images: 0, video: 0, mixed: 0 };
  let bytes = 0;
  let videoBytes = 0;
  let files = 0;
  let runs = 0;
  let pooled = 0;
  let videoSeconds = 0;
  for (const d of docs) {
    const t = sourceType(d);
    const p = d.pending;
    if (!p) continue;
    byType[t]++;
    const size = bytesOf(d);
    bytes += size;
    files += p.files.length + (p.pdf ? 1 : 0);
    if (t === "docx" || t === "pdf") {
      runs += 1;
      pooled += DOC_S;
    } else if (t === "txt") pooled += TEXT_S;
    else if (t === "images") {
      const n = Math.ceil(p.files.length / PICTURES_A_RUN);
      runs += n;
      pooled += n * RUN_S;
    } else {
      videoBytes += size;
      for (const f of p.files) {
        runs += f.duration !== undefined && f.duration < SHORT_VIDEO_S ? 3 : 12;
        if (f.duration === undefined) {
          videoSeconds += VIDEO_UNKNOWN_S;
          continue;
        }
        const e = estimateOf(
          { duration: f.duration, bytes: f.size, audio: f.audio ?? true, tracks: f.tracks ?? 1, picture: f.picture },
          null,
          { claude: true, folder: join(project, "docs") },
        );
        videoSeconds += Math.max(e.seconds, Math.round(f.duration * 0.24));
      }
    }
  }
  const set = agentsSetting();
  const slots = Math.max(1, set.adaptive ? Math.min(set.max, os.availableParallelism() - 1) : set.max);
  const room = freeMB(project);
  const needBytes = bytes + Math.round(videoBytes / 2) + (docs.length ? 200 * MB : 0);
  const copySeconds = Math.round(bytes / COPY_BYTES_S);
  const convertSeconds = Math.round(Math.max(pooled / slots, videoSeconds));
  return {
    ids: docs.map((d) => d.id),
    byType,
    files,
    bytes,
    needBytes,
    freeBytes: room === null ? null : room * MB,
    short: room !== null && needBytes > room * MB,
    claudeRuns: runs,
    slots,
    copySeconds,
    convertSeconds,
    seconds: copySeconds + convertSeconds,
  };
}
