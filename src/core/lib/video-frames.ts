import { readFileSync } from "node:fs";
import { clock } from "../rag/anchors.ts";
import { writeAtomic } from "./atomic.ts";

export const MOSAIC_SIDE = 4;
const TILE_W = 320;
const TILE_H = 180;
const NEAR = 6;
const MAX_SIDE = 2000;

const sharpOf = async () => (await import("sharp")).default;

// ponytail: the difference hash of a picture — 9 × 8 grey pixels, one bit per neighbour pair; two frames whose hashes
// differ in at most 6 bits show the same screen
export async function dHash(file: string): Promise<bigint> {
  const sharp = await sharpOf();
  const px = await sharp(readFileSync(file)).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return h;
}

export function distance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

// ponytail: of the candidate frames in time order, one that looks like the last frame kept is dropped — a screen that
// stays still for a minute is one frame, not twelve
export async function distinct<T extends { file: string }>(frames: T[]): Promise<T[]> {
  const kept: T[] = [];
  let last: bigint | null = null;
  for (const f of frames) {
    const h = await dHash(f.file);
    if (last !== null && distance(h, last) <= NEAR) continue;
    kept.push(f);
    last = h;
  }
  return kept;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ponytail: a mosaic is 4 × 4 frames in time order, each with its number and moment in its corner, so Claude surveys a
// whole video in a few pictures before it asks for the frames it wants to see whole
export async function mosaic(frames: { at: number; file: string }[], out: string, first: number): Promise<void> {
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
      return `<rect x="${x}" y="${y}" width="104" height="22" fill="#000000" fill-opacity="0.7"/><text x="${x + 6}" y="${y + 16}" font-family="sans-serif" font-size="14" fill="#ffffff">${text}</text>`;
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
    .jpeg({ quality: 80 })
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
