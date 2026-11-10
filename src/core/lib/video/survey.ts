import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Crop, type Mosaic, planVideo, surveyVideo } from "../../claude/media.ts";
import type { JobRun } from "../../claude/prompt.ts";
import type { Ctx } from "../../command.ts";
import { env } from "../../env.ts";
import { clock } from "../../rag/anchors.ts";
import type { FigureEntry, MediaFile, SpokenLine, VideoData, VideoDensity, VideoFixes } from "../../types.ts";
import { writeAtomic } from "../atomic.ts";
import { docDir, readFigures, writeFigures } from "../docs.ts";
import { frameAnchor, frameFigure } from "../media-md.ts";
import {
  type Box,
  candidatesOf,
  crop,
  distinct,
  isShaky,
  keyFrameBudget,
  MOSAIC_SIDE,
  mosaic,
  normalizeFrame,
  rankOf,
  sharpness,
} from "./frames.ts";
import { SCAN_FPS, videoIo } from "./io.ts";

const TILES = MOSAIC_SIDE * MOSAIC_SIDE;
const PART_MOSAICS = 6;
const PART_CROPS = 12;
const PLAN_TILES = TILES * 2;
const MAX_PARTS = 12;
const SLICE_S = 300;
const PART_TILES = TILES * 4;
const SAID_INLINE = 60_000;
// ponytail: a video of ten minutes or less is surveyed whole, in one Claude run that cuts it into chapters too — a
// run each (the plan, then one per chapter) cost seven runs for two minutes of video
export const WHOLE_S = 600;

// ponytail: the Claude runs planning and surveying a video are built by claude/media.ts (tests/unit/core/claude/catalog.test.ts)
export const promptsUsed = ["video-plan", "video-survey"];

type Cand = VideoData["candidates"][number];
export type Outcome = { warnings: string[]; claude: boolean; costUsd: number };
export type Part = { title: string; from: number; to: number };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rel = (root: string, file: string) => file.slice(root.length + 1).replace(/\\/g, "/");

function spread<T>(xs: T[], most: number): T[] {
  if (xs.length <= most) return xs;
  return Array.from({ length: most }, (_, i) => xs[Math.floor((i * xs.length) / most)]);
}

// ponytail: the strongest candidates of a stretch, never an even thinning — a settled screen first, then the frame
// before a change, the moments the speech points at, the regular floor; evenly along the stretch within each
export function strongest(cands: Cand[], most: number): Cand[] {
  if (cands.length <= most) return cands;
  const out: Cand[] = [];
  for (const why of ["screen", "before", "said", "regular"]) {
    const room = most - out.length;
    if (room <= 0) break;
    out.push(
      ...spread(
        cands.filter((c) => (c.why ?? "regular") === why),
        room,
      ),
    );
  }
  return out.sort((a, b) => a.at - b.at);
}

// ponytail: the candidate frames of a video — a light pass says when the screen changes somewhere, the moments are
// chosen (frames.ts), drawn in one reading of the video, and those showing the same screen as the one before are
// dropped. A video filmed by hand never settles: there the sharpest of the frames around each moment is kept
export async function findCandidates(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  v: VideoData,
  said: SpokenLine[],
): Promise<Pick<VideoData, "candidates" | "shaky">> {
  const root = docDir(project, docId);
  const src = join(root, f.file);
  const dir = join(root, "video", String(f.n), "frames");
  const pct = (part: number) => (s: number) =>
    ctx.progress({
      message: `Looking through ${f.name}`,
      done: Math.min(100, Math.round(part * 50 + (v.duration ? (s / v.duration) * 50 : 0))),
      total: 100,
    });
  const changes = await videoIo.changes(src, pct(0), ctx.signal);
  const shaky = isShaky(changes, v.duration);
  const cands = candidatesOf({ changes, duration: v.duration, said });
  const why = new Map(cands.map((c) => [rankOf(c.at), c.why]));
  const last = Math.max(0, Math.floor(v.duration * SCAN_FPS) - 1);
  const around = (r: number) => (shaky ? [r - 1, r, r + 1] : [r]).filter((x) => x >= 0 && x <= last);
  const shots = await videoIo.shots(
    src,
    dir,
    cands.flatMap((c) => around(Math.min(last, rankOf(c.at)))),
    { hdr: !!v.hdr },
    pct(1),
    ctx.signal,
  );
  let picked = shots;
  if (shaky) {
    const best = new Map<number, { shot: (typeof shots)[number]; sharp: number }>();
    for (const s of shots) {
      const r = rankOf(s.at);
      const home = [r, r - 1, r + 1].find((x) => why.has(x)) ?? r;
      const sharp = await sharpness(s.file);
      const had = best.get(home);
      if (!had || sharp > had.sharp) best.set(home, { shot: s, sharp });
    }
    picked = [...best.values()].map((b) => b.shot).sort((a, b) => a.at - b.at);
  }
  const kept = await distinct(picked);
  const keep = new Set(kept.map((k) => k.file));
  for (const s of shots) if (!keep.has(s.file)) rmSync(s.file, { force: true });
  return {
    candidates: kept.map((c) => {
      const r = rankOf(c.at);
      const reason = why.get(r) ?? why.get(r - 1) ?? why.get(r + 1);
      return {
        at: c.at,
        file: rel(root, c.file),
        ...(c.box ? { box: c.box } : {}),
        ...(reason ? { why: reason } : {}),
      };
    }),
    ...(shaky ? { shaky: true } : {}),
  };
}

export const saidFile = (n: number) => `video/${n}/said.txt`;

const saidText = (lines: SpokenLine[]) =>
  lines.map((l) => `[${clock(l.at)}] ${l.text}${l.lang ? ` (${l.lang})` : ""}`).join("\n");

// ponytail: what is said goes in the prompt itself (a file to Read is one more turn, the whole conversation sent
// again); only hours of speech are left in a file
function writeSaid(root: string, n: number, text: string): string {
  writeAtomic(join(root, saidFile(n)), `${text}\n`);
  return saidFile(n);
}

async function mosaics(root: string, n: number, name: string, cands: Cand[], first = 1): Promise<Mosaic[]> {
  const out: Mosaic[] = [];
  for (let i = 0; i < cands.length; i += TILES) {
    const part = cands.slice(i, i + TILES);
    const file = `video/${n}/${name}-${out.length + 1}.jpg`;
    await mosaic(
      part.map((c) => ({ at: c.at, file: join(root, c.file), ...(c.box ? { box: c.box as Box } : {}) })),
      join(root, file),
      first + i,
    );
    out.push({ file, tiles: part.map((c, k) => ({ n: first + i + k, at: c.at })) });
  }
  return out;
}

// ponytail: the chapters, from all that is said when something is said (no picture is needed for that: they come
// before the frames are even looked for), else from a few frames spread along the video
export async function planChapters(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  v: VideoData,
  lines: SpokenLine[],
  run: JobRun,
  out: Outcome,
): Promise<VideoData["chapters"] | null> {
  const root = docDir(project, docId);
  const text = saidText(lines);
  const said = text.length > SAID_INLINE ? writeSaid(root, f.n, text) : undefined;
  const present = v.candidates.filter((c) => existsSync(join(root, c.file)));
  if (!text && !present.length) return null;
  try {
    const sparse = text ? [] : await mosaics(root, f.n, "plan", spread(present, PLAN_TILES));
    const r = await planVideo(
      project,
      docId,
      ctx,
      { name: f.name, duration: v.duration, n: f.n },
      { ...(said ? { said } : text ? { text } : {}), mosaics: sparse },
      run,
    );
    out.claude = true;
    out.costUsd += r.costUsd;
    return r.chapters?.filter((c) => c.at <= v.duration) ?? null;
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    out.warnings.push(`${f.name}: Claude did not plan the video (${message(e)}).`);
    return null;
  }
}

const join2 = (a: Part, b: Part): Part => ({ title: `${a.title} · ${b.title}`, from: a.from, to: b.to });

// ponytail: the parts a video is surveyed in, a Claude run each — its chapters, else slices of five minutes; chapters
// that follow each other share a run while their candidate frames fit four mosaics (a run for a chapter where the
// screen barely moves costs as much as any other), and are joined two by two while there are more than twelve
export function partsOf(chapters: VideoData["chapters"], duration: number, candidates: { at: number }[] = []): Part[] {
  const cut: Part[] = chapters.length
    ? chapters.map((c, i) => ({ title: c.title, from: c.at, to: chapters[i + 1]?.at ?? duration }))
    : Array.from({ length: Math.max(1, Math.ceil(duration / SLICE_S)) }, (_, i) => {
        const from = i * SLICE_S;
        const to = Math.min(duration, from + SLICE_S);
        return { title: `${clock(from)} – ${clock(to)}`, from, to };
      });
  const shown = (p: Part) => candidates.filter((c) => c.at >= p.from && c.at < p.to).length;
  let parts: Part[] = [];
  for (const p of cut) {
    const last = parts.at(-1);
    if (last && candidates.length && shown(last) + shown(p) <= PART_TILES) parts[parts.length - 1] = join2(last, p);
    else parts.push(p);
  }
  while (parts.length > MAX_PARTS) {
    const joined: Part[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const b = parts[i + 1];
      joined.push(b ? join2(parts[i], b) : parts[i]);
    }
    parts = joined;
  }
  return parts.filter((p) => p.to > p.from);
}

// ponytail: a part's share of the key frames goes with its length, two at least
export const shareOf = (part: Part, duration: number, budget: number) =>
  Math.max(2, Math.round((budget * (part.to - part.from)) / Math.max(1, duration)));

// ponytail: what Claude chooses of a video's frames, part by part — each part's candidates in mosaics, the places
// that changed at their real size, what is said meanwhile, and a share of the key frames that goes with its length.
// Without Claude, or for a part its run failed on, the strongest candidates of the part are taken instead
export async function chooseMoments(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  v: VideoData,
  lines: SpokenLine[],
  o: { claude: boolean; run: JobRun; density?: VideoDensity; chapters?: boolean },
  out: Outcome,
): Promise<{ moments: { at: number; why: string }[]; surveyed: boolean; chapters: VideoData["chapters"] | null }> {
  const root = docDir(project, docId);
  const budget = keyFrameBudget(v.duration, o.density, v.candidates.length);
  const whole = v.duration <= WHOLE_S;
  const parts: Part[] = whole
    ? [{ title: f.name, from: 0, to: v.duration }]
    : partsOf(v.chapters, v.duration, v.candidates);
  const moments: { at: number; why: string }[] = [];
  let chapters: VideoData["chapters"] | null = null;
  let surveyed = false;
  let tile = 1;
  for (const [i, part] of parts.entries()) {
    if (ctx.signal.aborted) break;
    const inPart = v.candidates.filter((c) => c.at >= part.from && c.at < part.to + (i === parts.length - 1 ? 1 : 0));
    if (!inPart.length) continue;
    const share = Math.min(whole ? budget : shareOf(part, v.duration, budget), inPart.length);
    const fallback = () => strongest(inPart, share).map((c) => ({ at: c.at, why: "" }));
    const shown = strongest(inPart, TILES * PART_MOSAICS).filter((c) => existsSync(join(root, c.file)));
    if (!o.claude || !shown.length) {
      moments.push(...fallback());
      continue;
    }
    try {
      const sheets = await mosaics(root, f.n, `mosaic-${i + 1}`, shown, tile);
      const crops: Crop[] = [];
      for (const [k, c] of shown.entries()) {
        if (!c.box || crops.length >= PART_CROPS) continue;
        const file = `video/${f.n}/change-${tile + k}.jpg`;
        if (await crop(join(root, c.file), c.box as Box, join(root, file))) crops.push({ n: tile + k, at: c.at, file });
      }
      tile += shown.length;
      const said = lines
        .filter((l) => l.at >= part.from && l.at < part.to)
        .map((l) => `[${clock(l.at)}] ${l.text}`)
        .join("\n");
      const r = await surveyVideo(
        project,
        docId,
        ctx,
        { name: f.name, duration: v.duration, n: f.n },
        {
          ...part,
          budget: share,
          said,
          ...(whole && o.chapters ? { chapters: true } : {}),
          ...(moments.length ? { kept: moments.slice(-2) } : {}),
        },
        { mosaics: sheets, crops },
        o.run,
      );
      out.claude = true;
      out.costUsd += r.costUsd;
      if (r.chapters) chapters = r.chapters.filter((c) => c.at <= v.duration);
      if (r.moments?.length) {
        moments.push(...r.moments);
        surveyed = true;
      } else moments.push(...fallback());
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      out.warnings.push(
        `${f.name}: Claude did not survey « ${part.title} » (${message(e)}); its frames taken from the signals.`,
      );
      moments.push(...fallback());
    }
  }
  return {
    moments: moments.sort((a, b) => a.at - b.at).slice(0, Math.max(budget, 1) + (whole ? 0 : parts.length * 2)),
    surveyed,
    chapters,
  };
}

// ponytail: a moment within the video, one per second — a key frame's figure and anchor are named by its whole
// second, so two moments in the same second would be one figure under two lines of doc.md
export function keyMoments<T extends { at: number }>(moments: T[], duration: number): T[] {
  const bySecond = new Map<number, T>();
  for (const m of moments) {
    const at = Math.min(Math.max(0, m.at), duration || m.at);
    if (!bySecond.has(Math.floor(at))) bySecond.set(Math.floor(at), { ...m, at });
  }
  return [...bySecond.values()].sort((a, b) => a.at - b.at);
}

// ponytail: each key frame without its picture is drawn from the video at its moment, in full (≤ 2000 px), and gets
// its figures.json entry (frame:<moment>, caption « Image at mm:ss »); one that moved away goes with its picture. What
// a person wrote of a frame (fixes) is its description, whatever Claude read
export async function drawKeyFrames(
  ctx: Ctx,
  project: string,
  docId: string,
  f: MediaFile,
  v: VideoData,
  fixes: VideoFixes,
): Promise<VideoData["keyFrames"]> {
  const dir = docDir(project, docId);
  const src = join(dir, f.file);
  const frames = [...v.keyFrames];
  for (const [i, k] of frames.entries()) {
    if (k.figure && existsSync(join(dir, k.figure))) continue;
    if (ctx.signal.aborted) break;
    ctx.progress({ message: `Taking the key frames of ${f.name}`, done: i, total: frames.length });
    const figure = frameFigure(f.n, k.at);
    const raw = join(dir, "video", String(f.n), "key.jpg");
    await videoIo.frameAt(src, k.at, raw, { hdr: !!v.hdr }, ctx.signal);
    await normalizeFrame(raw, join(dir, figure));
    rmSync(raw, { force: true });
    frames[i] = { ...k, figure };
  }
  syncFrameEntries(project, docId, f.n, frames, fixes);
  return frames;
}

const mineOf = (n: number) => new RegExp(n === 1 ? "^frame:(?!\\d+/)" : `^frame:${n}/`);

export function syncFrameEntries(
  project: string,
  docId: string,
  n: number,
  frames: VideoData["keyFrames"],
  fixes: VideoFixes,
): void {
  const dir = docDir(project, docId);
  const mine = mineOf(n);
  const all = readFigures(project, docId);
  const before = new Map(all.filter((e) => mine.test(e.anchor)).map((e) => [e.anchor, e]));
  const human = new Map(fixes.frames.map((x) => [x.second, x.text]));
  const entries: FigureEntry[] = frames
    .filter((k) => k.figure)
    .map((k) => {
      const anchor = frameAnchor(n, k.at);
      const was = before.get(anchor);
      return {
        file: k.figure as string,
        anchor,
        caption: `Image at ${clock(k.at)}`,
        description: human.get(Math.floor(k.at)) ?? was?.description ?? "",
        ...(was?.labels ? { labels: was.labels } : {}),
        kind: was?.kind ?? "screen",
      };
    });
  const keep = new Set(entries.map((e) => e.file));
  for (const e of before.values()) if (!keep.has(e.file)) rmSync(join(dir, e.file), { force: true });
  writeFigures(project, docId, [...all.filter((e) => !mine.test(e.anchor)), ...entries]);
}

// ponytail: what the survey leaves on disk is no longer read once Claude chose — the candidate frames (up to 1920 px
// each), the mosaics and the changes go; what they were is kept in video/<n>.json, and they are drawn again when a
// survey is asked for anew
export function dropSurveyFiles(project: string, docId: string, n: number): void {
  const dir = join(docDir(project, docId), "video", String(n));
  rmSync(join(dir, "frames"), { recursive: true, force: true });
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir))
    if (/^(mosaic|plan|change)-.*\.jpg$/.test(name)) rmSync(join(dir, name), { force: true });
}

export const stamp = (run: JobRun) => ({ at: env.now().toISOString(), ...(run.model ? { model: run.model } : {}) });
