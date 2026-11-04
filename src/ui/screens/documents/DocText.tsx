import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { fileUrl } from "../../lib/data/client.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  text: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    maxWidth: `calc(${size.reading} + ${size.thumb})`,
    fontFamily: fontFamily.reading,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.reading,
    color: color.text,
  },
  row: {
    display: "grid",
    gridTemplateColumns: `${size.thumb} minmax(0, 1fr)`,
    columnGap: space.s5,
    alignItems: "baseline",
    margin: 0,
  },
  gutter: {
    justifySelf: "end",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    fontWeight: fontWeight.regular,
    color: color.textSubtle,
    whiteSpace: "nowrap",
  },
  block: { minWidth: 0 },
  figRow: { alignItems: "start" },
  heading: {
    fontSize: fontSize.readingHeading,
    lineHeight: lineHeight.readingHeading,
    fontWeight: fontWeight.semibold,
    marginTop: space.s4,
  },
  para: { margin: 0 },
  focus: { backgroundColor: color.highlight, color: color.highlightText, borderRadius: radius.r1 },
  figure: { margin: 0, display: "flex", flexDirection: "column", gap: space.s2, alignItems: "flex-start" },
  img: {
    maxWidth: "100%",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surface,
  },
  caption: {
    fontFamily: fontFamily.reading,
    fontStyle: "italic",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  table: {
    margin: 0,
    overflowX: "auto",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.text,
  },
  tableRow: { display: "block", whiteSpace: "pre" },
  empty: { margin: 0, color: color.textMuted, fontFamily: fontFamily.ui, fontSize: fontSize.body },
});

const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();
const squeeze = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const isTable = (b: string) => /^\|/.test(b);

// ponytail: the converter escapes [ and ] in captions and may leave a picture inside a paragraph (a Word image anchored
// in the text), so the picture is found anywhere in the block, with the fig marker that follows it
const IMG = /!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)[^)]*\)(?:\s*<!--\s*fig\s+([\w-]+)\s*-->)?/g;
const unbracket = (s: string) => s.replace(/\\([[\]\\])/g, "$1");

type Picture = { alt: string; src: string; fig?: string };
type Piece = { text: string } | Picture;

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

const focusMark = (hot: boolean) => (hot ? { "data-focus": "" } : {});

// ponytail: a part of doc.md as React elements (never raw HTML), in the reading font, its anchors in a gutter
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
  const picture = (p: Picture, key: number, hot: boolean) => (
    <figure key={key} {...focusMark(hot)} {...stylex.props(styles.figure, hot && styles.focus)}>
      <img src={fileUrl(`docs/${docId}/${p.src}`)} alt={p.alt} {...stylex.props(styles.img)} />
      <figcaption {...stylex.props(styles.caption)}>
        {p.fig ? <Button size="sm" variant="quiet" label={p.alt} onClick={() => onFigure(`fig:${p.fig}`)} /> : p.alt}
      </figcaption>
    </figure>
  );
  return (
    <div data-testid="doc-text" {...stylex.props(styles.text)}>
      {raws.map((raw, i) => {
        const b = clean(raw);
        const hot = hotKey === `${i}`;
        const head = b.match(/^(#{1,6})\s+(.*)$/);
        if (head && !b.includes("\n")) {
          const numbered = head[2].match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
          return (
            <h4
              key={i}
              data-level={head[1].length}
              {...focusMark(hot)}
              {...stylex.props(styles.row, styles.heading, hot && styles.focus)}
            >
              <span {...stylex.props(styles.gutter)}>
                {numbered && (
                  <>
                    <span aria-hidden="true">§ </span>
                    {numbered[1]}
                  </>
                )}
              </span>{" "}
              <span {...stylex.props(styles.block)}>{numbered ? numbered[2] : head[2]}</span>
            </h4>
          );
        }
        if (isTable(b))
          return (
            <div key={i} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.gutter)} />
              <pre {...stylex.props(styles.table)}>
                {b.split("\n").map((line, j) => {
                  const on = hotKey === `${i}:${j}`;
                  return (
                    <span key={j} {...focusMark(on)} {...stylex.props(styles.tableRow, on && styles.focus)}>
                      {line}
                    </span>
                  );
                })}
              </pre>
            </div>
          );
        const parts = pieces(raw);
        const only = parts.length === 1 ? parts[0] : null;
        if (only && "src" in only)
          return (
            <div key={i} {...stylex.props(styles.row, styles.figRow)}>
              <span aria-hidden="true" {...stylex.props(styles.gutter)}>
                {only.fig ? `fig ${only.fig}` : ""}
              </span>
              {picture(only, i, hot)}
            </div>
          );
        return (
          <div key={i} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.gutter)} />
            <div {...focusMark(hot)} {...stylex.props(styles.block, hot && styles.focus)}>
              {parts.map((p, j) =>
                "src" in p ? (
                  picture(p, j, false)
                ) : (
                  <p key={j} {...stylex.props(styles.para)}>
                    {inline(p.text)}
                  </p>
                ),
              )}
            </div>
          </div>
        );
      })}
      {!raws.length && <p {...stylex.props(styles.empty)}>This part of the document is empty.</p>}
    </div>
  );
}
