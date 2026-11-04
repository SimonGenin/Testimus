import type { ReactNode } from "react";
import type { Passage as Part } from "../../../core/types.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { Badge, DOC_STATUS } from "../ui/Badge.tsx";
import { Marked } from "../ui/Marked.tsx";
import { Passage } from "../ui/Passage.tsx";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

type Run = { text: string; strong: boolean; em: boolean };

// ponytail: doc.md keeps Word bold/italic as **…** and *…* (converter rule); a lone * followed by a
// space stays a literal star
export function emphasisRuns(md: string): Run[] {
  const out: Run[] = [];
  let strong = false;
  let em = false;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, strong, em });
    buf = "";
  };
  for (let k = 0; k < md.length; k++) {
    if (md.startsWith("**", k) && (strong || md.indexOf("**", k + 2) > 0)) {
      flush();
      strong = !strong;
      k++;
    } else if (md[k] === "*" && (em || (/\S/.test(md[k + 1] ?? "") && md.indexOf("*", k + 1) > 0))) {
      flush();
      em = !em;
    } else buf += md[k];
  }
  flush();
  return out;
}

// ponytail: the quote is found whitespace-normalised (SPEC §6), so the match is made on a squeezed copy
// and mapped back to the original offsets through an index of kept characters
function findQuote(text: string, quote: string): [number, number] | null {
  const q = norm(quote.replace(/\*/g, ""));
  if (!q) return null;
  const keep: number[] = [];
  let squeezed = "";
  for (let i = 0; i < text.length; i++) {
    const c = /\s/.test(text[i]) ? " " : text[i].toLowerCase();
    if (c === " " && (squeezed.endsWith(" ") || !squeezed)) continue;
    squeezed += c;
    keep.push(i);
  }
  const at = squeezed.indexOf(q);
  if (at < 0) return null;
  return [keep[at], keep[at + q.length - 1] + 1];
}

export function highlight(md: string, quote: string): ReactNode[] {
  const runs = emphasisRuns(md);
  const hit = findQuote(runs.map((r) => r.text).join(""), quote);
  const out: ReactNode[] = [];
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    const cuts = hit ? [at, Math.min(Math.max(hit[0], at), end), Math.min(Math.max(hit[1], at), end), end] : [at, end];
    for (let c = 0; c < cuts.length - 1; c++) {
      if (cuts[c] === cuts[c + 1]) continue;
      const piece = r.text.slice(cuts[c] - at, cuts[c + 1] - at);
      const key = out.length;
      let node: ReactNode =
        hit && cuts[c] >= hit[0] && cuts[c + 1] <= hit[1] ? (
          <Marked key={`m${key}`} text={piece} marks={[[0, piece.length]]} look="quote" />
        ) : (
          piece
        );
      if (r.em) node = <em key={`e${key}`}>{node}</em>;
      if (r.strong) node = <strong key={`s${key}`}>{node}</strong>;
      out.push(node);
    }
    at = end;
  }
  return out;
}

export const paragraphs = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[(?:\\.|[^\]\\])*\]\([^)\s]+[^)]*\)/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

// the Documents route of a source; with a quote, `from` names the test (and step) that cites it, for « Back to the test »
export const docLink = (docId: string, anchor: string, quote = "", from?: { test: string; step?: number }) =>
  `${docId}#${anchor}${quote.trim() ? ` "${quote.trim()}"${from ? ` from ${from.test}${from.step ? ` step ${from.step}` : ""}` : ""}` : ""}`;

export const sectionNumber = (anchor: string) => (anchor.startsWith("§") ? anchor.slice(1) : "");

export function DocBadges({ status }: { status: string }) {
  const s = DOC_STATUS[status as keyof typeof DOC_STATUS];
  return s ? <Badge {...s} /> : <Badge tone="neutral" label={status} />;
}

// ponytail: a passage as the document says it — its title with its number, the paragraphs with the quote marked
// (through Word's bold and italic, which the kit's Passage does not read), its figures; the space before the title
// keeps the heading's name « § 5.6.6 Title »
export function PassageText({ passage, quote }: { passage: Part; quote: string }) {
  const num = sectionNumber(passage.anchor);
  const title = num && passage.title.startsWith(`${num} `) ? passage.title.slice(num.length + 1) : passage.title;
  return (
    <Passage
      level={4}
      heading={passage.title ? `${num ? " " : ""}${title}` : undefined}
      anchor={num ? `§ ${num}` : undefined}
      paragraphs={paragraphs(passage.text).map((para) => highlight(para, quote))}
      figures={passage.figures.map((f) => ({
        src: f.file ? fileUrl(`docs/${passage.docId}/${f.file}`) : undefined,
        alt: f.caption || f.file,
        caption: f.caption,
      }))}
    />
  );
}
