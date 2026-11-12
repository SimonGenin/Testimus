import type { Source } from "../../core/types.ts";

// ponytail: the one reading of the Markdown Claude writes (an answer, the overview, a diagnosis) — blocks and inline
// pieces as data, drawn by components/claude/Markdown.tsx as React elements, never as HTML. What it knows: headings #
// to ### (deeper ones read as ###), paragraphs, **bold**, *italic*, bullet and numbered lists one level deep, `code`
// and fenced blocks, | tables, [links](https://…), > quotes, --- rules; and every docId#anchor "quote" is a source

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "source"; source: Source };

export type ListItem = { text: string; children?: ListBlock };
export type ListBlock = { kind: "list"; ordered: boolean; start: number; items: ListItem[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "para"; text: string }
  | ListBlock
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "rule" };

const REF =
  /\[?([A-Za-z0-9][A-Za-z0-9_.-]*)#((?:§|fig:|img:|frame:|t:)[^\s"),;\]]*[^\s"),;.\]])\]?(?:\s+"([^"\n]*)"\]?)?/g;

export function parseAnswer(text: string): Array<string | Source> {
  const out: Array<string | Source> = [];
  let last = 0;
  for (const m of text.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ docId: m[1], anchor: m[2], quote: m[3] ?? "" });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const sameSource = (a: Source, b: Source) => a.docId === b.docId && a.anchor === b.anchor && a.quote === b.quote;

// the sources a text cites, each once, in order
export function sourcesOf(text: string): Source[] {
  const out: Source[] = [];
  for (const x of parseAnswer(text)) if (typeof x !== "string" && !out.some((s) => sameSource(s, x))) out.push(x);
  return out;
}

const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());

const isTableStart = (lines: string[], i: number) =>
  lines[i].includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-");

// ponytail: one level of nesting — an item indented by 2 or more under another is its child; deeper indents stay at
// that level, a line that is no item continues the item before it (Claude often wraps a long item)
function parseList(lines: string[], from: number): { list: ListBlock; next: number } {
  const first = ITEM.exec(lines[from]) as RegExpExecArray;
  const ordered = first[3] !== undefined;
  const list: ListBlock = { kind: "list", ordered, start: ordered ? Number(first[3]) : 1, items: [] };
  const base = first[1].length;
  let i = from;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      const after = lines.slice(i + 1).find((l) => l.trim());
      const m = after ? ITEM.exec(after) : null;
      if (m && (m[1].length > base || (m[3] !== undefined) === ordered)) continue;
      break;
    }
    const m = ITEM.exec(line);
    const last = list.items[list.items.length - 1];
    if (m && m[1].length >= base + 2 && last) {
      const ord = m[3] !== undefined;
      if (!last.children) last.children = { kind: "list", ordered: ord, start: ord ? Number(m[3]) : 1, items: [] };
      last.children.items.push({ text: m[4] });
      continue;
    }
    if (m) {
      if ((m[3] !== undefined) !== ordered) break;
      list.items.push({ text: m[4] });
      continue;
    }
    if (FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line)) break;
    const into = last?.children ? last.children.items[last.children.items.length - 1] : last;
    if (!into) break;
    into.text = `${into.text}\n${line.trim()}`;
  }
  return { list, next: i };
}

export function parseBlocks(md: string): Block[] {
  const lines = md
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ kind: "heading", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        const q = QUOTE.exec(lines[i]);
        body.push(q ? q[1] : lines[i]);
        i++;
      }
      out.push({ kind: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push({ kind: "table", head, rows: rows.map((r) => head.map((_, k) => r[k] ?? "")) });
      continue;
    }
    if (ITEM.test(line)) {
      const { list, next } = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !ITEM.test(lines[i]) &&
      !isTableStart(lines, i)
    )
      para.push(lines[i++].trim());
    out.push({ kind: "para", text: para.join("\n") });
  }
  return out;
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

// ponytail: a delimiter closes only on the same delimiter, not across a line break of a paragraph's text; `_` only
// between non-letters (snake_case and file_names stay words), `*` only against a non-space
function closing(text: string, from: number, mark: string): number {
  for (let k = from; k <= text.length - mark.length; k++) {
    if (text[k] === "`") {
      const end = text.indexOf("`", k + 1);
      if (end > 0) k = end;
      continue;
    }
    if (!text.startsWith(mark, k)) continue;
    if (/\s/.test(text[k - 1] ?? " ")) continue;
    if (mark.length === 1 && text[k + 1] === mark) {
      k++;
      continue;
    }
    if (mark === "_" && word(text[k + 1])) continue;
    return k;
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "[" || /[A-Za-z0-9]/.test(c)) {
      const ref = new RegExp(REF.source, "y");
      ref.lastIndex = i;
      const m = !word(text[i - 1]) || c === "[" ? ref.exec(text) : null;
      if (m) {
        flush();
        out.push({ kind: "source", source: { docId: m[1], anchor: m[2], quote: m[3] ?? "" } });
        i += m[0].length;
        continue;
      }
    }
    if (c === "[") {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (link) {
        flush();
        out.push(
          SAFE_LINK.test(link[2]) ? { kind: "link", href: link[2], text: link[1] } : { kind: "text", text: link[1] },
        );
        i += link[0].length;
        continue;
      }
    }
    const mark = text.startsWith("**", i) ? "**" : text.startsWith("__", i) ? "__" : c === "*" || c === "_" ? c : "";
    if (mark && !/\s/.test(text[i + mark.length] ?? " ") && !(mark[0] === "_" && word(text[i - 1]))) {
      const end = closing(text, i + mark.length + 1, mark);
      if (end > 0 && !text.slice(i, end).includes("\n\n")) {
        flush();
        const children = parseInline(text.slice(i + mark.length, end));
        out.push(mark.length === 2 ? { kind: "strong", children } : { kind: "em", children });
        i = end + mark.length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** the text of a piece of Markdown without its marks: a link's or a heading's words */
export function plainText(inlines: Inline[]): string {
  return inlines
    .map((x) =>
      x.kind === "text" || x.kind === "code" || x.kind === "link"
        ? x.text
        : x.kind === "source"
          ? `${x.source.docId}#${x.source.anchor}`
          : plainText(x.children),
    )
    .join("");
}
