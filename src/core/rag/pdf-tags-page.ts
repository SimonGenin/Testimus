import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { CAPTION_RE } from "./convert.ts";
import { cleanSpaces, type HNode, textOf } from "./convert-html.ts";
import { inkAbove, shoot } from "./pdf.ts";
import { area, type Box, type Entry, overlap, readPics, readRuns, union } from "./pdf-tags-read.ts";
import { type SNode, structure } from "./pdf-tags-structure.ts";

// ponytail: one page read from its tags, with every figure given its picture — the one painted there, the region
// drawn under its tag, or the drawing resting on a caption that has none
export async function readPage(doc: PDFDocumentProxy, page: PDFPageProxy, toc: Entry[]) {
  const { runs, chrome, tagged, loose } = await readRuns(page);
  const first = [...runs.keys()][0] ?? "";
  const prefix = first.includes("_mc") ? first.slice(0, first.lastIndexOf("_mc")) : `p${page.ref?.num}R`;
  const pics = await readPics(page, prefix);
  const tree = (await page.getStructTree()) as SNode | null;
  const { nodes, shots, boxes, nodeIds } = structure(tree, runs, pics, toc);
  // ponytail: a picture outside any tag (Chrome's exports) goes where it sits on the page
  for (const p of pics) {
    if (p.mc || !p.png || p.box[2] - p.box[0] < 30 || p.box[3] - p.box[1] < 20) continue;
    const img: HNode = { tag: "img", attrs: { src: `tm-shot:${shots.length}`, alt: "" }, children: [] };
    shots.push({ img, box: p.box, mcs: [], png: p.png });
    const at = nodes.findIndex((n) => (boxes.get(n)?.[3] ?? Number.POSITIVE_INFINITY) < p.box[3]);
    nodes.splice(at < 0 ? nodes.length : at, 0, img);
    boxes.set(img, p.box);
  }

  let empty = 0;
  for (const s of shots) {
    if (s.png !== undefined) continue;
    const inside = pics.filter(
      (p) => !p.off && (s.mcs.includes(p.mc) || (s.box && overlap(p.box, s.box) >= area(p.box) * 0.9)),
    );
    const box =
      s.box ??
      union([...inside.map((p) => p.box), ...s.mcs.flatMap((id) => (runs.has(id) ? [runs.get(id)!.box] : []))]);
    s.box = box;
    if (!box) continue;
    const one = inside.length === 1 ? inside[0] : null;
    const exact = one?.png && overlap(one.box, box) >= 0.9 * Math.max(area(box), area(one.box));
    s.png = exact ? one!.png : await shoot(doc, page, [box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1]);
    if (!s.png) empty++;
  }
  const dropImg = (list: HNode[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.tag === "img" && !shots[Number(n.attrs.src.slice(8))]?.png) list.splice(i, 1);
      else dropImg(n.children);
    }
  };
  dropImg(nodes);

  const all = [...runs.values()].map((r) => r.box);
  const left = Math.min(...all.map((b) => b[0]), page.view[2] * 0.12);
  const right = Math.max(...all.map((b) => b[2]), page.view[2] * 0.88);
  const isPicture = (n?: HNode) =>
    !!n && (n.tag === "img" || (n.tag === "p" && n.children.length === 1 && n.children[0].tag === "img"));
  // ponytail: when the paragraph above a caption holds drawn shapes, it is the drawing with its labels typed in
  // it (Word's drawing canvas): the ink resting on the caption is cut out as the reader sees it
  const drawing = async (cap: Box, prev?: HNode): Promise<Box | null> => {
    const mcs = prev ? (nodeIds.get(prev) ?? []) : [];
    if (!pics.some((p) => p.mc && mcs.includes(p.mc))) return null;
    const ink = await inkAbove(doc, page, [left - 6, cap[3] + 1, right + 6, Math.min(page.view[3] - 40, cap[3] + 500)]);
    return ink && ink[3] - ink[1] >= 30 ? ink : null;
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.tag !== "p" || !CAPTION_RE.test(cleanSpaces(textOf(n)).trim())) continue;
    if ([nodes[i - 1], nodes[i + 1]].some((x) => isPicture(x) || x?.tag === "table")) continue;
    const cap = boxes.get(n);
    if (!cap) continue;
    const prev = i > 0 ? boxes.get(nodes[i - 1]) : undefined;
    const next = boxes.get(nodes[i + 1]);
    const shape = await drawing(cap, nodes[i - 1]);
    const above: Box = shape
      ? [shape[0] - 2, shape[1] - 2, shape[2] + 2, shape[3] + 2]
      : [left, cap[3] + 1, right, (prev?.[1] ?? page.view[3] - 50) - 1];
    const below: Box = [left, (next?.[3] ?? 50) + 1, right, cap[1] - 1];
    let at = i;
    let png = above[3] - above[1] >= 30 ? await shoot(doc, page, above) : null;
    if (!png && below[3] - below[1] >= 30) {
      png = await shoot(doc, page, below);
      at = i + 1;
    }
    if (!png) continue;
    const img: HNode = { tag: "img", attrs: { src: `tm-shot:${shots.length}`, alt: "" }, children: [] };
    shots.push({ img, box: at === i ? above : below, mcs: [], png });
    nodes.splice(at, 0, img);
    i++;
  }
  const lefts = [...runs.values()].map((r) => Math.round(r.box[0]));
  const lines = [...runs.values()].map((r) => cleanSpaces(r.text).trim()).filter(Boolean);
  return { nodes, shots, empty, chrome, tagged, loose, lines, lefts };
}
