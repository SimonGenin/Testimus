import type { HNode } from "./convert-html.ts";
import {
  type Box,
  type Entry,
  joinRuns,
  norm,
  type Pic,
  para,
  type Run,
  type Shot,
  TOC_RE,
  text,
  union,
} from "./pdf-tags-read.ts";

export type SNode = { role?: string; type?: string; id?: string; alt?: string; bbox?: number[]; children?: SNode[] };

const PARA = /^(P|Caption|Note|BlockQuote|Quote|Span|Link|Reference|Code|Lbl|LBody|Title|BibEntry|Annot|Form)$/;
const INLINE = /^(Span|Link|Reference|Quote|Code|Lbl|Annot|Form|BibEntry|Ruby|Warichu|Em|Strong|Sub)?$/;
const block = (c: SNode) => !c.type && !INLINE.test(c.role ?? "");

// ponytail: the page's structure tree as HTML-like nodes — headings, paragraphs, lists, tables, figures — each with
// the box its text covers on the page; the table of contents entries it meets go to toc
export function structure(tree: SNode | null, runs: Map<string, Run>, pics: Pic[], toc: Entry[]) {
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

  return { nodes: tree ? blocks(tree) : [], shots, boxes, nodeIds };
}
