import { OPS, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { cleanSpaces, type HNode } from "./convert-html.ts";
import { imageOf, type Matrix, mul, toPng } from "./pdf.ts";

export type Box = [number, number, number, number];
export type Run = { text: string; box: Box; x: number; y: number; yEnd: number; end: number; size: number };
export type Pic = { mc: string; box: Box; png: Uint8Array | null; off?: boolean };
export type Entry = { number: string; norm: string; depth: number; x?: number };
export type Shot = { img: HNode; box?: Box; mcs: string[]; png?: Uint8Array | null };
type Item = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };
type Mark = { type: string; id?: string; tag?: string };

export const NUMBER_RE = /^((?:[A-Z]{1,3}\.)?\d{1,3}(?:\.\d{1,3}){0,8})\.?\s+(\S.*)$/;
export const TOC_RE = /^(?:((?:[A-Z]{1,3}\.)?\d{1,3}(?:\.\d{1,3}){0,8})\.?\s+)?(.+?)\s*(?:\.{3,}\s*)?\d{1,4}$/;
const PAINT = new Set<number>([
  OPS.fill,
  OPS.eoFill,
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
export const partsOf = (n: string) => n.replace(/^[A-Z]{1,3}\./, "").split(".").length;
export const union = (boxes: Box[]): Box | undefined =>
  boxes.length
    ? [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ]
    : undefined;
export const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
export const overlap = (a: Box, b: Box): number =>
  area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
export const text = (t: string): HNode => ({ tag: "#text", attrs: {}, children: [], text: t });
export const para = (children: HNode[], role = ""): HNode => ({ tag: "p", attrs: role ? { role } : {}, children });

export function joinRuns(runs: Run[]): string {
  let out = "";
  let prev: Run | null = null;
  for (const r of runs) {
    if (!r.text) continue;
    if (prev && out && !/\s$/.test(out) && !/^\s/.test(r.text)) {
      const sameLine = Math.abs(prev.yEnd - r.y) < Math.max(2, r.size * 0.4);
      out += sameLine && r.x - prev.end < r.size * 0.2 ? "" : " ";
    }
    out += r.text;
    prev = r;
  }
  return cleanSpaces(out);
}

export async function readRuns(page: PDFPageProxy) {
  const tc = await page.getTextContent({ includeMarkedContent: true });
  const runs = new Map<string, Run>();
  const stack: (string | null)[] = [];
  const chrome: string[] = [];
  let tagged = 0;
  let loose = 0;
  for (const raw of tc.items as (Item | Mark)[]) {
    if ("type" in raw) {
      if (raw.type === "endMarkedContent") stack.pop();
      else stack.push(raw.tag === "Artifact" ? "#A" : (raw.id ?? null));
      continue;
    }
    const at = stack.findLast((s) => s !== null);
    if (at === "#A") {
      chrome.push(raw.str);
      continue;
    }
    if (!at) {
      loose += raw.str.trim().length;
      continue;
    }
    tagged += raw.str.trim().length;
    const [, , , d, x, y] = raw.transform;
    const size = Math.abs(d) || raw.height || 10;
    const box: Box = [x, y, x + raw.width, y + size];
    const r = runs.get(at);
    if (!r) runs.set(at, { text: raw.str, box, x, y, yEnd: y, end: x + raw.width, size });
    else {
      const next = Math.abs(r.yEnd - y) >= Math.max(2, size * 0.4);
      r.text += next && !/\s$/.test(r.text) && !/^\s/.test(raw.str) ? ` ${raw.str}` : raw.str;
      r.box = union([r.box, box])!;
      r.yEnd = y;
      r.end = x + raw.width;
      r.size = Math.max(r.size, size);
    }
  }
  return { runs, chrome: chrome.join(" "), tagged, loose };
}

export async function readPics(page: PDFPageProxy, prefix: string): Promise<Pic[]> {
  const ops = await page.getOperatorList();
  const pics: Pic[] = [];
  const marks: (string | null)[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.beginMarkedContentProps) {
      const props = args[1] as number | { mcid?: number } | null;
      const mcid = typeof props === "number" ? props : props?.mcid;
      marks.push(args[0] === "Artifact" ? "#A" : mcid === undefined ? null : `${prefix}_mc${mcid}`);
    } else if (fn === OPS.beginMarkedContent) marks.push(args[0] === "Artifact" ? "#A" : null);
    else if (fn === OPS.endMarkedContent) marks.pop();
    else if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0])) ctm = mul(ctm, args[0] as number[]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      const mm = args[2] as number[] | undefined;
      if (marks.includes("#A") || !PAINT.has(args[0] as number) || mm?.length !== 4) continue;
      const xs = [mm[0], mm[2]].flatMap((x) => [mm[1], mm[3]].map((y) => mul(ctm, [1, 0, 0, 1, x, y]).slice(4)));
      const box: Box = [
        Math.min(...xs.map((p) => p[0])),
        Math.min(...xs.map((p) => p[1])),
        Math.max(...xs.map((p) => p[0])),
        Math.max(...xs.map((p) => p[1])),
      ];
      const [vx0, vy0, vx1, vy1] = page.view;
      const off = box[0] < vx0 - 2 || box[1] < vy0 - 2 || box[2] > vx1 + 2 || box[3] > vy1 + 2;
      pics.push({ mc: marks.findLast((m) => m !== null) ?? "", box, png: null, off });
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      if (marks.includes("#A")) continue;
      const img =
        fn === OPS.paintInlineImageXObject
          ? (args[0] as Parameters<typeof toPng>[0])
          : await imageOf(page, String(args[0]));
      const x = ctm[4];
      const y = Math.min(ctm[5], ctm[5] + ctm[3]);
      const box: Box = [x, y, x + Math.hypot(ctm[0], ctm[1]), y + Math.hypot(ctm[2], ctm[3])];
      pics.push({ mc: marks.findLast((m) => m !== null) ?? "", box, png: toPng(img) });
    }
  }
  return pics;
}

export function outlineEntries(
  items: { title: string; items: unknown[] }[] | null,
  depth = 0,
  out: Entry[] = [],
): Entry[] {
  for (const o of items ?? []) {
    const t = cleanSpaces(o.title).trim();
    const m = t.match(NUMBER_RE);
    out.push({ number: m?.[1] ?? "", norm: norm(m ? m[2] : t), depth });
    outlineEntries(o.items as { title: string; items: unknown[] }[], depth + 1, out);
  }
  return out;
}
