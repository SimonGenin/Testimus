import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { docDir, docIds, readDoc } from "../docs.ts";
import { freeMB } from "../models-download.ts";
import { readProject } from "../project.ts";

const MB = 1024 * 1024;

function bytesOf(dir: string): number {
  if (!existsSync(dir)) return 0;
  let sum = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sum += bytesOf(p);
    else if (e.isFile()) sum += statSync(p).size;
  }
  return sum;
}

// ponytail: the room the project's videos take — the folder of every document holding one (the original, the lighter
// copy, the sound in pieces, the key frames); a written document or one of images alone is not counted
export function videosMB(project: string): number {
  let sum = 0;
  for (const id of docIds(project))
    if ((readDoc(project, id).source.files ?? []).some((f) => f.kind === "video")) sum += bytesOf(docDir(project, id));

  return Math.round(sum / MB);
}

export const capMB = (project: string): number | null => {
  const gb = readProject(project).video?.diskCapGB;
  return gb && gb > 0 ? Math.round(gb * 1024) : null;
};

// ponytail: the cap the team sets for the project's videos (Settings › Videos) is held when a video comes
// in, never afterwards: a video already there is never removed nor left unread because of it
export function overCap(project: string, addBytes: number): { usedMB: number; capMB: number } | null {
  const cap = capMB(project);
  if (cap === null) return null;
  const usedMB = videosMB(project);
  return usedMB + addBytes / MB > cap ? { usedMB, capMB: cap } : null;
}

// ponytail: the drive is looked at before a video is copied in, never found full halfway — the copy, then about a
// half more for the sound in pieces, the frames and a lighter copy, and 200 MB so the drive is not left full
export function shortOfRoom(project: string, addBytes: number): { needMB: number; freeMB: number } | null {
  const free = freeMB(project);
  if (free === null) return null;
  const needMB = Math.ceil((addBytes * 1.5) / MB) + 200;
  return needMB > free ? { needMB, freeMB: free } : null;
}
