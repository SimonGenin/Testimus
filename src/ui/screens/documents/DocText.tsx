import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Marked } from "../../components/ui/Marked.tsx";
import { type } from "../../components/ui/type.ts";
import { fileUrl } from "../../lib/data/client.ts";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  text: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    maxWidth: `calc(${size.reading} + ${space.s11} + ${space.s8} + ${space.s5})`,
    color: color.text,
  },
  row: {
    display: "grid",
    gridTemplateColumns: `calc(${space.s11} + ${space.s8}) minmax(0, 1fr)`,
    columnGap: space.s5,
    alignItems: "baseline",
    margin: 0,
  },
  gutter: { justifySelf: "end", color: color.textSubtle, whiteSpace: "nowrap" },
  block: { minWidth: 0 },
  figRow: { alignItems: "start" },
  heading: { marginTop: space.s4 },
  para: { margin: 0 },
  focus: { backgroundColor: color.highlight, color: color.highlightText, borderRadius: radius.r1 },
  target: {
    backgroundColor: color.surfaceSelected,
    borderRadius: radius.r1,
    boxShadow: `0 0 0 ${space.s3} ${color.surfaceSelected}`,
  },
  targetGutter: {
    color: color.textLink,
    backgroundColor: color.accentSubtle,
    borderRadius: radius.r1,
    paddingInline: space.s1,
  },
  figure: { margin: 0, display: "flex", flexDirection: "column", gap: space.s2, alignItems: "flex-start" },
  img: {
    boxSizing: "border-box",
    maxWidth: `min(100%, calc(${size.sidebar} + ${space.s11}))`,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  caption: { display: "flex", alignItems: "center", gap: space.s2, color: color.textMuted },
  table: { margin: 0, overflowX: "auto", color: color.text },
  tableRow: { display: "block", whiteSpace: "pre" },
  empty: { margin: 0, color: color.textMuted },
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

const plain = (s: string): ReactNode => s;
const lit = (s: string, k: number): ReactNode => <Marked key={k} text={s} marks={[[0, s.length]]} look="quote" />;

function inline(text: string, words: (s: string, k: number) => ReactNode = plain): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(words(text.slice(last, m.index), k++));
    out.push(m[1] ? <strong key={k++}>{words(m[1], k++)}</strong> : <em key={k++}>{words(m[2], k++)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(words(text.slice(last), k++));
  return out;
}

const focusMark = (hot: boolean) => (hot ? { "data-focus": "" } : {});

// ponytail: where the quote starts in a paragraph and where it ends there (it may run on into the next ones), found on
// the text squeezed the way hotOf squeezes it, then mapped back onto the raw text
function quoteIn(text: string, quote: string): [number, number] | null {
  const q = squeeze(quote);
  if (!q) return null;
  let norm = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "*") continue;
    if (/\s/.test(c)) {
      if (!norm || norm.endsWith(" ")) continue;
      norm += " ";
    } else norm += c.toLowerCase();
    at.push(i);
  }
  const whole = norm.indexOf(q);
  if (whole >= 0) return [at[whole], at[whole + q.length - 1] + 1];
  for (let i = 0; i < norm.length; i++)
    if (norm[i] !== " " && q.startsWith(norm.slice(i).trimEnd())) return [at[i], text.length];
  return null;
}

function marked(text: string, quote: string | undefined): ReactNode[] | null {
  const span = quote ? quoteIn(text, quote) : null;
  if (!span) return null;
  const [from, to] = span;
  return [
    ...inline(text.slice(0, from)),
    <span key="quote" data-focus="">
      {inline(text.slice(from, to), lit)}
    </span>,
    ...inline(text.slice(to)),
  ];
}

// ponytail: a part of doc.md as React elements (never raw HTML), in the reading font, its anchors in a gutter
export function DocText({
  docId,
  md,
  focus,
  target,
  onFigure,
}: {
  docId: string;
  md: string;
  focus?: string;
  /** the anchor a link opened (§5.6.6, fig:40): its heading or figure is set apart, its key lit in the gutter */
  target?: string;
  onFigure: (anchor: string) => void;
}) {
  const raws = md.split(/\n{2,}/).filter((b) => clean(b));
  const hotKey = hotOf(raws.map(clean), focus);
  const picture = (p: Picture, key: number, hot: boolean) => (
    <figure key={key} {...focusMark(hot)} {...stylex.props(styles.figure, hot && styles.focus)}>
      <img src={fileUrl(`docs/${docId}/${p.src}`)} alt={p.alt} {...stylex.props(styles.img)} />
      <figcaption {...stylex.props(type.small, styles.caption)}>
        {p.alt && <span>{p.alt}</span>}
        {p.fig && (
          <Button
            size="xs"
            variant="quiet"
            iconOnly
            icon="image"
            label={`Show ${p.alt || `fig ${p.fig}`} in Figures`}
            onClick={() => onFigure(`fig:${p.fig}`)}
          />
        )}
      </figcaption>
    </figure>
  );
  return (
    <div data-testid="doc-text" {...stylex.props(type.reading, styles.text)}>
      {raws.map((raw, i) => {
        const b = clean(raw);
        const hot = hotKey === `${i}`;
        const head = b.match(/^(#{1,6})\s+(.*)$/);
        if (head && !b.includes("\n")) {
          const numbered = head[2].match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
          const on = !!numbered && target === `§${numbered[1]}`;
          return (
            <h4
              key={i}
              data-level={head[1].length}
              data-target={on || undefined}
              {...focusMark(hot)}
              {...stylex.props(type.readingHeading, styles.row, styles.heading, hot && styles.focus)}
            >
              <span {...stylex.props(type.code, styles.gutter, on && styles.targetGutter)}>
                {numbered && (
                  <>
                    <span aria-hidden="true">§ </span>
                    {numbered[1]}
                  </>
                )}
              </span>{" "}
              <span {...stylex.props(styles.block, on && styles.target)}>{numbered ? numbered[2] : head[2]}</span>
            </h4>
          );
        }
        if (isTable(b))
          return (
            <div key={i} {...stylex.props(styles.row)}>
              <span {...stylex.props(type.code, styles.gutter)} />
              <pre {...stylex.props(type.code, styles.table)}>
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
        if (only && "src" in only) {
          const on = !!only.fig && target === `fig:${only.fig}`;
          return (
            <div key={i} data-target={on || undefined} {...stylex.props(styles.row, styles.figRow)}>
              <span aria-hidden="true" {...stylex.props(type.code, styles.gutter, on && styles.targetGutter)}>
                {only.fig ? `fig ${only.fig}` : ""}
              </span>
              <span {...stylex.props(styles.block, on && styles.target)}>{picture(only, i, hot)}</span>
            </div>
          );
        }
        let quoted = false;
        const texts = parts.map((p) => {
          if (!hot || quoted || "src" in p) return null;
          const m = marked(p.text, focus);
          if (m) quoted = true;
          return m;
        });
        return (
          <div key={i} {...stylex.props(styles.row)}>
            <span {...stylex.props(type.code, styles.gutter)} />
            <div {...focusMark(hot && !quoted)} {...stylex.props(styles.block, hot && !quoted && styles.focus)}>
              {parts.map((p, j) =>
                "src" in p ? (
                  picture(p, j, false)
                ) : (
                  <p key={j} {...stylex.props(styles.para)}>
                    {texts[j] ?? inline(p.text)}
                  </p>
                ),
              )}
            </div>
          </div>
        );
      })}
      {!raws.length && <p {...stylex.props(type.body, type.ui, styles.empty)}>This part of the document is empty.</p>}
    </div>
  );
}
