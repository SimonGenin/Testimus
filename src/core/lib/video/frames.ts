import { readFileSync } from "node:fs";
import { clock } from "../../rag/anchors.ts";
import type { SpokenLine, VideoDensity } from "../../types.ts";
import { writeAtomic } from "../atomic.ts";
import { SCAN_FPS } from "./io.ts";

export const MOSAIC_SIDE = 3;
const TILE_W = 480;
const TILE_H = 270;
const MAX_SIDE = 2000;
const STILL_S = 0.5;
const LONG_STILL_S = 10;
const SHAKY = 0.6;
export const MAX_CANDIDATES = 600;
const GRID_W = 16;
const GRID_H = 9;
const CELL = 20;
const PIXEL_MOVED = 32;
const CHANGED_PIXELS = 16;
const CROP_MIN = 320;
const CROP_MAX = 1400;

const sharpOf = async () => (await import("sharp")).default;

export type Box = [x: number, y: number, w: number, h: number];
export type Candidate = { at: number; why: "screen" | "before" | "said" | "regular" };

const rank = (at: number) => Math.round(at * SCAN_FPS);
export const rankOf = rank;

// ponytail: a video nobody holds still (a cabin, a desk filmed by hand) never settles — most of its frames differ
// from the one before
export function isShaky(changes: number[], duration: number): boolean {
  return duration > 0 && changes.length / (duration * SCAN_FPS) > SHAKY;
}

// ponytail: words that say a thing is about to be done or seen, in the languages the team films in
const CUES =
  /\b(on clique|je clique|cliquez|vous voyez|on voit|regardez|alarme|valid(?:e|er|ez)|on appuie|appuyez|s[ée]lectionne[zr]?|on ouvre|click|you (?:can )?see|look at|alarm|confirm|press|select|open|klick(?:en|t)?|sehen sie|schauen|alarm|best[äa]tig(?:en|t)|dr[üu]ck(?:en|t)|w[äa]hl(?:en|t))\b/i;

// ponytail: the floor of regular frames — every 5 s for a short video, further apart for a long one
const stepOf = (duration: number) => (duration <= 600 ? 5 : Math.min(30, Math.round(duration / 120)));

// ponytail: the moments worth a frame, from cheap signals over the whole video. A screen recording is a run of
// settled screens between changes: a frame is taken once a change is over (nothing moved for half a second — a menu
// is caught open, not opening; a cursor on its way is skipped without being recognised), and again just before the
// next change when the screen stayed long (the form as it was when « Validate » was clicked). To these are added the
// moments the speech points at and a regular floor. Past 600 the weakest go first — the floor, then the speech's,
// never an even thinning that would lose a short event
export function candidatesOf(o: {
  changes: number[];
  duration: number;
  said: Pick<SpokenLine, "at" | "text">[];
  cap?: number;
}): Candidate[] {
  const shaky = isShaky(o.changes, o.duration);
  const byRank = new Map<number, Candidate>();
  const strength = { screen: 4, before: 3, said: 2, regular: 1 };
  const add = (at: number, why: Candidate["why"]) => {
    if (at < 0 || (o.duration && at > o.duration)) return;
    const r = rank(at);
    const had = byRank.get(r);
    if (!had || strength[why] > strength[had.why]) byRank.set(r, { at: r / SCAN_FPS, why });
  };
  if (!shaky)
    o.changes.forEach((t, i) => {
      const next = o.changes[i + 1] ?? o.duration;
      if (next - t < STILL_S) return;
      add(t, "screen");
      if (next - t >= LONG_STILL_S && i + 1 < o.changes.length) add(next - 1 / SCAN_FPS, "before");
    });
  for (const l of o.said) {
    add(l.at, "said");
    if (CUES.test(l.text)) add(l.at + 2, "said");
  }
  const step = stepOf(o.duration);
  for (let t = 0; t < o.duration; t += step) add(t, "regular");
  let out = [...byRank.values()].sort((a, b) => a.at - b.at);
  const cap = o.cap ?? MAX_CANDIDATES;
  for (const weakest of ["regular", "said", "before"] as const) {
    if (out.length <= cap) break;
    const over = out.length - cap;
    const weak = out.filter((c) => c.why === weakest);
    const drop = new Set(weak.filter((_, i) => i % Math.max(1, Math.floor(weak.length / over)) === 0).slice(0, over));
    out = out.filter((c) => !drop.has(c));
  }
  if (out.length > cap) {
    const slice = o.duration / cap;
    const seen = new Set<number>();
    out = out.filter((c) => {
      const k = Math.floor(c.at / slice);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}

export async function grid(file: string): Promise<Buffer> {
  const sharp = await sharpOf();
  return sharp(readFileSync(file))
    .removeAlpha()
    .resize(GRID_W * CELL, GRID_H * CELL, { fit: "fill" })
    .raw()
    .toBuffer();
}

// ponytail: where two frames differ, cell by cell on a 16 × 9 grid of 320 × 180 pixels in colour — a whole-picture
// hash misses a pictogram that changes colour or a message in a corner (a 40 px alarm on a 1280 px screen is invisible
// to it), a grid sees it and says where. A pixel changed when one of its colours moved by more than an eighth (what
// compression never does to a still screen), a cell when 16 of its 400 pixels did — a 40 px alarm is a hundred of
// them, a mouse pointer about ten: the pointer that moved between two screens is not a change. Null when no cell
// changed: the same screen
export function changedBox(a: Buffer, b: Buffer): Box | null {
  let x0 = GRID_W;
  let y0 = GRID_H;
  let x1 = -1;
  let y1 = -1;
  const width = GRID_W * CELL;
  for (let cy = 0; cy < GRID_H; cy++)
    for (let cx = 0; cx < GRID_W; cx++) {
      let moved = 0;
      for (let y = 0; y < CELL && moved < CHANGED_PIXELS; y++) {
        const row = ((cy * CELL + y) * width + cx * CELL) * 3;
        for (let x = 0; x < CELL * 3; x += 3)
          if (
            Math.abs(a[row + x] - b[row + x]) > PIXEL_MOVED ||
            Math.abs(a[row + x + 1] - b[row + x + 1]) > PIXEL_MOVED ||
            Math.abs(a[row + x + 2] - b[row + x + 2]) > PIXEL_MOVED
          )
            moved++;
      }
      if (moved < CHANGED_PIXELS) continue;
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
    }
  if (x1 < 0) return null;
  return [x0 / GRID_W, y0 / GRID_H, (x1 - x0 + 1) / GRID_W, (y1 - y0 + 1) / GRID_H];
}

// ponytail: of the frames drawn, in time order, one that shows the screen of the frame kept before it goes; one that
// differs keeps where it changed, so Claude is shown that place at its real size
export async function distinct<T extends { file: string }>(frames: T[]): Promise<(T & { box?: Box })[]> {
  const kept: (T & { box?: Box })[] = [];
  let last: Buffer | null = null;
  for (const f of frames) {
    const g = await grid(f.file);
    const box = last ? changedBox(last, g) : undefined;
    if (box === null) continue;
    kept.push({ ...f, ...(box ? { box } : {}) });
    last = g;
  }
  return kept;
}

// ponytail: how sharp a frame is — the spread of its edges (a Laplacian); of the frames around a moment of a video
// filmed by hand, the sharpest is kept, never the one blurred by the move
export async function sharpness(file: string): Promise<number> {
  const sharp = await sharpOf();
  const s = await sharp(readFileSync(file))
    .greyscale()
    .resize(320, 180, { fit: "fill" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .stats();
  return s.channels[0]?.stdev ?? 0;
}

// ponytail: the place that changed, at the size it was filmed, with some room around it — no mosaic makes a screen
// readable (1920 px drawn on 480 are no more read than on 320): a mosaic shows that something happens and where, the
// crop is where Claude reads the alarm's message or the button's label without asking for the whole frame
export async function crop(file: string, box: Box, out: string): Promise<{ width: number; height: number } | null> {
  const sharp = await sharpOf();
  const input = readFileSync(file);
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return null;
  if (box[2] * box[3] > 0.6) return null;
  const w = Math.min(W, Math.max(CROP_MIN, Math.round(box[2] * W * 1.3)));
  const h = Math.min(H, Math.max(Math.round(CROP_MIN * 0.5625), Math.round(box[3] * H * 1.3)));
  const cx = (box[0] + box[2] / 2) * W;
  const cy = (box[1] + box[3] / 2) * H;
  const left = Math.max(0, Math.min(W - w, Math.round(cx - w / 2)));
  const top = Math.max(0, Math.min(H - h, Math.round(cy - h / 2)));
  const r = await sharp(input)
    .extract({ left, top, width: w, height: h })
    .resize({ width: CROP_MAX, height: CROP_MAX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  writeAtomic(out, r.data);
  return { width: r.info.width, height: r.info.height };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ponytail: a mosaic is 3 × 3 frames in time order, each with its number and moment in its corner, 1440 px wide — under
// the size past which a picture is made smaller before Claude sees it; a place that changed is framed
export async function mosaic(
  frames: { at: number; file: string; box?: Box }[],
  out: string,
  first: number,
): Promise<void> {
  const sharp = await sharpOf();
  const tiles = await Promise.all(
    frames.map((f) =>
      sharp(readFileSync(f.file)).resize(TILE_W, TILE_H, { fit: "contain", background: "#000000" }).jpeg().toBuffer(),
    ),
  );
  const labels = frames
    .map((f, i) => {
      const x = (i % MOSAIC_SIDE) * TILE_W;
      const y = Math.floor(i / MOSAIC_SIDE) * TILE_H;
      const text = esc(`${first + i} · ${clock(f.at)}`);
      const frame = f.box
        ? `<rect x="${x + Math.round(f.box[0] * TILE_W)}" y="${y + Math.round(f.box[1] * TILE_H)}" width="${Math.round(f.box[2] * TILE_W)}" height="${Math.round(f.box[3] * TILE_H)}" fill="none" stroke="#ff3b30" stroke-width="3"/>`
        : "";
      return `${frame}<rect x="${x}" y="${y}" width="124" height="26" fill="#000000" fill-opacity="0.75"/><text x="${x + 6}" y="${y + 19}" font-family="sans-serif" font-size="16" fill="#ffffff">${text}</text>`;
    })
    .join("");
  const width = TILE_W * MOSAIC_SIDE;
  const height = TILE_H * Math.ceil(frames.length / MOSAIC_SIDE);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`,
  );
  const data = await sharp({ create: { width, height, channels: 3, background: "#202020" } })
    .composite([
      ...tiles.map((input, i) => ({
        input,
        left: (i % MOSAIC_SIDE) * TILE_W,
        top: Math.floor(i / MOSAIC_SIDE) * TILE_H,
      })),
      { input: svg, left: 0, top: 0 },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();
  writeAtomic(out, data);
}

// ponytail: a key frame as Claude and the tester see it, like a photo — a JPEG of at most 2000 px a side
export async function normalizeFrame(src: string, out: string): Promise<{ width: number; height: number }> {
  const sharp = await sharpOf();
  const r = await sharp(readFileSync(src))
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  writeAtomic(out, r.data);
  return { width: r.info.width, height: r.info.height };
}

const DENSITY: Record<VideoDensity, number> = { sober: 0.5, normal: 1, detailed: 1.6 };
export const MAX_KEY_FRAMES = 150;

// ponytail: how many key frames a video is worth — about 40 a half-hour (twenty before, whatever the length, lost most
// of a long video), fewer or more with the project's density, never more than 150 nor than there are candidates
export function keyFrameBudget(
  duration: number,
  density: VideoDensity = "normal",
  candidates = MAX_KEY_FRAMES,
): number {
  const wanted = Math.round((40 * duration * DENSITY[density]) / 1800);
  return Math.max(1, Math.min(MAX_KEY_FRAMES, candidates, Math.max(Math.round(8 * DENSITY[density]), wanted)));
}
