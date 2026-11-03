import { cleanSpaces, type HNode, textOf } from "./convert-html.ts";
import { type Entry, NUMBER_RE, norm, para, partsOf, text } from "./pdf-tags-read.ts";

const endsSentence = (s: string) => /[.:;!?)»"]\s*$/.test(s);

// ponytail: Word cuts a table or a paragraph at the page end; the reader sees one, so they are joined again
export function joinPages(pages: { n: number; nodes: HNode[] }[]): HNode[] {
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
export function numberHeadings(
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
