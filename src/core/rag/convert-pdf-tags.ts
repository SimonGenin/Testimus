import { sha256 } from "../lib/hash.ts";
import {
  assemble,
  type Converted,
  type ConvertOpts,
  type Figure,
  guessDate,
  guessTitle,
  slug,
  uniqueKey,
} from "./convert.ts";
import { besideTables, collectItems, imageLine, planFigures } from "./convert-docx.ts";
import { type Block, type HNode, renderBlocks } from "./convert-html.ts";
import { PDFJS, withPdf } from "./pdf.ts";
import { joinPages, numberHeadings } from "./pdf-tags-headings.ts";
import { readPage } from "./pdf-tags-page.ts";
import { type Entry, norm, outlineEntries, partsOf, type Shot } from "./pdf-tags-read.ts";

export async function convertTaggedPdf(buf: Uint8Array, opts: ConvertOpts): Promise<Converted | null> {
  return withPdf(buf, async (doc) => {
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
      const crop = opts.crops?.get(orphan.key);
      if (crop) {
        figures.push({ ...crop, key: orphan.key, caption: orphan.caption });
        return `${md}\n\n${imageLine(orphan.caption, `figures/fig-${orphan.key}.${crop.ext}`, orphan.key)}`;
      }
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
  });
}
