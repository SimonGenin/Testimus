import type { ReactNode } from "react";
import { fileUrl } from "../../api.ts";
import { Chip } from "../../components/legacy/index.ts";

const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();
const squeeze = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const isTable = (b: string) => /^\|/.test(b);

// ponytail: the converter escapes [ and ] in captions and may leave a picture inside a paragraph (a Word image anchored
// in the text), so the picture is found anywhere in the block, with the fig marker that follows it
const IMG = /!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)[^)]*\)(?:\s*<!--\s*fig\s+([\w-]+)\s*-->)?/g;
const unbracket = (s: string) => s.replace(/\\([[\]\\])/g, "$1");

type Piece = { text: string } | { alt: string; src: string; fig?: string };

function pieces(raw: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of raw.matchAll(IMG)) {
    const text = clean(raw.slice(last, m.index));
    if (text) out.push({ text });
    out.push({ alt: unbracket(m[1]), src: m[2], fig: m[3] });
    last = m.index + m[0].length;
  }
  const text = clean(raw.slice(last));
  if (text) out.push({ text });
  return out;
}

// ponytail: the block (or table row, "i:j") where the quote starts, found on the squeezed text of the whole part the way
// the core finds it — a quote may run over several paragraphs or sit in a table cell
function hotOf(blocks: string[], focus?: string): string | null {
  const q = focus ? squeeze(focus) : "";
  if (!q) return null;
  const units = blocks.flatMap((b, i) => (isTable(b) ? b.split("\n").map((l, j) => [`${i}:${j}`, l]) : [[`${i}`, b]]));
  let joined = "";
  const starts: [number, string][] = [];
  for (const [key, text] of units) {
    const s = squeeze(text);
    if (!s) continue;
    starts.push([joined.length, key]);
    joined += `${s} `;
  }
  let at = joined.indexOf(q);
  if (at < 0) at = joined.indexOf(q.slice(0, 60));
  if (at < 0) return null;
  let hot: string | null = null;
  for (const [s, key] of starts) if (s <= at) hot = key;
  return hot;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={k++}>{m[1]}</strong> : <em key={k++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function DocText({
  docId,
  md,
  focus,
  onFigure,
}: {
  docId: string;
  md: string;
  focus?: string;
  onFigure: (anchor: string) => void;
}) {
  const raws = md.split(/\n{2,}/).filter((b) => clean(b));
  const hotKey = hotOf(raws.map(clean), focus);
  const figure = (p: { alt: string; src: string; fig?: string }, key: number, hot: boolean) => (
    <figure key={key} className={hot ? "passage-fig is-focus" : "passage-fig"}>
      <img src={fileUrl(`docs/${docId}/${p.src}`)} alt={p.alt} />
      <figcaption className="muted">
        {p.fig ? (
          <button type="button" className="linkbtn" onClick={() => onFigure(`fig:${p.fig}`)}>
            {p.alt}
          </button>
        ) : (
          p.alt
        )}
      </figcaption>
    </figure>
  );
  return (
    <div className="doctext">
      {raws.map((raw, i) => {
        const b = clean(raw);
        const hot = hotKey === `${i}`;
        const head = b.match(/^(#{1,6})\s+(.*)$/);
        if (head && !b.includes("\n"))
          return (
            <h4 key={i} className={hot ? "h doctext-h is-focus" : "h doctext-h"} data-level={head[1].length}>
              {head[2]}
            </h4>
          );
        const parts = isTable(b) ? [] : pieces(raw);
        const only = parts.length === 1 ? parts[0] : null;
        if (only && "src" in only) return figure(only, i, hot);
        if (isTable(b))
          return (
            <pre key={i} className="doctext-table">
              {b.split("\n").map((row, j) => (
                <span key={j} className={hotKey === `${i}:${j}` ? "doctext-row is-focus" : "doctext-row"}>
                  {row}
                </span>
              ))}
            </pre>
          );
        return (
          <div key={i} className={hot ? "doctext-p is-focus" : "doctext-p"}>
            {parts.map((p, j) => ("src" in p ? figure(p, j, false) : <p key={j}>{inline(p.text)}</p>))}
          </div>
        );
      })}
      {!raws.length && <p className="muted">This part of the document is empty.</p>}
    </div>
  );
}

export function FigureChip({ caption, onClick }: { caption: string; onClick: () => void }) {
  return (
    <Chip icon="image" onClick={onClick}>
      {caption}
    </Chip>
  );
}
