import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useRef } from "react";
import { fileUrl } from "../../lib/data/client.ts";
import { useShowMark } from "../../lib/scroll.ts";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Marked } from "../ui/Marked.tsx";
import { type } from "../ui/type.ts";
import { FigureTable } from "./FigureTable.tsx";

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
  bare: { display: "block" },
  gutter: { justifySelf: "end", color: color.textSubtle, whiteSpace: "nowrap" },
  number: { marginInlineEnd: space.s3, color: color.textSubtle },
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
  empty: { margin: 0, color: color.textMuted },
});

const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").trim();
const squeeze = (s: string) => s.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const isTable = (b: string) => /^\|/.test(b);
// ponytail: a body row of a table (not its head, not the rule under it) — FigureTable keys its rows by this line
const isRow = (lines: string[], j: number) => j > 0 && !/^\|?[\s:|-]+$/.test(lines[j]?.trim() ?? "");
// ponytail: a table's name is the caption the converter writes right after it (« Figure 25 – Bouton AA »)
const captionOf = (next?: string) => {
  const c = next && clean(next);
  return c && /^(figure|tableau|table)\b/i.test(c) && !c.includes("\n") ? c.replace(/\*/g, "") : undefined;
};

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

type Run = { text: string; strong: boolean; em: boolean };

// ponytail: doc.md keeps Word bold/italic as **…** and *…* (converter rule); a lone * followed by a space stays a
// literal star
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

// ponytail: the runs between two offsets of their plain text, each in its bold and italic, the quoted ones marked
function slice(runs: Run[], from: number, to: number, quoted: boolean, tag = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(from, at);
    const b = Math.min(to, at + r.text.length);
    if (a < b) {
      const piece = r.text.slice(a - at, b - at);
      const k = `${tag}${out.length}`;
      let node: ReactNode = quoted ? (
        <Marked key={`m${k}`} text={piece} marks={[[0, piece.length]]} look="quote" />
      ) : (
        piece
      );
      if (r.em) node = <em key={`e${k}`}>{node}</em>;
      if (r.strong) node = <strong key={`s${k}`}>{node}</strong>;
      out.push(node);
    }
    at += r.text.length;
  }
  return out;
}

const inline = (text: string) => slice(emphasisRuns(text), 0, Infinity, false);

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

// ponytail: the quote is found on the paragraph's plain text (its emphasis read), so it may start or end inside bold
function marked(text: string, quote: string | undefined): ReactNode[] | null {
  const runs = emphasisRuns(text);
  const span = quote ? quoteIn(runs.map((r) => r.text).join(""), quote) : null;
  if (!span) return null;
  const [from, to] = span;
  return [
    ...slice(runs, 0, from, false),
    <span key="quote" data-focus="">
      {slice(runs, from, to, true)}
    </span>,
    ...slice(runs, to, Infinity, false, "after"),
  ];
}

// ponytail: a part of doc.md as React elements (never raw HTML), in the reading font — headings, paragraphs, tables and
// pictures where the document has them; the reader puts its anchors in a gutter, a passage (a source opened beside a
// test) has no room for one and writes a heading's number before it; whatever reader holds it, the quote or the anchor
// a link points at is scrolled to
export function DocText({
  docId,
  md,
  focus,
  target,
  gutter = true,
  onFigure,
}: {
  docId: string;
  md: string;
  focus?: string;
  /** the anchor a link opened (§5.6.6, fig:40): its heading or figure is set apart, its key lit in the gutter */
  target?: string;
  /** false: no gutter, a heading's number written before its title */
  gutter?: boolean;
  /** with it, a figure's caption offers « Show in Figures » */
  onFigure?: (anchor: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useShowMark(root, [focus, target, md].join("\n"));
  const row = gutter ? styles.row : styles.bare;
  const side = (mark: ReactNode, on = false, hidden = false) =>
    gutter && (
      <span aria-hidden={hidden || undefined} {...stylex.props(type.code, styles.gutter, on && styles.targetGutter)}>
        {mark}
      </span>
    );
  const raws = md.split(/\n{2,}/).filter((b) => clean(b));
  const hotKey = hotOf(raws.map(clean), focus);
  const picture = (p: Picture, key: number, hot: boolean, on = false) => (
    <figure
      key={key}
      data-target={on || undefined}
      {...focusMark(hot)}
      {...stylex.props(styles.figure, hot && styles.focus, on && styles.target)}
    >
      <img src={fileUrl(`docs/${docId}/${p.src}`)} alt={p.alt} {...stylex.props(styles.img)} />
      <figcaption {...stylex.props(type.small, styles.caption)}>
        {p.alt && <span>{p.alt}</span>}
        {p.fig && onFigure && (
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
    <div ref={root} data-testid="doc-text" {...stylex.props(type.reading, styles.text)}>
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
              {...stylex.props(type.readingHeading, row, styles.heading, hot && styles.focus)}
            >
              {side(
                numbered && (
                  <>
                    <span aria-hidden="true">§ </span>
                    {numbered[1]}
                  </>
                ),
                on,
              )}
              {gutter && " "}
              <span {...stylex.props(styles.block, on && styles.target)}>
                {!gutter && numbered && (
                  <>
                    <span {...stylex.props(type.code, styles.number)}>§ {numbered[1]}</span>{" "}
                  </>
                )}
                {numbered ? numbered[2] : head[2]}
              </span>
            </h4>
          );
        }
        if (isTable(b)) {
          const lit = hotKey?.startsWith(`${i}:`) ? Number(hotKey.slice(`${i}:`.length)) : null;
          const inHead = lit !== null && !isRow(b.split("\n"), lit);
          return (
            <div key={i} {...stylex.props(row)}>
              {side(null)}
              <div {...focusMark(inHead)} {...stylex.props(styles.block, inHead && styles.focus)}>
                <FigureTable table={b} label={captionOf(raws[i + 1]) ?? "Table"} lit={inHead ? null : lit} />
              </div>
            </div>
          );
        }
        const parts = pieces(raw);
        const only = parts.length === 1 ? parts[0] : null;
        if (only && "src" in only) {
          const on = !!only.fig && target === `fig:${only.fig}`;
          return (
            <div key={i} data-target={on || undefined} {...stylex.props(row, gutter && styles.figRow)}>
              {side(only.fig ? `fig ${only.fig}` : "", on, true)}
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
          <div key={i} {...stylex.props(row)}>
            {side(null)}
            <div {...focusMark(hot && !quoted)} {...stylex.props(styles.block, hot && !quoted && styles.focus)}>
              {parts.map((p, j) =>
                "src" in p ? (
                  picture(p, j, false, !!p.fig && target === `fig:${p.fig}`)
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
