import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { scope } from "../../shared/run/work.ts";
import { encodePng, unpackGray1 } from "./convert-png.ts";

const require = createRequire(import.meta.url);
const ROOT = dirname(require.resolve("pdfjs-dist/package.json"));

export const PDFJS = `pdfjs-dist ${(require("pdfjs-dist/package.json") as { version: string }).version}`;

function openPdf(buf: Uint8Array): { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> } {
  return getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    standardFontDataUrl: `${join(ROOT, "standard_fonts")}/`,
    cMapUrl: `${join(ROOT, "cmaps")}/`,
    verbosity: 0,
  } as Parameters<typeof getDocument>[0]);
}

// ponytail: a pdf.js document is opened inside a scope, so it is released however the work ends (a result, an error,
// a cancel) — even when the file cannot be read at all
export function withPdf<T>(buf: Uint8Array, work: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
  return scope(async (s) => {
    const loading = openPdf(buf);
    s.defer(() => loading.destroy());
    return work(await loading.promise);
  });
}

export type Matrix = [number, number, number, number, number, number];
export const mul = (m: Matrix, n: number[]): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

type ImgData = { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray };

export function toPng(img: ImgData | null): Uint8Array | null {
  if (!img?.data || !img.width || !img.height) return null;
  const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  if (img.kind === 1) return encodePng(img.width, img.height, 1, unpackGray1(img.width, img.height, data));
  if (img.kind === 2) return encodePng(img.width, img.height, 3, data);
  if (img.kind === 3) return encodePng(img.width, img.height, 4, data);
  return null;
}

export function imageOf(page: PDFPageProxy, id: string): Promise<ImgData | null> {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      store.get(id, (v: ImgData) => resolve(v));
    } catch {
      resolve(null);
    }
  });
}

type Canvas = {
  canvas: { width: number; height: number; toBuffer(mime: string): Uint8Array };
  context: {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  };
};

type Box = [number, number, number, number];
type Factory = { create(w: number, h: number): Canvas; destroy(c: Canvas): void };

async function paint<T>(
  doc: PDFDocumentProxy,
  page: PDFPageProxy,
  box: Box,
  scale: number,
  read: (c: Canvas, ink: (x: number, y: number) => boolean, w: number, h: number) => T,
): Promise<T | null> {
  const [x0, , x1, y1] = box;
  const w = Math.ceil((x1 - x0) * scale);
  const h = Math.ceil((box[3] - box[1]) * scale);
  if (w < 4 || h < 4) return null;
  try {
    const factory = doc.canvasFactory as Factory;
    const c = factory.create(w, h);
    c.context.fillStyle = "#ffffff";
    c.context.fillRect(0, 0, w, h);
    await page.render({
      canvasContext: c.context,
      canvas: c.canvas,
      viewport: page.getViewport({ scale }),
      transform: [1, 0, 0, 1, -(x0 - page.view[0]) * scale, -(page.view[3] - y1) * scale],
    } as unknown as Parameters<PDFPageProxy["render"]>[0]).promise;
    const px = c.context.getImageData(0, 0, w, h).data;
    const ink = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235;
    };
    const out = read(c, ink, w, h);
    factory.destroy(c);
    return out;
  } catch {
    return null;
  }
}

// ponytail: a region of the page as the reader sees it — vector drawings, pictures and their labels together;
// null when nothing is drawn there (a blank region) or the canvas is not available
export async function shoot(doc: PDFDocumentProxy, page: PDFPageProxy, box: Box): Promise<Uint8Array | null> {
  const scale = Math.min(2, 2400 / Math.max(1, box[2] - box[0]));
  return paint(doc, page, box, scale, (c, ink, w, h) => {
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) n++;
    return n > (w * h) / 200 ? new Uint8Array(c.canvas.toBuffer("image/png")) : null;
  }).then((png) => png ?? null);
}

// ponytail: a page, or a region of it given as fractions of the page from its top left, drawn whole for Claude
// to look at — blank or not; the width is kept near 1600 pixels so small print stays readable
export async function renderPage(
  buf: Uint8Array,
  n: number,
  region: [number, number, number, number] = [0, 0, 1, 1],
): Promise<{ png: Uint8Array; width: number; height: number; pages: number }> {
  return withPdf(buf, async (doc) => {
    if (n < 1 || n > doc.numPages) throw new RangeError(`Page ${n} is outside 1–${doc.numPages}.`);
    const page = await doc.getPage(n);
    const [vx0, vy0, vx1, vy1] = page.view;
    const [l, t, r, b] = region.map((v) => Math.min(1, Math.max(0, v)));
    const box: Box = [vx0 + l * (vx1 - vx0), vy1 - b * (vy1 - vy0), vx0 + r * (vx1 - vx0), vy1 - t * (vy1 - vy0)];
    const scale = Math.min(6, 1600 / Math.max(1, box[2] - box[0]), 2400 / Math.max(1, box[3] - box[1]));
    const out = await paint(doc, page, box, scale, (c, _ink, w, h) => ({
      png: new Uint8Array(c.canvas.toBuffer("image/png")),
      width: w,
      height: h,
    }));
    if (!out) throw new Error(`Page ${n} could not be drawn.`);
    return { ...out, pages: doc.numPages };
  });
}

// ponytail: the block of ink resting on the bottom of the band, up to the first blank gap of 12 points
export async function inkAbove(doc: PDFDocumentProxy, page: PDFPageProxy, band: Box): Promise<Box | null> {
  const found = await paint(doc, page, band, 1, (_c, ink, w, h) => {
    const rows = Array.from({ length: h }, (_, y) => {
      let a = -1;
      let b = -1;
      for (let x = 0; x < w; x++)
        if (ink(x, y)) {
          if (a < 0) a = x;
          b = x;
        }
      return [a, b];
    });
    let y = h - 1;
    while (y >= 0 && rows[y][0] < 0) y--;
    if (y < 0) return null;
    const bottom = y;
    let gap = 0;
    let topRow = y;
    let x0 = w;
    let x1 = 0;
    for (; y >= 0 && gap < 12; y--) {
      if (rows[y][0] < 0) gap++;
      else {
        gap = 0;
        topRow = y;
        x0 = Math.min(x0, rows[y][0]);
        x1 = Math.max(x1, rows[y][1]);
      }
    }
    return [x0, topRow, x1, bottom] as Box;
  });
  if (!found) return null;
  const [x0, top, x1, bottom] = found;
  return [band[0] + x0 - 2, band[3] - bottom - 3, band[0] + x1 + 3, band[3] - top + 2];
}
