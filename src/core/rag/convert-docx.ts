import mammoth from "mammoth";
import mammothPackage from "mammoth/package.json" with { type: "json" };
import { readZip } from "../lib/zip.ts";
import {
  assemble,
  CAPTION_RE,
  type Converted,
  type ConvertOpts,
  extOf,
  type Figure,
  guessDate,
  guessTitle,
  reqRegex,
  sameCaption,
  slug,
  TRAILING_CAPTION_RE,
  uniqueKey,
} from "./convert.ts";
import {
  type Block,
  cleanSpaces,
  type HNode,
  inline,
  normalizeLine,
  parseHtml,
  renderBlocks,
  textOf,
} from "./convert-html.ts";

const MAMMOTH = `mammoth ${(mammothPackage as { version: string }).version}`;

type Style = { name: string; basedOn?: string; outline?: number; numId?: string; ilvl?: number };
type Heading = { level: number; number: string; title: string; anchor: string };
type Img = { contentType: string; data: Uint8Array; alt: string };
type MElement = { type: string; value?: string; children?: MElement[]; [k: string]: unknown };

type Transforms = { transforms: { paragraph(fn: (p: MElement) => MElement): (doc: MElement) => MElement } };

const MARK = String.fromCharCode(0xe000);
const MARK_RE = new RegExp(`${MARK}(\\d+)${MARK}\\s*`);

function readStyles(xml: string): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = m[1].match(/w:styleId="([^"]+)"/)?.[1];
    if (!id) continue;
    const body = m[2];
    const outline = body.match(/<w:outlineLvl w:val="(\d)"/)?.[1];
    const ilvl = body.match(/<w:numPr>[\s\S]*?<w:ilvl w:val="(\d)"[\s\S]*?<\/w:numPr>/)?.[1];
    styles.set(id, {
      name: body.match(/<w:name w:val="([^"]+)"/)?.[1] ?? id,
      basedOn: body.match(/<w:basedOn w:val="([^"]+)"/)?.[1],
      outline: outline === undefined ? undefined : Number(outline),
      numId: body.match(/<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/)?.[1],
      ilvl: ilvl === undefined ? undefined : Number(ilvl),
    });
  }
  return styles;
}

function linkedLevels(xml: string): Map<string, number> {
  const linked = new Map<string, number>();
  for (const m of xml.matchAll(/<w:lvl\b[^>]*w:ilvl="(\d)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
    const style = m[2].match(/<w:pStyle w:val="([^"]+)"/)?.[1];
    if (style && !linked.has(style)) linked.set(style, Number(m[1]));
  }
  return linked;
}

function chain<T>(styles: Map<string, Style>, id: string, pick: (s: Style) => T | undefined): T | undefined {
  const seen = new Set<string>();
  for (let s = styles.get(id); s && !seen.has(id); s = s.basedOn ? styles.get(s.basedOn) : undefined) {
    seen.add(id);
    const v = pick(s);
    if (v !== undefined) return v;
    if (!s.basedOn) break;
    id = s.basedOn;
  }
  return undefined;
}

function textOfElement(e: MElement): string {
  if (e.type === "text") return e.value ?? "";
  if (e.type === "tab") return " ";
  if (e.type === "break") return " ";
  return (e.children ?? []).map(textOfElement).join("");
}

function count(xml: string, re: RegExp): number {
  return xml.match(re)?.length ?? 0;
}

function shapeWarnings(xml: string, comments: string): string[] {
  const w: string[] = [];
  const nComments = count(comments, /<w:comment\b/g) || count(xml, /<w:commentReference\b/g);
  if (nComments) w.push(`${nComments} Word comment${nComments > 1 ? "s were" : " was"} dropped`);
  const main = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const shapes =
    count(main, /<wps:wsp\b/g) +
    Math.max(0, count(main, /<v:(?:shape|rect|oval|roundrect|line|polyline)\b/g) - count(main, /<v:imagedata\b/g));
  if (shapes)
    w.push(`${shapes} shape${shapes > 1 ? "s" : ""} drawn in Word: the drawing is lost, only text labels can survive`);
  const charts = count(main, /<c:chart\b/g);
  if (charts) w.push(`${charts} chart${charts > 1 ? "s" : ""}: not converted (no picture)`);
  const objects = count(main, /<w:object\b/g);
  if (objects) w.push(`${objects} embedded object${objects > 1 ? "s" : ""}: only their preview picture survives`);
  return w;
}

type Item = { node: HNode; img: boolean; text: string; caption?: { num: string; text: string; whole: boolean } };

function collectItems(root: HNode): Item[] {
  const items: Item[] = [];
  const imgs = (n: HNode) => {
    for (const c of n.children) {
      if (c.tag === "img") items.push({ node: c, img: true, text: "" });
      else if (c.tag !== "ul" && c.tag !== "ol") imgs(c);
    }
  };
  const walk = (n: HNode) => {
    for (const c of n.children) {
      if (c.tag === "img") items.push({ node: c, img: true, text: "" });
      else if (/^(p|li|h[1-6])$/.test(c.tag)) {
        imgs(c);
        const own = c.children.filter((x) => x.tag !== "ul" && x.tag !== "ol");
        const text = cleanSpaces(own.map(textOf).join("")).trim().replace(MARK_RE, "");
        if (text) items.push({ node: c, img: false, text });
        for (const x of c.children) if (x.tag === "ul" || x.tag === "ol") walk(x);
      } else walk(c);
    }
  };
  walk(root);
  for (const it of items) {
    if (it.img || it.text.includes("....")) continue;
    const whole = it.text.length <= 300 ? it.text.match(CAPTION_RE) : null;
    if (whole) it.caption = { num: whole[1], text: it.text, whole: true };
    else {
      const tail = it.text.match(TRAILING_CAPTION_RE);
      if (tail) it.caption = { num: tail[2], text: tail[1].trim(), whole: false };
    }
  }
  return items;
}

type Plan = {
  byImg: Map<HNode, { key: string; caption: string }>;
  dropped: Set<HNode>;
  orphans: Map<HNode, { key: string; caption: string }>;
};

function planFigures(items: Item[]): Plan {
  const used = new Set<string>();
  const keys = new Map<Item, string>();
  for (const it of items) if (it.caption) keys.set(it, uniqueKey(used, it.caption.num));
  const claimed = new Set<Item>();
  const plan: Plan = { byImg: new Map(), dropped: new Set(), orphans: new Map() };
  let order = 0;
  items.forEach((it, i) => {
    if (!it.img) return;
    order++;
    let cap: Item | undefined;
    for (let j = i + 1; j < items.length && !items[j].img; j++)
      if (items[j].text) {
        if (items[j].caption?.whole && !claimed.has(items[j])) cap = items[j];
        break;
      }
    if (!cap)
      for (let j = i - 1; j >= 0 && !items[j].img; j--)
        if (items[j].text) {
          if (items[j].caption?.whole && !claimed.has(items[j])) cap = items[j];
          break;
        }
    if (cap) {
      claimed.add(cap);
      if (cap.node.tag === "p") plan.dropped.add(cap.node);
      plan.byImg.set(it.node, { key: keys.get(cap)!, caption: cap.caption!.text });
    } else plan.byImg.set(it.node, { key: uniqueKey(used, `f${order}`), caption: it.node.attrs.alt ?? "" });
  });
  for (const it of items)
    if (it.caption && !claimed.has(it) && (it.node.tag === "p" || it.node.tag === "li"))
      plan.orphans.set(it.node, { key: keys.get(it)!, caption: it.caption.text });
  return plan;
}

function imageLine(caption: string, file: string, key: string): string {
  return `![${caption.replace(/[[\]]/g, (c) => `\\${c}`)}](${file}) <!-- fig ${key} -->`;
}

export async function convertDocx(buf: Uint8Array, opts: ConvertOpts): Promise<Converted> {
  const zip = readZip(buf);
  const part = (name: string) => {
    const b = zip.get(name);
    return b ? new TextDecoder().decode(b) : "";
  };
  const documentXml = part("word/document.xml");
  if (!documentXml) throw new Error("Not a Word document (word/document.xml is missing).");
  const styles = readStyles(part("word/styles.xml"));
  const linked = linkedLevels(part("word/numbering.xml"));
  const warnings = shapeWarnings(documentXml, part("word/comments.xml"));

  const levelOf = (styleId: string | null): number => {
    if (!styleId) return 0;
    const name = styles.get(styleId)?.name ?? styleId;
    if (/^(toc|table of figures|caption|title|subtitle)/i.test(name)) return 0;
    const named = name.match(/^heading\s*(\d)$/i);
    const outline = chain(styles, styleId, (s) => s.outline);
    if (outline === undefined && !named) return 0;
    if (linked.has(styleId)) return linked.get(styleId)! + 1;
    const numId = chain(styles, styleId, (s) => s.numId);
    const ilvl = chain(styles, styleId, (s) => s.ilvl);
    if (numId && numId !== "0" && ilvl !== undefined) return ilvl + 1;
    return outline !== undefined ? outline + 1 : Number(named![1]);
  };

  const reqs = reqRegex(opts.reqPatterns);
  const reqOnly = new RegExp(`^(?:${reqs.source})\\s*:?$`);
  const headings: Heading[] = [];
  const counters: number[] = [];
  const slugs = new Set<string>();
  const transform = (mammoth as unknown as Transforms).transforms.paragraph((p: MElement) => {
    const styleId = (p.styleId as string | null) ?? null;
    const name = (p.styleName as string | null) ?? "";
    if (/^(toc \d|table of figures)/i.test(name) || /^TOC\d/i.test(styleId ?? "")) return { ...p, children: [] };
    const styleLevel = levelOf(styleId);
    if (!styleLevel) return p;
    const numbering = p.numbering as { level?: string } | null;
    const level = numbering?.level !== undefined ? Number(numbering.level) + 1 : styleLevel;
    const text = cleanSpaces(textOfElement(p)).trim();
    if (!text) return { ...p, children: [] };
    if (reqOnly.test(text)) return { ...p, styleName: "Testimus Req" };
    const written = text.match(/^(\d{1,3}(?:\.\d{1,3}){0,8})\.?\s+(\S.*)$/);
    const numbered = linked.has(styleId!)
      ? p.numbering != null
      : p.numbering != null || !!chain(styles, styleId!, (s) => (s.numId && s.numId !== "0" ? s.numId : undefined));
    let number = "";
    let title = text;
    let lvl = level;
    if (written) {
      const parts = written[1].split(".").map(Number);
      number = written[1];
      title = written[2];
      lvl = parts.length;
      counters.length = 0;
      counters.push(...parts);
    } else if (numbered) {
      counters.length = Math.min(counters.length, level);
      while (counters.length < level) counters.push(0);
      counters[level - 1]++;
      number = counters.map((c) => c || 1).join(".");
    }
    const anchor = uniqueKey(slugs, number || slug(title));
    headings.push({ level: lvl, number, title, anchor });
    const marker: MElement = { type: "text", value: `${MARK}${headings.length - 1}${MARK}` };
    return { ...p, styleName: `Testimus H${Math.min(lvl, 6)}`, children: [marker, ...(p.children ?? [])] };
  });

  const imgs: Img[] = [];
  const styleMap = [
    ...[1, 2, 3, 4, 5, 6].map((l) => `p[style-name='Testimus H${l}'] => h${l}:fresh`),
    "p[style-name='Testimus Req'] => p.tm-req:fresh",
  ];
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(buf) },
    {
      styleMap,
      transformDocument: transform,
      convertImage: mammoth.images.imgElement(async (image) => {
        const data = new Uint8Array(await image.readAsArrayBuffer());
        imgs.push({ contentType: image.contentType, data, alt: "" });
        return { src: `tm-img:${imgs.length - 1}` };
      }),
    },
  );
  for (const m of result.messages) if (m.type === "error") warnings.push(`mammoth: ${m.message}`);

  const root = parseHtml(result.value);
  const plan = planFigures(collectItems(root));
  const pdfPool = opts.pdfFigures ? [...opts.pdfFigures] : null;
  const fromPdf = (key: string, caption: string): Figure | undefined => {
    const num = key.split("-")[0];
    const i = pdfPool?.findIndex((f) => f.key.split("-")[0] === num && sameCaption(f.caption, caption)) ?? -1;
    return i >= 0 ? pdfPool!.splice(i, 1)[0] : undefined;
  };
  const figures: Figure[] = [];
  const recovered: string[] = [];
  const missing: string[] = [];
  const metafiles: string[] = [];

  const image = (n: HNode): string => {
    const idx = Number((n.attrs.src ?? "").replace("tm-img:", ""));
    const img = imgs[idx];
    const fig = plan.byImg.get(n);
    if (!img || !fig) return "";
    const ext = extOf(img.contentType);
    if (ext === "emf" || ext === "wmf") metafiles.push(`${fig.key} (.${ext})`);
    figures.push({ key: fig.key, caption: fig.caption, ext, data: img.data });
    return imageLine(fig.caption, `figures/fig-${fig.key}.${ext}`, fig.key);
  };

  const heading = (n: HNode): Block | null => {
    const raw = textOf(n);
    const m = raw.match(MARK_RE);
    const h = m ? headings[Number(m[1])] : undefined;
    if (!h) {
      const md = normalizeLine(inline(n.children, { image })).replace(/\n/g, " ");
      return md ? { kind: "para", md, text: md } : null;
    }
    const hashes = "#".repeat(Math.min(h.level + 1, 6));
    const md = `${hashes} ${h.number ? `${h.number} ` : ""}${h.title} <!-- § ${h.anchor} -->`;
    const extra = n.children.some((c) => c.tag === "img")
      ? inline(
          n.children.filter((c) => c.tag === "img"),
          { image },
        )
      : "";
    return { kind: "heading", md: extra ? `${md}\n\n${extra}` : md, text: h.title };
  };

  const paragraph = (n: HNode): Block | null | undefined => {
    if (plan.dropped.has(n)) {
      const md = normalizeLine(
        inline(
          n.children.filter((c) => c.tag === "img"),
          { image },
        ),
      );
      return md ? { kind: "image", md, text: "" } : null;
    }
    if ((n.attrs.class ?? "").includes("tm-req")) {
      const id = cleanSpaces(textOf(n)).trim().replace(/\s*:$/, "");
      return { kind: "para", md: `**${id}**`, text: id };
    }
    return undefined;
  };

  const decorate = (n: HNode, md: string): string => {
    const orphan = plan.orphans.get(n);
    if (!orphan) return md;
    const pdf = fromPdf(orphan.key, orphan.caption);
    if (pdf) {
      recovered.push(orphan.key);
      figures.push({ ...pdf, key: orphan.key, caption: orphan.caption });
      return `${md}\n\n${imageLine(orphan.caption, `figures/fig-${orphan.key}.${pdf.ext}`, orphan.key)}`;
    }
    missing.push(orphan.key);
    return `${md} <!-- fig ${orphan.key} -->`;
  };

  const blocks = renderBlocks(root.children, { image, heading, paragraph, decorate });
  const firstHeading = blocks.findIndex((b) => b.kind === "heading");
  const front = blocks.slice(0, firstHeading < 0 ? 12 : Math.min(firstHeading, 40));
  const frontText = front.map((b) => b.text).join("\n");
  const core = part("docProps/core.xml");
  const title =
    guessTitle(front.filter((b) => b.kind === "para").map((b) => b.text)) ||
    core.match(/<dc:title>([^<]*)</)?.[1] ||
    "";
  const date = guessDate(frontText) || core.match(/<dcterms:modified[^>]*>(\d{4}-\d{2}-\d{2})/)?.[1] || "";

  if (metafiles.length)
    warnings.push(
      `${metafiles.length} Windows metafile picture${metafiles.length > 1 ? "s" : ""} kept as is, not rendered to PNG: figure ${metafiles.join(", ")}`,
    );
  if (recovered.length)
    warnings.push(`Figure ${recovered.join(", ")}: picture missing in the .docx, taken from the .pdf`);
  if (missing.length)
    warnings.push(
      `Figure ${missing.join(", ")}: caption without a picture in the .docx (drawn shape, table or pasted text)${pdfPool ? " and not found in the .pdf" : " — add the .pdf to recover them"}`,
    );

  const md = assemble(`# ${opts.code} — ${title || opts.code}`, blocks, reqs);
  return { md, figures, warnings, meta: { title, date }, convertedWith: MAMMOTH };
}
