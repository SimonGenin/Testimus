import { OPS, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { sha256 } from "../lib/hash.ts";
import {
  assemble,
  CAPTION_RE,
  type Converted,
  type ConvertOpts,
  type Figure,
  guessDate,
  guessTitle,
  slug,
  uniqueKey,
} from "./convert.ts";
import { besideTables, collectItems, imageLine, planFigures } from "./convert-docx.ts";
import { type Block, cleanSpaces, type HNode, renderBlocks, textOf } from "./convert-html.ts";
import { imageOf, inkAbove, type Matrix, mul, openPdf, PDFJS, shoot, toPng } from "./pdf.ts";

type Box = [number, number, number, number];
type Run = { text: string; box: Box; x: number; y: number; yEnd: number; end: number; size: number };
type SNode = { role?: string; type?: string; id?: string; alt?: string; bbox?: number[]; children?: SNode[] };
type Pic = { mc: string; box: Box; png: Uint8Array | null; off?: boolean };
type Entry = { number: string; norm: string; depth: number; x?: number };
type Shot = { img: HNode; box?: Box; mcs: string[]; png?: Uint8Array | null };
type Item = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };
type Mark = { type: string; id?: string; tag?: string };

export const NUMBER_RE = /^((?:[A-Z]{1,3}\.)?\d{1,3}(?:\.\d{1,3}){0,8})\.?\s+(\S.*)$/;
export const TOC_RE = /^(?:((?:[A-Z]{1,3}\.)?\d{1,3}(?:\.\d{1,3}){0,8})\.?\s+)?(.+?)\s*(?:\.{3,}\s*)?\d{1,4}$/;
const PARA = /^(P|Caption|Note|BlockQuote|Quote|Span|Link|Reference|Code|Lbl|LBody|Title|BibEntry|Annot|Form)$/;
const INLINE = /^(Span|Link|Reference|Quote|Code|Lbl|Annot|Form|BibEntry|Ruby|Warichu|Em|Strong|Sub)?$/;
const block = (c: SNode) => !c.type && !INLINE.test(c.role ?? "");
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

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const partsOf = (n: string) => n.replace(/^[A-Z]{1,3}\./, "").split(".").length;
const union = (boxes: Box[]): Box | undefined =>
  boxes.length
    ? [
        Math.min(...boxes.map((b) => b[0])),
        Math.min(...boxes.map((b) => b[1])),
        Math.max(...boxes.map((b) => b[2])),
        Math.max(...boxes.map((b) => b[3])),
      ]
    : undefined;
const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a: Box, b: Box): number =>
  area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const text = (t: string): HNode => ({ tag: "#text", attrs: {}, children: [], text: t });
const para = (children: HNode[], role = ""): HNode => ({ tag: "p", attrs: role ? { role } : {}, children });

function joinRuns(runs: Run[]): string {
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

async function readPics(page: PDFPageProxy, prefix: string): Promise<Pic[]> {
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

async function readPage(doc: PDFDocumentProxy, page: PDFPageProxy, toc: Entry[]) {
  const { runs, chrome, tagged, loose } = await readRuns(page);
  const first = [...runs.keys()][0] ?? "";
  const prefix = first.includes("_mc") ? first.slice(0, first.lastIndexOf("_mc")) : `p${page.ref?.num}R`;
  const pics = await readPics(page, prefix);
  const tree = (await page.getStructTree()) as SNode | null;
  const shots: Shot[] = [];
  const boxes = new Map<HNode, Box>();

  const ids = (n: SNode, out: string[] = []): string[] => {
    if (n.type === "content" && n.id) out.push(n.id);
    for (const c of n.children ?? []) ids(c, out);
    return out;
  };
  const runsOf = (n: SNode) => ids(n).flatMap((id) => runs.get(id) ?? []);
  const boxOf = (ns: SNode[]) => union(ns.flatMap((n) => runsOf(n).map((r) => r.box)));
  const nodeIds = new Map<HNode, string[]>();
  const place = (h: HNode, ns: SNode[]): HNode => {
    const b = boxOf(ns);
    if (b) boxes.set(h, b);
    nodeIds.set(
      h,
      ns.flatMap((n) => ids(n)),
    );
    return h;
  };

  // ponytail: a picture tagged as plain content (no Figure around it) is kept where its content sits
  const loosePics = new Map<string, Pic[]>();
  for (const p of pics)
    if (p.png && p.mc && p.box[2] - p.box[0] >= 8 && p.box[3] - p.box[1] >= 8)
      loosePics.set(p.mc, [...(loosePics.get(p.mc) ?? []), p]);

  const figure = (n: SNode): HNode => {
    const img: HNode = { tag: "img", attrs: { src: `tm-shot:${shots.length}`, alt: n.alt ?? "" }, children: [] };
    shots.push({ img, box: n.bbox?.length === 4 ? (n.bbox as Box) : undefined, mcs: ids(n) });
    return img;
  };

  const inlines = (n: SNode): HNode[] => {
    const out: HNode[] = [];
    let pending: Run[] = [];
    const flush = () => {
      const t = joinRuns(pending);
      if (t.trim()) {
        const last = out[out.length - 1];
        out.push(text(last?.tag === "#text" ? ` ${t}` : t));
      }
      pending = [];
    };
    const walk = (x: SNode) => {
      if (x.type === "content") {
        pending.push(...(x.id && runs.has(x.id) ? [runs.get(x.id)!] : []));
        for (const p of (x.id && loosePics.get(x.id)) || []) {
          flush();
          const img: HNode = { tag: "img", attrs: { src: `tm-shot:${shots.length}`, alt: "" }, children: [] };
          shots.push({ img, box: p.box, mcs: [], png: p.png });
          out.push(img);
        }
        if (x.id) loosePics.delete(x.id);
      } else if (x.role === "Figure" || x.role === "Formula") {
        flush();
        out.push(figure(x));
      } else if (x.role === "Artifact" || x.role === "TOC" || x.role === "TOCI") return;
      else for (const c of x.children ?? []) walk(c);
    };
    for (const c of n.children ?? []) walk(c);
    flush();
    return out;
  };

  // ponytail: Word keeps a figure, its caption or a table typed under a bullet inside the list item; the reader
  // sees them between two lists, so they are lifted out
  const lifted = (x: SNode): boolean =>
    x.role === "Caption" ||
    x.role === "Table" ||
    (x.role === "Figure" && !!x.bbox && x.bbox[3] - x.bbox[1] >= 40 && x.bbox[2] - x.bbox[0] >= 60) ||
    (x.children ?? []).some((c) => !c.type && lifted(c));

  const list = (n: SNode): HNode[] => {
    const out: HNode[] = [];
    let items: HNode[] = [];
    const labels: string[] = [];
    const close = () => {
      const ordered = labels.length > 0 && labels.every((l) => /^\(?[0-9a-z]{1,3}[.)]$/i.test(l));
      if (items.length) out.push(place({ tag: ordered ? "ol" : "ul", attrs: {}, children: items }, [n]));
      items = [];
    };
    for (const li of n.children ?? []) {
      const children: HNode[] = [];
      const out2: HNode[] = [];
      const nested = (l: SNode) => {
        for (const x of list(l)) (x.tag === "ul" || x.tag === "ol" ? children : out2).push(x);
      };
      if (li.role === "L") nested(li);
      else if (li.role === "LI")
        for (const part of li.children ?? []) {
          if (part.role === "Lbl") labels.push(joinRuns(runsOf(part)).trim());
          else
            for (const c of part.role === "LBody" ? (part.children ?? []) : [part]) {
              if (c.role === "L") nested(c);
              else if (lifted(c)) out2.push(...blocks(c));
              else children.push(...inlines({ children: [c] }));
            }
        }
      if (children.length) {
        const last = items[items.length - 1];
        if (li.role === "L" && last) last.children.push(...children);
        else items.push({ tag: "li", attrs: {}, children });
      }
      if (out2.length) {
        close();
        out.push(...out2);
      }
    }
    close();
    return out;
  };

  const cells = (n: SNode): HNode[] => {
    const out: HNode[] = [];
    let loose: SNode[] = [];
    const flush = () => {
      const kids = inlines({ children: loose });
      if (kids.length) out.push(para(kids));
      loose = [];
    };
    for (const c of n.children ?? []) {
      if (block(c) && !/^(P|Caption|Note)$/.test(c.role ?? "")) {
        flush();
        out.push(...blocks(c));
      } else if (block(c)) {
        flush();
        loose = [c];
        flush();
      } else loose.push(c);
    }
    flush();
    return out;
  };

  const table = (n: SNode): HNode => {
    const rows: HNode[] = [];
    const walk = (x: SNode) => {
      for (const c of x.children ?? []) {
        if (c.role === "TR")
          rows.push({
            tag: "tr",
            attrs: {},
            children: (c.children ?? [])
              .filter((td) => td.role === "TD" || td.role === "TH")
              .map((td) => ({ tag: td.role === "TH" ? "th" : "td", attrs: {}, children: cells(td) })),
          });
        else if (!c.type) walk(c);
      }
    };
    walk(n);
    return place({ tag: "table", attrs: {}, children: rows }, [n]);
  };

  function blocks(n: SNode): HNode[] {
    if (n.type) return [];
    const role = n.role ?? "";
    const h = role.match(/^H([1-6])?$/);
    if (h) {
      const x = Math.min(...runsOf(n).map((r) => r.box[0]));
      return [place({ tag: `h${h[1] ?? 1}`, attrs: { x: String(x) }, children: inlines(n) }, [n])];
    }
    if (role === "TOCI") {
      const rs = runsOf(n);
      const m = joinRuns(rs).trim().match(TOC_RE);
      if (m && !/^(figure|fig\.|tableau|table)\s/i.test(m[2]))
        toc.push({
          number: m[1] ?? "",
          norm: norm(m[2].replace(/[.\s]+$/, "")),
          depth: -1,
          x: rs.length ? Math.min(...rs.map((r) => r.box[0])) : 0,
        });
      return [];
    }
    if (role === "TOC") {
      for (const c of n.children ?? []) blocks(c);
      return [];
    }
    if (role === "Artifact") return [];
    if (role === "L") return list(n);
    if (role === "Table") return [table(n)];
    if (role === "Figure" || role === "Formula") return [figure(n)];
    if (PARA.test(role) && !(n.children ?? []).some((c) => block(c) && !PARA.test(c.role ?? ""))) {
      const kids = inlines(n);
      return kids.length ? [place(para(kids, role), [n])] : [];
    }
    const out: HNode[] = [];
    let loose: SNode[] = [];
    const flush = () => {
      const kids = inlines({ children: loose });
      if (kids.length) out.push(place(para(kids), loose));
      loose = [];
    };
    for (const c of n.children ?? []) {
      if (!block(c)) loose.push(c);
      else {
        flush();
        out.push(...blocks(c));
      }
    }
    flush();
    return out;
  }

  const nodes = tree ? blocks(tree) : [];
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

const endsSentence = (s: string) => /[.:;!?)»"]\s*$/.test(s);

// ponytail: Word cuts a table or a paragraph at the page end; the reader sees one, so they are joined again
function joinPages(pages: { n: number; nodes: HNode[] }[]): HNode[] {
  const out: HNode[] = [];
  for (const { n, nodes } of pages) {
    const marker = para([], "page");
    marker.attrs.page = String(n);
    const prev = out[out.length - 1];
    const head = nodes[0];
    const width = (t: HNode) => t.children[0]?.children.length ?? 0;
    if (prev?.tag === "table" && head?.tag === "table" && width(prev) === width(head)) {
      const rows = head.children;
      const same = textOf(rows[0] ?? text("")).trim() === textOf(prev.children[0] ?? text("")).trim();
      prev.children.push(...(same ? rows.slice(1) : rows));
      out.push(marker, ...nodes.slice(1));
    } else if (
      prev?.tag === "p" &&
      (prev.attrs.role ?? "P") === "P" &&
      head?.tag === "p" &&
      (head.attrs.role ?? "P") === "P" &&
      !endsSentence(textOf(prev)) &&
      /^\p{Ll}/u.test(textOf(head).trim())
    ) {
      prev.children.push(text(" "), ...head.children);
      out.push(marker, ...nodes.slice(1));
    } else out.push(marker, ...nodes);
  }
  return out;
}

type Numbered = { number: string; title: string; level: number };

// ponytail: Word often draws a heading's number without putting it in the text; it is taken from the heading,
// else the numbers read on the page (docs.convert numbers), else the bookmarks, else the table of contents,
// else the « x.1 » under it; a number only drawn (the heading is indented like a numbered one) is never guessed:
// the heading keeps its title as anchor
function numberHeadings(
  nodes: HNode[],
  entries: Entry[],
  trusted: boolean,
  margin: number,
  given: Entry[] = [],
): { by: Map<HNode, Numbered>; drawn: number } {
  const by = new Map<HNode, Numbered>();
  const hs = nodes.filter((n) => /^h[1-6]$/.test(n.tag) && cleanSpaces(textOf(n)).trim());
  const hidden = new Set<HNode>();
  let lastLevel = 0;
  let lastRole = 0;
  const finder = (list: Entry[]) => {
    let cursor = 0;
    return (title: string): Entry | undefined => {
      const t = norm(title);
      for (let i = cursor; t && i < Math.min(list.length, cursor + 40); i++) {
        const e = list[i].norm;
        if (e === t || (Math.min(e.length, t.length) >= 12 && (e.startsWith(t) || t.startsWith(e)))) {
          cursor = i + 1;
          return list[i];
        }
      }
      return undefined;
    };
  };
  const read = finder(given);
  const listed = finder(entries);
  for (const n of hs) {
    const raw = cleanSpaces(textOf(n)).trim();
    const role = Number(n.tag.slice(1));
    const written = raw.match(NUMBER_RE);
    const seen = written ? undefined : read(raw);
    const fromList = written ? undefined : listed(raw);
    const entry = seen ?? fromList;
    const number = written?.[1] ?? entry?.number ?? "";
    const level = number
      ? partsOf(number)
      : entry && entry.depth >= 0
        ? entry.depth + 1
        : Math.max(1, Math.min(6, lastLevel ? lastLevel + (role > lastRole ? 1 : 0) : role));
    if (!number && !(entry && (trusted || seen)) && Number(n.attrs.x) - margin > 12) hidden.add(n);
    by.set(n, { number, title: written?.[2] ?? raw, level });
    lastLevel = level;
    lastRole = role;
  }
  const used = new Set([...by.values()].map((h) => h.number).filter(Boolean));
  hs.forEach((n, i) => {
    const h = by.get(n)!;
    const next = hs[i + 1] && by.get(hs[i + 1])!.number;
    const parent = next?.match(/^(.+)\.1$/)?.[1];
    if (h.number || !parent || used.has(parent)) return;
    used.add(parent);
    by.set(n, { ...h, number: parent, level: partsOf(parent) });
  });
  const at = (n: HNode) => Math.round(Number(n.attrs.x) / 3);
  const left = hs.filter((n) => hidden.has(n) && !by.get(n)!.number);
  const drawn = left.filter((n) => left.some((o) => o !== n && at(o) === at(n))).length;
  return { by, drawn };
}

export async function convertTaggedPdf(buf: Uint8Array, opts: ConvertOpts): Promise<Converted | null> {
  const loading = openPdf(buf);
  const doc = await loading.promise;
  try {
    if (!doc.numPages || !(await (await doc.getPage(1)).getStructTree())) return null;
    const bookmarks = outlineEntries((await doc.getOutline()) as { title: string; items: unknown[] }[] | null);
    const toc: Entry[] = [];
    const pages: { n: number; nodes: HNode[] }[] = [];
    const shots: Shot[] = [];
    let empty = 0;
    let tagged = 0;
    let loose = 0;
    let cover: string[] = [];
    const lefts = new Map<number, number>();
    let chrome1 = "";
    for (let n = 1; n <= doc.numPages; n++) {
      if (opts.signal?.aborted) throw new Error("Cancelled.");
      const page = await doc.getPage(n);
      const r = await readPage(doc, page, toc);
      const base = shots.length;
      for (const s of r.shots) s.img.attrs.src = `tm-shot:${base + Number(s.img.attrs.src.slice(8))}`;
      shots.push(...r.shots);
      pages.push({ n, nodes: r.nodes });
      empty += r.empty;
      tagged += r.tagged;
      loose += r.loose;
      for (const x of r.lefts) lefts.set(x, (lefts.get(x) ?? 0) + 1);
      if (n === 1) {
        chrome1 = r.chrome;
        cover = r.lines;
      }
      page.cleanup();
    }
    // ponytail: tags are trusted only when they hold all the text and the headings; else the layout reader
    // guesses better than half-tagged structure
    if (
      opts.reader !== "tagged" &&
      (loose > 0.02 * (tagged + loose) || !pages.some((p) => p.nodes.some((n) => /^h[1-6]$/.test(n.tag))))
    )
      return null;

    const xs = [...new Set(toc.map((e) => Math.round((e.x ?? 0) / 6)))].sort((a, b) => a - b);
    for (const e of toc) e.depth = e.number ? partsOf(e.number) - 1 : xs.indexOf(Math.round((e.x ?? 0) / 6));
    const given: Entry[] = (opts.numbers ?? []).map((e) => ({
      number: e.number,
      norm: norm(e.title),
      depth: partsOf(e.number) - 1,
    }));
    const entries = bookmarks.length ? bookmarks : toc;
    const root: HNode = { tag: "#root", attrs: {}, children: joinPages(pages) };
    const plan = planFigures(collectItems(root));
    const { by, drawn } = numberHeadings(
      root.children,
      entries,
      bookmarks.length > 0,
      [...lefts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0,
      given,
    );
    const figures: Figure[] = [];
    const missing: string[] = [];
    const seen = new Map<string, string>();
    const sections = new Set<string>();

    const heading = (n: HNode): Block | null => {
      const h = by.get(n);
      if (!h) return null;
      const anchor = uniqueKey(sections, h.number || slug(h.title));
      return {
        kind: "heading",
        md: `${"#".repeat(Math.min(h.level + 1, 6))} ${h.number ? `${h.number} ` : ""}${h.title} <!-- § ${anchor} -->`,
        text: h.title,
      };
    };

    const image = (n: HNode): string => {
      const shot = shots[Number((n.attrs.src ?? "").slice(8))];
      const fig = plan.byImg.get(n);
      if (!shot?.png || !fig) return "";
      const hash = sha256(shot.png);
      const again = seen.get(hash);
      if (again && !fig.caption) return `![](${again})`;
      const file = `figures/fig-${fig.key}.png`;
      seen.set(hash, file);
      figures.push({ key: fig.key, caption: fig.caption, ext: "png", data: shot.png });
      return imageLine(fig.caption, file, fig.key);
    };

    const paragraph = (n: HNode): Block | null | undefined => {
      if (n.attrs.role === "page") return { kind: "para", md: `<!-- page ${n.attrs.page} -->`, text: "" };
      if (plan.dropped.has(n)) {
        const md = n.children
          .filter((c) => c.tag === "img")
          .map(image)
          .join("\n\n");
        return md ? { kind: "image", md, text: "" } : null;
      }
      return undefined;
    };

    const besideTable = besideTables(root);
    const decorate = (n: HNode, md: string): string => {
      const orphan = plan.orphans.get(n);
      if (!orphan) return md;
      if (!besideTable.has(n)) missing.push(orphan.key);
      return `${md} <!-- fig ${orphan.key} -->`;
    };

    const blocks = renderBlocks(root.children, { image, heading, paragraph, decorate });
    const info = (await doc.getMetadata()).info as { Title?: string };
    const title = guessTitle(cover) || info.Title || "";
    const date = guessDate(`${cover.join("\n")}\n${chrome1}`);

    const warnings: string[] = [];
    if (missing.length)
      warnings.push(
        `Figure ${missing.join(", ")}: captioned or named in the text, but nothing is drawn there in the PDF — the original lost these pictures (a drawing pasted as text, or never inserted)`,
      );
    if (empty) warnings.push(`${empty} figure${empty > 1 ? "s" : ""} tagged in the PDF with nothing to draw`);
    if (drawn)
      warnings.push(
        `${drawn} heading number${drawn > 1 ? "s are" : " is"} drawn on the page but missing from the PDF text: those headings are anchored by their titles — add the .docx of the same document, or read the numbers on the pages and give them to docs.convert (conversion numbers)`,
      );
    const md = assemble(`# ${opts.code} — ${title || opts.code}`, blocks);
    return { md, figures, warnings, meta: { title, date }, convertedWith: `${PDFJS} (tagged PDF)` };
  } finally {
    await loading.destroy();
  }
}
