export type HNode = { tag: string; attrs: Record<string, string>; children: HNode[]; text?: string };

const VOID = new Set(["img", "br", "hr"]);

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    if (k === "nbsp") return " ";
    return String.fromCodePoint(k.startsWith("#x") ? Number.parseInt(k.slice(2), 16) : Number(k.slice(1)));
  });
}

export function parseHtml(html: string): HNode {
  const root: HNode = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re =
    /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? "").matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
        attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
      const node: HNode = { tag, attrs, children: [] };
      top.children.push(node);
      if (!m[4] && !VOID.has(tag)) stack.push(node);
    } else if (m[5]) {
      top.children.push({ tag: "#text", attrs: {}, children: [], text: decodeEntities(m[5]) });
    }
  }
  return root;
}

export function textOf(n: HNode): string {
  if (n.tag === "#text") return n.text ?? "";
  if (n.tag === "br") return "\n";
  return n.children.map(textOf).join("");
}

export function cleanSpaces(s: string): string {
  return s
    .replace(/­/g, "")
    .replace(/‑/g, "-")
    .replace(/[   \t\r\f\v ]+/g, " ");
}

const MARKS: Record<string, string> = { strong: "**", b: "**", em: "*", i: "*", s: "~~", del: "~~" };

export type InlineOpts = { image(n: HNode): string };

function wrap(inner: string, mark: string): string {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  if (!m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

export function inline(nodes: HNode[], opts: InlineOpts, plain = false): string {
  let out = "";
  for (const n of nodes) {
    if (n.tag === "#text") out += cleanSpaces(n.text ?? "");
    else if (n.tag === "br") out += "\n";
    else if (n.tag === "img") out += opts.image(n);
    else if (n.tag in MARKS && !plain) out += wrap(inline(n.children, opts, plain), MARKS[n.tag]);
    else if (n.tag === "a") {
      const label = inline(n.children, opts, plain);
      const href = n.attrs.href ?? "";
      out += !plain && /^(https?:|mailto:)/i.test(href) && label.trim() ? `[${label.trim()}](${href})` : label;
    } else out += inline(n.children, opts, plain);
  }
  return out.replace(/\*\*\*\*|~~~~/g, "");
}

export function normalizeLine(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trim())
    .filter((l) => l)
    .join("\n");
}

export type Block = { kind: "heading" | "para" | "list" | "table" | "image"; md: string; text: string };

export type RenderOpts = InlineOpts & {
  heading(n: HNode, level: number): Block | null;
  paragraph?(n: HNode): Block | null | undefined;
  decorate?(n: HNode, md: string): string;
};

function listLines(list: HNode, depth: number, opts: RenderOpts, out: string[], texts: string[]): void {
  let k = 0;
  for (const li of list.children) {
    if (li.tag !== "li") continue;
    const own = li.children.filter((c) => c.tag !== "ul" && c.tag !== "ol");
    const text = normalizeLine(inline(own, opts)).replace(/\n/g, " ");
    let d = depth;
    if (text) {
      k++;
      const bullet = list.tag === "ol" ? `${k}.` : "-";
      const md = opts.decorate ? opts.decorate(li, text) : text;
      out.push(`${"  ".repeat(depth)}${bullet} ${md.replace(/\n+/g, `\n${"  ".repeat(depth + 1)}`)}`);
      texts.push(text);
      d = depth + 1;
    }
    for (const c of li.children) if (c.tag === "ul" || c.tag === "ol") listLines(c, d, opts, out, texts);
  }
}

function cellText(cell: HNode, opts: RenderOpts): string {
  const parts: string[] = [];
  const blocks = renderBlocks(cell.children, opts);
  for (const b of blocks) parts.push(b.md.replace(/\n+/g, " <br> "));
  return parts.join(" <br> ").replace(/\|/g, "\\|");
}

function tableBlock(table: HNode, opts: RenderOpts): Block {
  const rows: HNode[] = [];
  const collect = (n: HNode) => {
    for (const c of n.children) {
      if (c.tag === "tr") rows.push(c);
      else if (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot") collect(c);
    }
  };
  collect(table);
  const grid: string[][] = [];
  const pending: { col: number; left: number }[] = [];
  rows.forEach((tr, r) => {
    const line: string[] = [];
    grid[r] = line;
    let col = 0;
    const fillSpans = () => {
      while (pending.some((p) => p.col === col && p.left > 0)) {
        const p = pending.find((q) => q.col === col && q.left > 0)!;
        p.left--;
        line[col++] = "";
      }
    };
    for (const td of tr.children) {
      if (td.tag !== "td" && td.tag !== "th") continue;
      fillSpans();
      const span = Math.max(1, Number(td.attrs.colspan) || 1);
      const rspan = Math.max(1, Number(td.attrs.rowspan) || 1);
      line[col] = cellText(td, opts);
      for (let s = 0; s < span; s++) {
        if (s > 0) line[col + s] = "";
        if (rspan > 1) pending.push({ col: col + s, left: rspan - 1 });
      }
      col += span;
    }
    fillSpans();
  });
  const width = Math.max(1, ...grid.map((l) => l.length));
  const lines = grid.map((l) => `| ${Array.from({ length: width }, (_, i) => l[i] ?? "").join(" | ")} |`);
  if (lines.length === 0) lines.push(`|  |`);
  lines.splice(1, 0, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
  return { kind: "table", md: lines.join("\n"), text: grid.flat().join(" ") };
}

export function renderBlocks(nodes: HNode[], opts: RenderOpts): Block[] {
  const out: Block[] = [];
  let loose: HNode[] = [];
  const flush = () => {
    const md = normalizeLine(inline(loose, opts));
    loose = [];
    if (md) out.push({ kind: md.startsWith("![") ? "image" : "para", md, text: md });
  };
  for (const n of nodes) {
    const h = n.tag.match(/^h([1-6])$/);
    if (h) {
      flush();
      const b = opts.heading(n, Number(h[1]));
      if (b) out.push(b);
    } else if (n.tag === "p" || n.tag === "div" || n.tag === "blockquote") {
      flush();
      const custom = opts.paragraph?.(n);
      if (custom !== undefined) {
        if (custom) out.push(custom);
        continue;
      }
      const raw = normalizeLine(inline(n.children, opts));
      const md = raw && opts.decorate ? opts.decorate(n, raw) : raw;
      if (md) out.push({ kind: /^!\[[^\]]*\]\([^)]*\)( <!--[^>]*-->)?$/.test(md) ? "image" : "para", md, text: raw });
    } else if (n.tag === "ul" || n.tag === "ol") {
      flush();
      const lines: string[] = [];
      const texts: string[] = [];
      listLines(n, 0, opts, lines, texts);
      if (lines.length) out.push({ kind: "list", md: lines.join("\n"), text: texts.join("\n") });
    } else if (n.tag === "table") {
      flush();
      out.push(tableBlock(n, opts));
    } else loose.push(n);
  }
  flush();
  return out;
}
