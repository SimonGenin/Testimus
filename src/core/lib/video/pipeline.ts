import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { translateLines } from "../../claude/media.ts";
import type { JobRun } from "../../claude/prompt.ts";
import type { Ctx } from "../../command.ts";
import { env } from "../../env.ts";
import { clock } from "../../rag/anchors.ts";
import type { MediaFile, SpokenLine, VideoData } from "../../types.ts";
import { docDir, readDoc, readFigures } from "../docs.ts";
import { installedFfmpeg } from "../ffmpeg.ts";
import { machineProfile } from "../machine/profile.ts";
import { filesOf, updateFile } from "../media.ts";
import { frameAnchor, readFixes, readVideo, spokenLines, writeMediaMd, writeVideo } from "../media-md.ts";
import { readProject } from "../project.ts";
import { speechSetup } from "./engine.ts";
import { speechGlossary } from "./glossary.ts";
import { videoIo } from "./io.ts";
import { buildReport } from "./report.ts";
import { transcribe } from "./speech.ts";
import {
  chooseMoments,
  drawKeyFrames,
  dropSurveyFiles,
  findCandidates,
  keyMoments,
  type Outcome,
  planChapters,
  stamp,
  WHOLE_S,
} from "./survey.ts";

// ponytail: the Claude run translating what is said is built by claude/media.ts (tests/unit/core/claude/catalog.test.ts)
export const promptsUsed = ["video-translate"];

const KEY_EVERY_S = 4;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const videoDir = (project: string, docId: string, n: number) => join(docDir(project, docId), "video", String(n));
export const lightFile = (n: number) => `video/${n}/light.mp4`;

export type VideoOutcome = Outcome;
export type VideoWork = {
  claude: boolean;
  force?: boolean;
  /** hear the video again though it was heard: the pieces whose model, languages or glossary changed are redone */
  again?: boolean;
  run: JobRun;
};

const empty = (duration: number, audio: boolean): VideoData => ({
  duration,
  audio,
  transcript: [],
  candidates: [],
  chapters: [],
  keyFrames: [],
});

// ponytail: one video of a document, each part kept in video/<n>.json as it is done so a new conversion goes on where
// the last one stopped, and in the order that gives something to use first: ffprobe's facts (the video plays in the
// page at once) → what is said, piece by piece, readable as it comes → its translation → the chapters (from what is
// said alone; a video of ten minutes or less gets them from the one run that chooses its frames) → the candidate
// frames → Claude's choice, part by part → the key frames in full under figures/
// (frame:<moment>), which Claude then describes with the pictures → a lighter copy when the page would move badly in
// the original. Without ffmpeg the video is kept, unread; without the engine or a model it has no transcript; without
// Claude its key frames are the strongest candidates
export async function processVideo(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  o: VideoWork,
): Promise<VideoOutcome> {
  const out: VideoOutcome = { warnings: [], claude: false, costUsd: 0 };
  if (!installedFfmpeg()) {
    out.warnings.push(
      `${f.name}: ffmpeg is not on this PC, so the video is kept but not read (no transcript, no frames). Install it in Settings › Models › Transcription (or: testimus models pullFfmpeg), then convert the document again.`,
    );
    return out;
  }
  const root = docDir(project, docId);
  const src = join(root, f.file);
  const dir = videoDir(project, docId, f.n);
  const p = readProject(project);
  // ponytail: a key frame somebody asked for (media.keep) is theirs — sources may cite it, so starting over keeps it
  const asked = (readVideo(project, docId, f.n)?.keyFrames ?? []).filter((k) => k.asked);
  let v = o.force ? null : readVideo(project, docId, f.n);
  const save = (next: VideoData) => {
    v = next;
    writeVideo(project, docId, f.n, next);
  };
  const now = () => v as VideoData;
  try {
    if (!v) {
      ctx.progress({ message: `Reading ${f.name}` });
      const probe = await videoIo.probe(src, ctx.signal);
      save({
        ...empty(probe.duration, probe.audio),
        ...(probe.width ? { width: probe.width, height: probe.height } : {}),
        ...(probe.tracks.length ? { tracks: probe.tracks } : {}),
        ...(probe.hdr ? { hdr: true } : {}),
        ...(probe.codec ? { codec: probe.codec } : {}),
        ...(probe.keyEvery !== undefined ? { keyEvery: probe.keyEvery } : {}),
        bytes: probe.bytes,
      });
      updateFile(project, docId, f.n, (x) => {
        x.duration = probe.duration;
        if (probe.width) Object.assign(x, { width: probe.width, height: probe.height });
        x.state = "ready";
        delete x.error;
      });
      writeMediaMd(project, docId);
    }
    if (now().audio && (o.again || !now().transcribed || now().transcribed?.pieces))
      await hear(ctx, project, docId, f, o, save, now, out);
    const lines = () => spokenLines(now(), readFixes(project, docId, f.n));
    const long = now().duration > WHOLE_S;
    const plan = async () => {
      const chapters = await planChapters(ctx, project, docId, f, now(), lines(), o.run, out);
      if (chapters) save({ ...now(), chapters, planned: stamp(o.run) });
    };
    // ponytail: Claude works on what is said (its translation, the chapters of a long video) while this PC looks
    // through the pictures — neither waits for the other
    const words = async () => {
      if (o.claude && p.video?.translate !== false) await translate(ctx, project, docId, f, o, save, now, out);
      if (o.claude && long && !now().planned && lines().length) {
        await plan();
        writeMediaMd(project, docId);
      }
    };
    const look = async () => {
      if (
        now().candidates.length &&
        !(o.claude && !now().surveyed && now().candidates.some((c) => !existsSync(join(root, c.file))))
      )
        return;
      const found = await findCandidates(ctx, project, docId, f, now(), lines());
      save({ ...now(), ...found });
    };
    await Promise.all([words(), look()]);
    if (o.claude && long && !now().planned && now().candidates.length) await plan();

    const chosen = now().keyFrames.some((k) => !k.asked);
    if ((!chosen || (o.claude && !now().surveyed)) && now().candidates.length) {
      const picked = await chooseMoments(
        ctx,
        project,
        docId,
        f,
        now(),
        lines(),
        { ...o, density: p.video?.density, chapters: !now().planned },
        out,
      );
      save({
        ...now(),
        ...(picked.chapters ? { chapters: picked.chapters, planned: stamp(o.run) } : {}),
        keyFrames: keyMoments([...now().keyFrames.filter((k) => k.asked), ...asked, ...picked.moments], now().duration),
        ...(picked.surveyed ? { surveyed: stamp(o.run) } : {}),
      });
    }
    if (o.claude && !long && !now().planned && (lines().length || now().candidates.length)) await plan();
    save({ ...now(), keyFrames: await drawKeyFrames(ctx, project, docId, f, now(), readFixes(project, docId, f.n)) });
    if (now().surveyed) dropSurveyFiles(project, docId, f.n);
    if ((now().keyEvery ?? 0) > KEY_EVERY_S && !now().light)
      await lighten(ctx, project, docId, f, "its key frames are too far apart to move in it");
    rmSync(join(dir, "piece.wav"), { force: true });
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

async function hear(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  o: VideoWork,
  save: (v: VideoData) => void,
  now: () => VideoData,
  out: VideoOutcome,
): Promise<void> {
  const setup = speechSetup(await machineProfile().catch(() => null));
  if ("missing" in setup) {
    if (!now().transcribed)
      out.warnings.push(
        setup.missing === "engine"
          ? `${f.name}: the transcription engine is not on this PC, so the video has no transcript. Install it in Settings › Models › Transcription (or: testimus models pullWhisper), then convert the document again.`
          : `${f.name}: no transcription model is on this PC, so the video has no transcript. Install one in Settings › Models › Transcription (or: testimus models pull whisper-large-v3-turbo-q8), then convert the document again.`,
      );
    return;
  }
  const p = readProject(project);
  const glossary = speechGlossary(project);
  const spoken = (f.spoken ?? p.video?.spoken ?? []).map((l) => l.toLowerCase());
  const was = now().transcribed && !now().transcribed?.pieces ? now().transcript : null;
  const facts = (r: { pieces: { done: number; total: number } | null; languages?: Record<string, number> }) => ({
    with: setup.entry.label,
    at: env.now().toISOString(),
    model: setup.entry.id,
    engine: setup.engine,
    device: setup.gpu ? ("gpu" as const) : ("cpu" as const),
    spoken,
    glossary: glossary.hash,
    ...(r.languages ? { languages: r.languages } : {}),
    ...(r.pieces ? { pieces: r.pieces } : {}),
  });
  const heard = await transcribe(ctx, {
    src: join(docDir(project, docId), f.file),
    dir: videoDir(project, docId, f.n),
    file: f,
    duration: now().duration,
    tracks: now().tracks?.length ?? 1,
    spoken,
    glossary,
    setup,
    force: o.force,
    onPiece: (lines, done, total) => {
      if (done >= total) return;
      save({
        ...now(),
        transcript: keepTranslations(lines, now().transcript),
        transcribed: facts({ pieces: { done, total } }),
      });
      writeMediaMd(project, docId);
    },
  });
  const made = now().transcribed;
  const before = was?.length && made && heard.fresh ? { transcript: was, with: made.with, at: made.at } : null;
  save({
    ...now(),
    transcript: keepTranslations(heard.lines, was ?? now().transcript),
    transcribed: { ...facts({ pieces: null, languages: heard.languages }), tookMs: heard.tookMs },
    ...(before ? { before: now().before ?? before } : {}),
  });
  writeMediaMd(project, docId);
  if (before) buildReport(project, docId, f.n);
  if (!heard.lines.length) ctx.log("info", `${f.name}: no speech was found in ${clock(now().duration)} of sound.`);
}

// ponytail: a line heard again with the same words keeps the translation it had
function keepTranslations(lines: SpokenLine[], before: SpokenLine[]): SpokenLine[] {
  const had = new Map(
    before.filter((l) => l.translation).map((l) => [`${Math.floor(l.at)}\n${l.text}`, l.translation]),
  );
  return lines.map((l) => {
    const t = had.get(`${Math.floor(l.at)}\n${l.text}`);
    return t ? { ...l, translation: t } : l;
  });
}

// ponytail: what was said in another language than the project's is translated by Claude, a batch a run; the line
// stays the quotable text, its translation is shown and searched beside it
async function translate(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  o: VideoWork,
  save: (v: VideoData) => void,
  now: () => VideoData,
  out: VideoOutcome,
): Promise<void> {
  const into = readProject(project).language.toLowerCase().slice(0, 2);
  const todo = now().transcript.filter((l) => l.lang && l.lang !== into && !l.translation && l.text.trim());
  if (!todo.length) return;
  try {
    const r = await translateLines(project, docId, ctx, { name: f.name }, todo, o.run, now().transcript);

    out.claude = true;
    out.costUsd += r.costUsd;
    if (!r.translated.size) return;
    save({
      ...now(),
      transcript: now().transcript.map((l) => {
        const t = r.translated.get(l.at);
        return t ? { ...l, translation: t } : l;
      }),
      translated: { at: env.now().toISOString(), into, ...(o.run.model ? { model: o.run.model } : {}) },
    });
    writeMediaMd(project, docId);
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    out.warnings.push(`${f.name}: Claude did not translate what is said (${message(e)}).`);
  }
}

// ponytail: a copy the page plays and moves in at once (H.264 720p, a key frame every 2 s) — made when the original's
// key frames are too far apart, or when the page says it cannot play it (an iPhone's HEVC on a PC whose card does not
// decode it); the original stays the source of every frame
export async function lighten(ctx: Ctx, project: string, docId: string, f: MediaFile, why: string): Promise<string> {
  const v = readVideo(project, docId, f.n);
  const file = lightFile(f.n);
  const root = docDir(project, docId);
  await videoIo.light(
    join(root, f.file),
    join(root, file),
    { hdr: !!v?.hdr },
    (s) =>
      ctx.progress({
        message: `Making a lighter copy of ${f.name}`,
        done: Math.round(s),
        total: Math.round(v?.duration ?? f.duration ?? 0),
      }),
    ctx.signal,
  );
  const cur = readVideo(project, docId, f.n);
  if (cur) writeVideo(project, docId, f.n, { ...cur, light: { file, at: env.now().toISOString(), why } });
  return file;
}

// ponytail: what goes with a key frame when Claude describes it — the part of the video it is in, what is said in the
// ten seconds around it, and the frame before it (its description when another run read it): the description then
// says what the operator does and what changed, the very matter of a step and its expected result
export function frameContext(project: string, docId: string): (anchor: string, before: string | undefined) => string[] {
  const doc = readDoc(project, docId);
  const byAnchor = new Map<string, { v: VideoData; at: number; n: number }>();
  for (const f of filesOf(doc).filter((x) => x.kind === "video")) {
    const v = readVideo(project, docId, f.n);
    for (const k of v?.keyFrames ?? []) if (v) byAnchor.set(frameAnchor(f.n, k.at), { v, at: k.at, n: f.n });
  }
  return (anchor, before) => {
    const hit = byAnchor.get(anchor);
    if (!hit) return [];
    const lines = spokenLines(hit.v, readFixes(project, docId, hit.n));
    const chapter = hit.v.chapters.findLast((c) => c.at <= hit.at);
    const said = lines.filter((l) => l.end >= hit.at - 10 && l.at <= hit.at + 10);
    return [
      ...(chapter ? [`part: ${chapter.title}`] : []),
      ...(said.length ? [`said around it: ${said.map((l) => `[${clock(l.at)}] ${l.text}`).join(" ")}`] : []),
      ...(before ? [`the frame before it: ${before}`] : []),
    ];
  };
}

export const fixedFrames = (project: string, docId: string): Set<string> => {
  const out = new Set<string>();
  for (const f of filesOf(readDoc(project, docId)).filter((x) => x.kind === "video"))
    for (const x of readFixes(project, docId, f.n).frames) out.add(frameAnchor(f.n, x.second));
  return out;
};

// ponytail: what docs.show and media.show say of a video — its facts, chapters, key frames; the transcript is read
// apart (media.transcript), it can be long
export function videoSummary(project: string, docId: string, f: MediaFile) {
  const v = readVideo(project, docId, f.n);
  const figures = new Map(readFigures(project, docId).map((e) => [e.anchor, e]));
  const fixes = readFixes(project, docId, f.n);
  const lines = v ? spokenLines(v, fixes) : [];
  const root = docDir(project, docId);
  const has = (file: string) => existsSync(join(root, file));
  return {
    n: f.n,
    name: f.name,
    file: f.file,
    duration: v?.duration ?? f.duration ?? 0,
    transcribed: !!v?.transcribed,
    lines: lines.length,
    unsure: lines.filter((l) => l.unsure && l.by !== "human").length,
    fixed: fixes.lines.length,
    audio: v?.audio ?? true,
    tracks: v?.tracks ?? [],
    ...(f.track !== undefined ? { track: f.track } : {}),
    ...(f.spoken ? { spoken: f.spoken } : {}),
    ...(f.range ? { range: f.range } : {}),
    ...(v?.transcribed?.with ? { with: v.transcribed.with } : {}),
    ...(v?.transcribed?.device ? { device: v.transcribed.device } : {}),
    ...(v?.transcribed?.pieces ? { pieces: v.transcribed.pieces } : {}),
    languages: v?.transcribed?.languages ?? {},
    ...(v?.light && has(v.light.file) ? { light: v.light.file } : {}),
    ...(v?.codec ? { codec: v.codec } : {}),
    subtitles: {
      ...(has(`video/${f.n}/said.vtt`) ? { said: `video/${f.n}/said.vtt` } : {}),
      ...(has(`video/${f.n}/translated.vtt`) ? { translated: `video/${f.n}/translated.vtt` } : {}),
      ...(has(`video/${f.n}/chapters.vtt`) ? { chapters: `video/${f.n}/chapters.vtt` } : {}),
    },
    report: !!v?.before,
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
          fixed: fixes.frames.some((x) => x.second === Math.floor(k.at)),
        };
      }),
  };
}

export const hasVideo = (project: string, docId: string) =>
  (readDoc(project, docId).source.files ?? []).some((f) => f.kind === "video");
