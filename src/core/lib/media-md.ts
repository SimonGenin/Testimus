import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clock, momentId } from "../rag/anchors.ts";
import type { DocJson, FigureEntry, MediaFile, SpokenLine, VideoData, VideoFixes } from "../types.ts";
import { writeAtomic } from "./atomic.ts";
import { docDir, readDoc, readFigures } from "./docs.ts";
import { filesOf, imageCaption, ordered } from "./media.ts";
import { readJson, writeJson } from "./project.ts";
import { bySecond, withFixes } from "./video/lines.ts";

export const MEDIA_SECTION = "media";
export const videoSection = (n: number) => `video-${n}`;
export const videoFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.json`);
export const fixesFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.fixes.json`);
export const frameFigure = (n: number, at: number) => `figures/frame-${n}-${Math.floor(at)}.jpg`;

export function readVideo(project: string, docId: string, n: number): VideoData | null {
  const file = videoFile(project, docId, n);
  return existsSync(file) ? readJson<VideoData>(file, null as unknown as VideoData) : null;
}

export function writeVideo(project: string, docId: string, n: number, v: VideoData): void {
  writeJson(videoFile(project, docId, n), v);
}

export function readFixes(project: string, docId: string, n: number): VideoFixes {
  const f = readJson<Partial<VideoFixes>>(fixesFile(project, docId, n), {});
  return { lines: f.lines ?? [], frames: f.frames ?? [] };
}

export function writeFixes(project: string, docId: string, n: number, f: VideoFixes): void {
  writeJson(fixesFile(project, docId, n), {
    lines: [...f.lines].sort((a, b) => a.from - b.from),
    frames: [...f.frames].sort((a, b) => a.second - b.second),
  });
}

export type Line = SpokenLine & { anchor: string };

// ponytail: what is said in a video as everything reads it — the machine's lines with what people corrected or
// confirmed laid over them (a fixed range is theirs), one line a second at most. A line's anchor is the second it
// starts at (t:04:30, t:3/04:30 for video 3): a moment of the video, which exists for good, never a line's rank
export function spokenLines(v: Pick<VideoData, "transcript">, fixes: Pick<VideoFixes, "lines">): SpokenLine[] {
  return bySecond(withFixes(v.transcript, fixes.lines)).map((l) => ({
    ...l,
    text: l.text.replace(/\s+/g, " ").trim(),
  }));
}

export function transcriptLines(
  n: number,
  v: Pick<VideoData, "transcript">,
  fixes: Pick<VideoFixes, "lines"> = { lines: [] },
): Line[] {
  return spokenLines(v, fixes).map((l) => ({ ...l, anchor: `t:${momentId(n, l.at)}` }));
}

export const frameAnchor = (n: number, at: number) => `frame:${momentId(n, at)}`;

const clean = (s: string) =>
  s
    .replace(/<!--|-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ponytail: doc.md of an images or video document holds what a source may quote. An image: its caption (its file
// name and date). A video: each line said, at its second, and each key frame with — under it, in its paragraph — the
// description of what it shows (decided 2026-11-10: what is seen without a word being said is cited from a key
// frame's description; it is Claude's reading, observed like the picture, and a person may correct it). What is beside
// a line in a comment is never quotable: its language and its translation (« = … »), and « unsure » on a line the
// engine doubted. An image's description, its visible text and a video's chapters stay in figures.json and
// video/<n>.json: searched, shown, never quotable
export function mediaMd(
  doc: Pick<DocJson, "title" | "source">,
  videos: Map<number, { v: VideoData; fixes: VideoFixes }>,
  figures: FigureEntry[] = [],
): string {
  const files = filesOf(doc);
  const described = new Map(figures.map((f) => [f.anchor, f.description]));
  const out = [`# ${clean(doc.title) || "Images"} <!-- § ${MEDIA_SECTION} -->`, ""];
  for (const f of ordered(files.filter((x) => x.kind === "image" && x.figure)))
    out.push(`![${imageCaption(f)}](${f.figure}) <!-- img ${f.n} -->`, "");
  for (const f of files.filter((x) => x.kind === "video").sort((a, b) => a.n - b.n))
    out.push(...videoMd(f, videos.get(f.n) ?? null, described));
  return `${out.join("\n").trimEnd()}\n`;
}

function videoMd(
  f: MediaFile,
  got: { v: VideoData; fixes: VideoFixes } | null,
  described: Map<string, string>,
): string[] {
  const length = f.duration ?? got?.v.duration;
  const out = [`## ${clean(f.name)}${length ? ` · ${clock(length)}` : ""} <!-- § ${videoSection(f.n)} -->`, ""];
  if (!got) return out;
  const seen = new Set<number>();
  const frames = got.v.keyFrames
    .filter((k) => k.figure)
    .filter((k) => !seen.has(Math.floor(k.at)) && seen.add(Math.floor(k.at)))
    .map((k) => ({ at: k.at, frame: k }));
  const lines = transcriptLines(f.n, got.v, got.fixes).map((l) => ({ at: l.at, line: l }));
  const items = [...lines, ...frames].sort((a, b) => a.at - b.at || ("frame" in a ? -1 : 1));
  for (const it of items)
    if ("line" in it) {
      const l = it.line;
      const beside = [
        l.unsure && l.by !== "human" ? " <!-- unsure -->" : "",
        l.translation ? ` <!-- ${l.lang ? `${l.lang} ` : ""}= ${clean(l.translation)} -->` : "",
      ].join("");
      out.push(`[${clock(l.at)}] ${clean(l.text)} <!-- ${l.anchor.replace(":", " ")} -->${beside}`, "");
    } else {
      const anchor = frameAnchor(f.n, it.at);
      const text = clean(described.get(anchor) ?? "");
      out.push(
        `![Image at ${clock(it.at)}](${it.frame.figure}) <!-- ${anchor.replace(":", " ")} -->`,
        ...(text ? [text] : []),
        "",
      );
    }
  return out;
}

const stamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
const cue = (s: string) => s.replace(/-->/g, "→").replace(/\s+/g, " ").trim();

// ponytail: the subtitles of a video, derived like doc.md — a cue ends where the next line starts (in voice-detector
// mode a line's own end is rough), at most 8 s after its start; `translated` gives the project's language where a line
// has a translation
export function subtitles(lines: SpokenLine[], translated: boolean): string {
  const out = ["WEBVTT", ""];
  lines.forEach((l, i) => {
    const next = lines[i + 1]?.at;
    const own = Math.max(l.end, l.at + 1.5) + 1.5;
    const end = Math.min(l.at + 10, next !== undefined && next > l.at ? Math.min(own, next) : own);
    const text = translated ? (l.translation ?? l.text) : l.text;
    if (!text.trim()) return;
    out.push(`${stamp(l.at)} --> ${stamp(Math.max(end, l.at + 0.5))}`, cue(text), "");
  });
  return out.join("\n");
}

export function chapterTrack(chapters: { at: number; title: string }[], duration: number): string {
  const out = ["WEBVTT", ""];
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.at ?? duration;
    if (end > c.at) out.push(`${stamp(c.at)} --> ${stamp(end)}`, cue(c.title), "");
  });
  return out.join("\n");
}

export const subsFile = (n: number, kind: "said" | "translated" | "chapters") => `video/${n}/${kind}.vtt`;

function writeIfChanged(file: string, text: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  writeAtomic(file, text);
  return true;
}

// ponytail: doc.md is written again from doc.json, the videos' files, what people fixed and figures.json — never
// edited by hand; with it the subtitles and the chapters of each video (WebVTT, for the page's player and any other).
// True when doc.md changed
export function writeMediaMd(project: string, docId: string): boolean {
  const doc = readDoc(project, docId);
  const dir = docDir(project, docId);
  const videos = new Map<number, { v: VideoData; fixes: VideoFixes }>();
  for (const f of filesOf(doc).filter((x) => x.kind === "video")) {
    const v = readVideo(project, docId, f.n);
    if (!v) continue;
    const fixes = readFixes(project, docId, f.n);
    videos.set(f.n, { v, fixes });
    const lines = spokenLines(v, fixes);
    if (lines.length) {
      writeIfChanged(join(dir, subsFile(f.n, "said")), subtitles(lines, false));
      if (lines.some((l) => l.translation))
        writeIfChanged(join(dir, subsFile(f.n, "translated")), subtitles(lines, true));
    }
    if (v.chapters.length) writeIfChanged(join(dir, subsFile(f.n, "chapters")), chapterTrack(v.chapters, v.duration));
  }
  return writeIfChanged(join(dir, "doc.md"), mediaMd(doc, videos, readFigures(project, docId)));
}
