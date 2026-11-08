import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { surveyVideo } from "../claude/media.ts";
import type { JobRun } from "../claude/prompt.ts";
import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { clock } from "../rag/anchors.ts";
import type { FigureEntry, MediaFile, VideoData } from "../types.ts";
import { docDir, readDoc, readFigures, writeFigures } from "./docs.ts";
import { installedFfmpeg } from "./ffmpeg.ts";
import { updateFile } from "./media.ts";
import { frameAnchor, frameFigure, readVideo, transcriptLines, writeVideo } from "./media-md.ts";
import { readProject } from "./project.ts";
import { distinct, MOSAIC_SIDE, mosaic, normalizeFrame } from "./video-frames.ts";
import { videoIo } from "./video-io.ts";

const TILES = MOSAIC_SIDE * MOSAIC_SIDE;
const MAX_MOSAICS = 12;
const FALLBACK_FRAMES = 12;

// ponytail: the Claude run surveying a video's mosaics is built by claude/media.ts (tests/unit/core/claude/catalog.test.ts)
export const promptsUsed = ["video-survey"];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const videoDir = (project: string, docId: string, n: number) => join(docDir(project, docId), "video", String(n));

const empty = (duration: number, audio: boolean): VideoData => ({
  duration,
  audio,
  transcript: [],
  candidates: [],
  chapters: [],
  keyFrames: [],
});

// ponytail: at most 12 mosaics of 16 frames — a long video is surveyed from candidates taken evenly along it
function spread<T>(xs: T[], most: number): T[] {
  if (xs.length <= most) return xs;
  return Array.from({ length: most }, (_, i) => xs[Math.floor((i * xs.length) / most)]);
}

// ponytail: a moment within the video, one per second — a key frame's figure and anchor are named by its whole
// second, so two moments in the same second would be one figure under two lines of doc.md
function keyMoments(moments: { at: number; why: string }[], duration: number) {
  const bySecond = new Map<number, { at: number; why: string }>();
  for (const m of moments) {
    const at = Math.min(Math.max(0, m.at), duration || m.at);
    if (!bySecond.has(Math.floor(at))) bySecond.set(Math.floor(at), { at, why: m.why });
  }
  return [...bySecond.values()];
}

export type VideoOutcome = { warnings: string[]; claude: boolean; costUsd: number };

// ponytail: one video of a document, each step kept in video/<n>.json as it is done, so a new conversion goes on
// where the last one stopped: ffprobe's facts → Whisper's transcript → the candidate frames (scene changes and one
// every 5 s, near-duplicates dropped) → Claude's survey of the 4 × 4 mosaics (chapters, moments to see) → the key
// frames in full under figures/ (frame:<moment>), which Claude reads with the images. Without ffmpeg the video is
// kept, unread; without the speech model it has no transcript; without Claude its key frames are taken evenly from
// the candidates
export async function processVideo(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  o: { claude: boolean; force?: boolean; run: JobRun },
): Promise<VideoOutcome> {
  const out: VideoOutcome = { warnings: [], claude: false, costUsd: 0 };
  if (!installedFfmpeg()) {
    out.warnings.push(
      `${f.name}: ffmpeg is not on this PC, so the video is kept but not read (no transcript, no frames). Run testimus models pullFfmpeg, then convert the document again.`,
    );
    return out;
  }
  const src = join(docDir(project, docId), f.file);
  const dir = videoDir(project, docId, f.n);
  let v = o.force ? null : readVideo(project, docId, f.n);
  const save = (next: VideoData) => {
    v = next;
    writeVideo(project, docId, f.n, next);
  };
  try {
    if (!v) {
      ctx.progress({ message: `Reading ${f.name}` });
      const p = await videoIo.probe(src, ctx.signal);
      save({ ...empty(p.duration, p.audio), ...(p.width ? { width: p.width, height: p.height } : {}) });
      updateFile(project, docId, f.n, (x) => {
        x.duration = p.duration;
        if (p.width) Object.assign(x, { width: p.width, height: p.height });
        x.state = "ready";
        delete x.error;
      });
    }
    let data = v as VideoData;
    if (data.audio && !data.transcribed) {
      ctx.progress({ message: `Listening to ${f.name}` });
      const pcm = await videoIo.sound(src, join(dir, "sound.f32"), ctx.signal);
      const heard = await videoIo.transcribe(pcm, readProject(project).language, ctx.signal);
      if (heard)
        save({
          ...data,
          transcript: heard.lines,
          transcribed: {
            with: heard.with,
            at: env.now().toISOString(),
            ...(heard.language ? { language: heard.language } : {}),
          },
        });
      else
        out.warnings.push(
          `${f.name}: no speech model on this PC, so the video has no transcript. Install it (testimus models pull whisper-small-q8), then convert the document again.`,
        );
      data = v as VideoData;
    }
    if (!data.candidates.length) {
      ctx.progress({ message: `Looking through ${f.name}` });
      const all = await videoIo.candidates(src, join(dir, "frames"), ctx.signal);
      const kept = await distinct(all);
      for (const c of all) if (!kept.includes(c)) rmSync(c.file, { force: true });
      save({
        ...data,
        candidates: kept.map((c) => ({
          at: c.at,
          file: c.file.slice(docDir(project, docId).length + 1).replace(/\\/g, "/"),
        })),
      });
      data = v as VideoData;
    }
    if (!data.keyFrames.length && data.candidates.length) {
      const picked = o.claude ? await survey(ctx, project, docId, f, data, o.run, out) : null;
      save({
        ...data,
        ...(picked ? { chapters: picked.chapters, surveyed: { at: env.now().toISOString(), model: o.run.model } } : {}),
        keyFrames: keyMoments(
          picked?.moments.length
            ? picked.moments
            : spread(data.candidates, FALLBACK_FRAMES).map((c) => ({ at: c.at, why: "" })),
          data.duration,
        ),
      });
      data = v as VideoData;
    }
    await keyFrames(ctx, project, docId, f, data, save);
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    out.warnings.push(`${f.name}: ${message(e)}`);
    updateFile(project, docId, f.n, (x) => {
      if (!readVideo(project, docId, f.n)) {
        x.state = "failed";
        x.error = message(e);
      }
    });
  }
  return out;
}

async function survey(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  v: VideoData,
  run: JobRun,
  out: VideoOutcome,
) {
  const frames = spread(v.candidates, TILES * MAX_MOSAICS);
  const mosaics: { file: string; tiles: { n: number; at: number }[] }[] = [];
  for (let i = 0; i < frames.length; i += TILES) {
    const part = frames.slice(i, i + TILES);
    const file = `video/${f.n}/mosaic-${mosaics.length + 1}.jpg`;
    await mosaic(
      part.map((c) => ({ at: c.at, file: join(docDir(project, docId), c.file) })),
      join(docDir(project, docId), file),
      i + 1,
    );
    mosaics.push({ file, tiles: part.map((c, k) => ({ n: i + k + 1, at: c.at })) });
  }
  const said = transcriptLines(f.n, v)
    .map((l) => `[${clock(l.at)}] ${l.text}`)
    .join("\n");
  try {
    const r = await surveyVideo(project, docId, ctx, { name: f.name, duration: v.duration }, mosaics, said, run);
    out.claude = true;
    out.costUsd += r.costUsd;
    return r.survey;
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    out.warnings.push(`${f.name}: Claude did not survey the video (${message(e)}); key frames taken evenly instead.`);
    return null;
  }
}

// ponytail: each key frame without its picture is drawn from the video at its moment, in full (≤ 2000 px), and gets
// its figures.json entry (frame:<moment>, caption « Image at mm:ss »); one that moved away goes with its picture
async function keyFrames(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  v: VideoData,
  save: (v: VideoData) => void,
): Promise<void> {
  const dir = docDir(project, docId);
  const src = join(dir, f.file);
  const frames = [...v.keyFrames];
  for (const [i, k] of frames.entries()) {
    if (k.figure && existsSync(join(dir, k.figure))) continue;
    if (ctx.signal.aborted) break;
    ctx.progress({ message: `Taking the key frames of ${f.name}`, done: i, total: frames.length });
    const figure = frameFigure(f.n, k.at);
    const raw = join(videoDir(project, docId, f.n), "key.jpg");
    await videoIo.frameAt(src, k.at, raw, ctx.signal);
    await normalizeFrame(raw, join(dir, figure));
    rmSync(raw, { force: true });
    frames[i] = { ...k, figure };
  }
  save({ ...v, keyFrames: frames });
  const mine = new RegExp(f.n === 1 ? "^frame:(?!\\d+/)" : `^frame:${f.n}/`);
  const all = readFigures(project, docId);
  const before = new Map(all.filter((e) => mine.test(e.anchor)).map((e) => [e.anchor, e]));
  const entries: FigureEntry[] = frames
    .filter((k) => k.figure)
    .map((k) => {
      const anchor = frameAnchor(f.n, k.at);
      const was = before.get(anchor);
      return {
        file: k.figure as string,
        anchor,
        caption: `Image at ${clock(k.at)}`,
        description: was?.description ?? "",
        ...(was?.labels ? { labels: was.labels } : {}),
        kind: was?.kind ?? "screen",
      };
    });
  const keep = new Set(entries.map((e) => e.file));
  for (const e of before.values()) if (!keep.has(e.file)) rmSync(join(dir, e.file), { force: true });
  writeFigures(project, docId, [...all.filter((e) => !mine.test(e.anchor)), ...entries]);
}

// ponytail: what docs.show and media.show say of a video — its facts, chapters, key frames; the transcript is read
// apart (media.transcript), it can be long
export function videoSummary(project: string, docId: string, f: MediaFile) {
  const v = readVideo(project, docId, f.n);
  const figures = new Map(readFigures(project, docId).map((e) => [e.anchor, e]));
  return {
    n: f.n,
    name: f.name,
    file: f.file,
    duration: v?.duration ?? f.duration ?? 0,
    transcribed: !!v?.transcribed,
    lines: v?.transcript.length ?? 0,
    chapters: (v?.chapters ?? []).map((c) => ({ at: c.at, title: c.title })),
    keyFrames: (v?.keyFrames ?? [])
      .filter((k) => k.figure)
      .map((k) => {
        const anchor = frameAnchor(f.n, k.at);
        return {
          at: k.at,
          anchor,
          figure: k.figure as string,
          why: k.why,
          description: figures.get(anchor)?.description ?? "",
        };
      }),
  };
}

export const hasVideo = (project: string, docId: string) =>
  (readDoc(project, docId).source.files ?? []).some((f) => f.kind === "video");
