import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  assemble,
  CAPTION_RE,
  type Converted,
  type ConvertOpts,
  type Figure,
  guessDate,
  guessTitle,
  slug,
  titleKey,
  uniqueKey,
} from "./convert.ts";
import type { Block } from "./convert-html.ts";
import { cleanSpaces } from "./convert-html.ts";
import { convertTaggedPdf } from "./convert-pdf-tags.ts";
import { imageOf, type Matrix, mul, openPdf, PDFJS, shoot, toPng } from "./pdf.ts";

type Line = { y: number; x: number; end: number; size: number; bold: boolean; text: string };
type Pic = { x: number; y: number; w: number; h: number; png: Uint8Array };
type Page = { n: number; height: number; lines: Line[]; pics: Pic[] };

async function readPages(buf: Uint8Array, signal?: AbortSignal): Promise<{ pages: Page[]; skipped: number }> {
  const loading = openPdf(buf);
  const doc = await loading.promise;
  const pages: Page[] = [];
  let skipped = 0;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.aborted) throw new Error("Cancelled.");
      const page = await doc.getPage(n);
      const height = page.view[3] - page.view[1];
      const tc = await page.getTextContent();
      const lines: Line[] = [];
      let cur: Line | null = null;
      for (const raw of tc.items) {
        if (!("str" in raw)) continue;
        const [, , , d, x, y] = raw.transform as number[];
        const size = Math.abs(d) || raw.height || 10;
        const font = tc.styles[raw.fontName]?.fontFamily ?? "";
        const bold = /bold|black|heavy/i.test(`${raw.fontName} ${font}`);
        const pieces = raw.str.split(/\s+(?=(?:Figure|Fig\.)\s*\d)/);
        for (const [i, str] of pieces.entries()) {
          const at: number = i === 0 ? x : (cur?.end ?? x);
          const end = i === pieces.length - 1 ? x + (raw.width ?? 0) : at;
          const startsCaption = /^\s*(?:Figure|Fig\.)\s*\d/i.test(str);
          if (cur && !startsCaption && Math.abs(cur.y - y) <= Math.max(2, size * 0.3)) {
            const glue = cur.text.endsWith(" ") || str.startsWith(" ") || at - cur.end < size * 0.15 ? "" : " ";
            cur.text += glue + str;
            cur.end = Math.max(cur.end, end);
            cur.size = Math.max(cur.size, size);
          } else {
            if (cur) lines.push(cur);
            cur = { y, x: at, end, size, bold, text: str };
          }
        }
        if (raw.hasEOL && cur) {
          lines.push(cur);
          cur = null;
        }
      }
      if (cur) lines.push(cur);
      for (const l of lines) l.text = cleanSpaces(l.text).trim();
      const pics: Pic[] = [];
      const ops = await page.getOperatorList();
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          if (Array.isArray(args[0])) ctm = mul(ctm, args[0] as number[]);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          const img =
            fn === OPS.paintInlineImageXObject
              ? (args[0] as Parameters<typeof toPng>[0])
              : await imageOf(page, String(args[0]));
          const w = Math.hypot(ctm[0], ctm[1]);
          const h = Math.hypot(ctm[2], ctm[3]);
          const png = toPng(img);
          if (!png) {
            skipped++;
            continue;
          }
          pics.push({ x: ctm[4], y: Math.min(ctm[5], ctm[5] + ctm[3]), w, h, png });
        }
      }
      pages.push({ n, height, lines, pics });
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  return { pages, skipped };
}

const norm = (s: string) => s.replace(/\d+/g, "#");
const picKey = (p: Pic) =>
  `${Math.round(p.x / 4)}:${Math.round(p.y / 4)}:${Math.round(p.w / 4)}:${Math.round(p.h / 4)}`;

function repeated<T>(pages: Page[], items: (p: Page) => T[], key: (t: T) => string): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages) for (const k of new Set(items(p).map(key))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const min = Math.max(3, Math.ceil(pages.length * 0.5));
  return new Set([...counts].filter(([, c]) => c >= min).map(([k]) => k));
}

const isTocLine = (t: string) =>
  /\.{4,}\s*\d+$/.test(t) || /^(?:(?:[A-Z]{1,3}\.)?\d+(?:\.\d+)*|Figure\s+\d+.*)\s.*\s\d{1,3}$/.test(t);

type Cap = { page: Page; line: Line; num: string; caption: string; key: string };

function captionsOf(pages: Page[]): Cap[] {
  const used = new Set<string>();
  const caps: Cap[] = [];
  for (const page of pages)
    for (const line of page.lines) {
      const m = line.text.match(CAPTION_RE);
      if (m && !line.text.includes("....")) caps.push({ page, line, num: m[1], caption: line.text, key: "" });
    }
  for (const c of caps) c.key = uniqueKey(used, c.num);
  return caps;
}

function assignPictures(
  pages: Page[],
  caps: Cap[],
): { byCap: Map<Cap, Pic>; loose: Map<Page, Pic[]>; extra: number; small: number } {
  const byCap = new Map<Cap, Pic>();
  const loose = new Map<Page, Pic[]>();
  let extra = 0;
  let small = 0;
  for (const page of pages) {
    const pageCaps = caps.filter((c) => c.page === page).sort((a, b) => b.line.y - a.line.y);
    const taken = new Set<Pic>();
    let ceiling = Number.POSITIVE_INFINITY;
    for (const cap of pageCaps) {
      const above = page.pics.filter((p) => !taken.has(p) && p.y >= cap.line.y - 2 && p.y < ceiling);
      if (above.length) {
        const best = above.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
        byCap.set(cap, best);
        for (const p of above) taken.add(p);
        extra += above.length - 1;
      }
      ceiling = cap.line.y;
    }
    const rest = page.pics.filter((p) => !taken.has(p));
    const big = rest.filter((p) => p.w >= 40 && p.h >= 30);
    small += rest.length - big.length;
    loose.set(page, big);
  }
  return { byCap, loose, extra, small };
}

async function analyse(buf: Uint8Array, signal?: AbortSignal) {
  const { pages, skipped } = await readPages(buf, signal);
  const first = pages[0]?.lines.map((l) => l.text) ?? [];
  let tiny = 0;
  const chrome = repeated(
    pages,
    (p) => p.lines,
    (l) => norm(l.text),
  );
  const logos = repeated(pages, (p) => p.pics, picKey);
  for (const p of pages) {
    p.lines = p.lines.filter((l) => l.text && !chrome.has(norm(l.text)));
    const kept = p.pics.filter((x) => !logos.has(picKey(x)));
    p.pics = kept.filter((x) => x.w >= 30 && x.h >= 20);
    tiny += kept.length - p.pics.length;
    if (p.lines.filter((l) => isTocLine(l.text)).length >= 8) p.lines = p.lines.filter((l) => !isTocLine(l.text));
  }
  const caps = captionsOf(pages);
  const assigned = assignPictures(pages, caps);
  await drawn(buf, pages, caps, assigned.byCap);
  return { pages, skipped, first, caps, ...assigned, small: assigned.small + tiny };
}

// ponytail: a caption with no picture above it sits under a vector drawing — the page region between it and the
// text above is rendered, as the reader sees it
async function drawn(buf: Uint8Array, pages: Page[], caps: Cap[], byCap: Map<Cap, Pic>): Promise<void> {
  const orphans = caps.filter((c) => !byCap.has(c));
  if (!orphans.length) return;
  const loading = openPdf(buf);
  try {
    const doc = await loading.promise;
    for (const c of orphans) {
      const lines = pages.find((p) => p === c.page)?.lines ?? [];
      const above = lines.filter((l) => l.y > c.line.y + c.line.size).sort((x, y) => x.y - y.y)[0];
      const left = Math.min(...lines.map((l) => l.x));
      const right = Math.max(...lines.map((l) => l.end));
      const box: [number, number, number, number] = [
        left,
        c.line.y + c.line.size + 1,
        right,
        (above ? above.y - 2 : c.page.height - 50) - 1,
      ];
      if (box[3] - box[1] < 30 || !(right > left)) continue;
      const png = await shoot(doc, await doc.getPage(c.page.n), box);
      if (png) byCap.set(c, { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1], png });
    }
  } finally {
    await loading.destroy();
  }
}

// ponytail: a page without text is a scan: the whole page is kept as a picture, which Claude reads when it
// describes the figures (its labels are then searchable)
async function scannedPages(buf: Uint8Array, pages: Page[]): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const scans = pages.filter((p) => p.lines.length < 3 && !p.pics.length);
  if (!scans.length) return out;
  const loading = openPdf(buf);
  try {
    const doc = await loading.promise;
    for (const p of scans.slice(0, 200)) {
      const page = await doc.getPage(p.n);
      const png = await shoot(doc, page, [page.view[0], page.view[1], page.view[2], page.view[3]]);
      if (png) out.set(p.n, png);
    }
  } finally {
    await loading.destroy();
  }
  return out;
}

export async function pdfFigures(buf: Uint8Array, signal?: AbortSignal): Promise<Figure[]> {
  const tagged = await convertTaggedPdf(buf, { code: "", signal });
  if (tagged) return tagged.figures.filter((f) => CAPTION_RE.test(f.caption));
  const a = await analyse(buf, signal);
  return a.caps.flatMap((c) => {
    const pic = a.byCap.get(c);
    return pic ? [{ key: c.key, caption: c.caption, ext: "png", data: pic.png }] : [];
  });
}

const HEADING_RE = /^((?:[A-Z]{1,3}\.)?\d{1,2}(?:\.\d{1,3}){0,6})\.?\s+(?:[-–—]\s*)?(\S.{1,150})$/;
const ARTICLE_RE = /^((?:[A-Z]{1,3}\.)?\d{1,2}(?:\.\d{1,3}){1,7})\.?(?:\s+\S|$)/;
const BULLET_RE = /^([•▪◦●○■□➢►\-–—−*]|o(?=\s)|\d+[.)](?=\s))\s*/;

const prefixOf = (n: string) => n.match(/^[A-Z]{1,3}\./)?.[0] ?? "";
const partsOf = (n: string) => n.slice(prefixOf(n).length).split(".").map(Number);

function follows(next: string, last: string): boolean {
  const n = partsOf(next);
  const l = last && prefixOf(last) === prefixOf(next) ? partsOf(last) : [];
  for (let k = 0; k < n.length; k++) {
    const head = n.slice(0, k).every((v, i) => v === l[i]);
    const step = n[k] === (l[k] ?? 0) + 1;
    if (head && step && n.slice(k + 1).every((v) => v === 1)) return true;
  }
  return false;
}

export async function convertPdf(buf: Uint8Array, opts: ConvertOpts): Promise<Converted> {
  const tagged = opts.reader === "layout" ? null : await convertTaggedPdf(buf, opts);
  if (tagged) return tagged;
  const given = new Map((opts.numbers ?? []).map((e) => [titleKey(e.title), e.number]));
  const a = await analyse(buf, opts.signal);
  const sizes = a.pages.flatMap((p) => p.lines.map((l) => Math.round(l.size)));
  const freq = new Map<number, number>();
  for (const s of sizes) freq.set(s, (freq.get(s) ?? 0) + 1);
  const body = [...freq].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 10;
  const headSizes = [...freq.keys()].filter((k) => k >= body + 2.5).sort((x, y) => y - x);

  const blocks: Block[] = [];
  const figures: Figure[] = [];
  const capOf = new Map<Line, Cap>();
  for (const c of a.caps) capOf.set(c.line, c);
  const sections = new Set<string>();
  const articles: string[] = [];
  let last = "";
  let order = 0;
  let para: string[] = [];
  let paraBullet = false;
  const flush = () => {
    if (!para.length) return;
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: paraBullet ? "list" : "para", md: paraBullet ? `- ${text}` : text, text });
    para = [];
    paraBullet = false;
  };
  const picture = (key: string, caption: string, pic: Pic) => {
    figures.push({ key, caption, ext: "png", data: pic.png });
    const md = `![${caption.replace(/[[\]]/g, (c) => `\\${c}`)}](figures/fig-${key}.png) <!-- fig ${key} -->`;
    blocks.push({ kind: "image", md, text: caption });
  };
  const used = new Set(a.caps.map((c) => c.key));

  const scans = await scannedPages(buf, a.pages);
  for (const page of a.pages) {
    flush();
    blocks.push({ kind: "para", md: `<!-- page ${page.n} -->`, text: "" });
    const scan = scans.get(page.n);
    if (scan) picture(uniqueKey(used, `p${page.n}`), "", { x: 0, y: 0, w: 0, h: 0, png: scan });
    type El = { y: number; line?: Line; pic?: Pic };
    const els: El[] = [
      ...page.lines.map((line) => ({ y: line.y, line })),
      ...(a.loose.get(page) ?? []).map((pic) => ({ y: pic.y + pic.h, pic })),
    ].sort((x, y) => y.y - x.y);
    let prev: Line | null = null;
    for (const el of els) {
      if (el.pic) {
        flush();
        order++;
        picture(uniqueKey(used, `f${order}`), "", el.pic);
        prev = null;
        continue;
      }
      const line = el.line!;
      const cap = capOf.get(line);
      if (cap) {
        flush();
        const pic = a.byCap.get(cap);
        if (pic) picture(cap.key, cap.caption, pic);
        else blocks.push({ kind: "para", md: `${cap.caption} <!-- fig ${cap.key} -->`, text: cap.caption });
        prev = null;
        continue;
      }
      const h = line.text.match(HEADING_RE);
      const numbered =
        h &&
        (line.size > body + 0.5 || line.bold) &&
        partsOf(h[1])[0] <= 50 &&
        follows(h[1], last) &&
        /^\p{Lu}/u.test(h[2]) &&
        !/[.;,:]$/.test(h[2]);
      const big = !numbered && headSizes.includes(Math.round(line.size)) && line.text.length <= 120;
      if (numbered || (big && !/[.;,:]$/.test(line.text))) {
        flush();
        const title = numbered ? h![2] : line.text;
        const number = numbered ? h![1] : (given.get(titleKey(title)) ?? "");
        if (number) last = number;
        const level = number ? partsOf(number).length : headSizes.indexOf(Math.round(line.size)) + 1;
        const anchor = uniqueKey(sections, number || slug(title));
        blocks.push({
          kind: "heading",
          md: `${"#".repeat(Math.min(level + 1, 6))} ${number ? `${number} ` : ""}${title} <!-- § ${anchor} -->`,
          text: title,
        });
        prev = null;
        continue;
      }
      const art = last ? line.text.match(ARTICLE_RE)?.[1] : undefined;
      const article = !!art && art.startsWith(`${last}.`) && !articles.includes(art);
      if (article) articles.push(art);
      const gap = prev ? prev.y - line.y : 0;
      const bullet = BULLET_RE.test(line.text);
      if (!prev || bullet || article || gap > Math.max(prev.size, line.size) * 1.6) {
        flush();
        paraBullet = bullet;
        para.push(bullet ? line.text.replace(BULLET_RE, "") : line.text);
      } else para.push(line.text);
      prev = line;
    }
  }
  flush();

  const warnings: string[] = [];
  if (a.skipped) warnings.push(`${a.skipped} picture${a.skipped > 1 ? "s" : ""} in the PDF could not be extracted`);
  if (a.small)
    warnings.push(`${a.small} small picture${a.small > 1 ? "s" : ""} dropped (icons, or text drawn as a picture)`);
  if (a.extra)
    warnings.push(
      `${a.extra} extra picture${a.extra > 1 ? "s" : ""} above a caption dropped (only the largest is kept)`,
    );
  const orphanCaps = a.caps.filter((c) => !a.byCap.has(c)).map((c) => c.key);
  if (orphanCaps.length)
    warnings.push(`Figure ${orphanCaps.join(", ")}: caption with nothing drawn above it in the PDF`);
  const scanned = a.pages.filter((p) => p.lines.length < 3).length;
  if (scanned && scanned >= a.pages.length / 2)
    warnings.push(
      `${scanned} of ${a.pages.length} pages carry no text (a scan, or text drawn as pictures): kept as page pictures that Claude reads when it describes the figures, but nothing on them can be quoted — ask for the source document`,
    );
  else warnings.push("Converted from PDF: headings are guessed from their numbering, tables are flattened to text");
  const title = guessTitle(a.first);
  const md = assemble(`# ${opts.code} — ${title || opts.code}`, blocks);
  return { md, figures, warnings, meta: { title, date: guessDate(a.first.join("\n")) }, convertedWith: PDFJS };
}
