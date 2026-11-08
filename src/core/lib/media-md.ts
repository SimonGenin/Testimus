import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clock, momentId } from "../rag/anchors.ts";
import type { DocJson, MediaFile, VideoData } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { docDir, readDoc } from "./docs.ts";
import { filesOf, imageCaption, ordered } from "./media.ts";
import { readJson, writeJson } from "./project.ts";

export const MEDIA_SECTION = "media";
export const videoSection = (n: number) => `video-${n}`;
export const videoFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.json`);
export const frameFigure = (n: number, at: number) => `figures/frame-${n}-${Math.floor(at)}.jpg`;

export function readVideo(project: string, docId: string, n: number): VideoData | null {
  const file = videoFile(project, docId, n);
  return existsSync(file) ? readJson<VideoData>(file, null as unknown as VideoData) : null;
}

export function writeVideo(project: string, docId: string, n: number, v: VideoData): void {
  writeJson(videoFile(project, docId, n), v);
}

export type Line = { anchor: string; at: number; end: number; text: string };

// ponytail: a transcript line's anchor is its video's moment (t:04:30, t:3/04:30 for video 3); two lines that start in
// the same second are told apart by -2, -3 in their order
export function transcriptLines(n: number, v: Pick<VideoData, "transcript">): Line[] {
  const used = new Set<string>();
  return v.transcript.map((l) => {
    const base = momentId(n, l.at);
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
    used.add(id);
    return { anchor: `t:${id}`, at: l.at, end: l.end, text: l.text.replace(/\s+/g, " ").trim() };
  });
}

export const frameAnchor = (n: number, at: number) => `frame:${momentId(n, at)}`;

const clean = (s: string) => s.replace(/<!--|-->/g, " ").trim();

// ponytail: doc.md of an images or video document holds only what is verbatim — each image's caption (its file name
// and date), each transcript line Whisper heard, each key frame's moment; what Claude read (descriptions, visible
// text, chapters) stays in figures.json and video/<n>.json, searched but never quotable
export function mediaMd(doc: Pick<DocJson, "title" | "source">, videos: Map<number, VideoData>): string {
  const files = filesOf(doc);
  const out = [`# ${clean(doc.title) || "Images"} <!-- § ${MEDIA_SECTION} -->`, ""];
  for (const f of ordered(files.filter((x) => x.kind === "image" && x.figure)))
    out.push(`![${imageCaption(f)}](${f.figure}) <!-- img ${f.n} -->`, "");
  for (const f of files.filter((x) => x.kind === "video").sort((a, b) => a.n - b.n))
    out.push(...videoMd(f, videos.get(f.n) ?? null));
  return `${out.join("\n").trimEnd()}\n`;
}

function videoMd(f: MediaFile, v: VideoData | null): string[] {
  const length = f.duration ?? v?.duration;
  const out = [`## ${clean(f.name)}${length ? ` · ${clock(length)}` : ""} <!-- § ${videoSection(f.n)} -->`, ""];
  if (!v) return out;
  const frames = v.keyFrames.filter((k) => k.figure).map((k) => ({ at: k.at, frame: k }));
  const lines = transcriptLines(f.n, v).map((l) => ({ at: l.at, line: l }));
  const items = [...lines, ...frames].sort((a, b) => a.at - b.at || ("frame" in a ? -1 : 1));
  for (const it of items)
    if ("line" in it)
      out.push(`[${clock(it.line.at)}] ${it.line.text} <!-- ${it.line.anchor.replace(":", " ")} -->`, "");
    else
      out.push(
        `![Image at ${clock(it.at)}](${it.frame.figure}) <!-- ${frameAnchor(f.n, it.at).replace(":", " ")} -->`,
        "",
      );
  return out;
}

// ponytail: doc.md is written again from doc.json, the videos' files and figures.json — never edited by hand; true when
// it changed
export function writeMediaMd(project: string, docId: string): boolean {
  const doc = readDoc(project, docId);
  const videos = new Map<number, VideoData>();
  for (const f of filesOf(doc).filter((x) => x.kind === "video")) {
    const v = readVideo(project, docId, f.n);
    if (v) videos.set(f.n, v);
  }
  const md = mediaMd(doc, videos);
  const file = join(docDir(project, docId), "doc.md");
  if (existsSync(file) && readFileSync(file, "utf8") === md) return false;
  writeAtomic(file, md);
  return true;
}
