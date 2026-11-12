import { readFile } from "node:fs/promises";
import os from "node:os";
import { clock } from "../../rag/anchors.ts";
import { writeAtomic } from "../atomic.ts";
import { type Box, type Drawing, MOSAIC_SIDE, type Size, stopAt, type Tile } from "./frames-protocol.ts";

// ponytail: the picture work of Testimus, all of what sharp does — run by the frames worker (frames-worker.ts), never
// by the core (guard: sharp is imported here only, and by the mock's made-up screens)

type Sharp = typeof import("sharp").default;

let loaded: Sharp | null = null;

// ponytail: sharp is loaded once in the worker and kept modest — a quarter of the cores per picture (two pictures at
// a time, frames-protocol.ts), and no cache of pictures or open files (a frame is read once; on Windows a cached file
// stays locked)
export async function sharpOf(): Promise<Sharp> {
  if (loaded) return loaded;
  const sharp = (await import("sharp")).default;
  sharp.concurrency(Math.max(1, Math.floor(os.availableParallelism() / 4)));
  sharp.cache(false);
  loaded = sharp;
  return sharp;
}

const TILE_W = 480;
const TILE_H = 270;
const MAX_SIDE = 2000;
const GRID_W = 16;
const GRID_H = 9;
const CELL = 20;
const PIXEL_MOVED = 32;
const CHANGED_PIXELS = 16;
const CROP_MIN = 320;
const CROP_MAX = 1400;

export async function grid(file: string): Promise<Buffer> {
  const sharp = await sharpOf();
  return sharp(await readFile(file))
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
// differs keeps where it changed, so Claude is shown that place at its real size. The grids stay here: only which
// frames are kept, and where they changed, go back to the core
export async function distinct(
  files: string[],
  stop: () => boolean = () => false,
): Promise<{ i: number; box?: Box }[]> {
  const kept: { i: number; box?: Box }[] = [];
  let last: Buffer | null = null;
  for (const [i, file] of files.entries()) {
    stopAt(stop);
    const g = await grid(file);
    const box = last ? changedBox(last, g) : undefined;
    if (box === null) continue;
    kept.push({ i, ...(box ? { box } : {}) });
    last = g;
  }
  return kept;
}

// ponytail: how sharp a frame is — the spread of its edges (a Laplacian); of the frames around a moment of a video
// filmed by hand, the sharpest is kept, never the one blurred by the move
export async function sharpness(file: string): Promise<number> {
  const sharp = await sharpOf();
  const s = await sharp(await readFile(file))
    .greyscale()
    .resize(320, 180, { fit: "fill" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .stats();
  return s.channels[0]?.stdev ?? 0;
}

// ponytail: the place that changed, at the size it was filmed, with some room around it — no mosaic makes a screen
// readable (1920 px drawn on 480 are no more read than on 320): a mosaic shows that something happens and where, the
// crop is where Claude reads the alarm's message or the button's label without asking for the whole frame
export async function crop(file: string, box: Box, out: string): Promise<Size | null> {
  const sharp = await sharpOf();
  const input = await readFile(file);
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
// the size past which a picture is made smaller before Claude sees it; a place that changed is framed. Its tiles are
// drawn one after the other
export async function mosaic(
  tiles: Tile[],
  out: string,
  first: number,
  stop: () => boolean = () => false,
): Promise<void> {
  const sharp = await sharpOf();
  const drawn: Buffer[] = [];
  for (const f of tiles) {
    stopAt(stop);
    drawn.push(
      await sharp(await readFile(f.file))
        .resize(TILE_W, TILE_H, { fit: "contain", background: "#000000" })
        .jpeg()
        .toBuffer(),
    );
  }
  const labels = tiles
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
  const height = TILE_H * Math.ceil(tiles.length / MOSAIC_SIDE);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`,
  );
  const data = await sharp({ create: { width, height, channels: 3, background: "#202020" } })
    .composite([
      ...drawn.map((input, i) => ({
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
export async function normalizeFrame(src: string, out: string): Promise<Size> {
  const sharp = await sharpOf();
  const r = await sharp(await readFile(src))
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  writeAtomic(out, r.data);
  return { width: r.info.width, height: r.info.height };
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

// ponytail: the picture of an images document as Claude and the tester see it — a JPEG of at most 2000 px a side,
// turned as the camera held it (EXIF orientation), a transparent PNG laid on white; with the date it was taken
export async function preparePicture(src: string, out: string): Promise<Size & { takenAt?: string }> {
  const sharp = await sharpOf();
  const input = await readFile(src);
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const r = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  writeAtomic(out, r.data);
  const takenAt = exifDate(meta.exif);
  return { width: r.info.width, height: r.info.height, ...(takenAt ? { takenAt } : {}) };
}

export const drawing: Drawing = {
  sharpness: async ({ files }, stop) => {
    const out: number[] = [];
    for (const f of files) {
      stopAt(stop);
      out.push(await sharpness(f));
    }
    return out;
  },
  distinct: ({ files }, stop) => distinct(files, stop),
  crop: ({ file, box, out }) => crop(file, box, out),
  mosaic: async ({ tiles, out, first }, stop) => {
    await mosaic(tiles, out, first, stop);
    return null;
  },
  frame: ({ src, out }) => normalizeFrame(src, out),
  picture: ({ src, out }) => preparePicture(src, out),
};
