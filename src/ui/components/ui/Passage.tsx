import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { Marked } from "./Marked.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  passage: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0, margin: 0 },
  head: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3, color: color.textMuted },
  ref: { color: color.textLink },
  body: { display: "flex", flexDirection: "column", gap: space.s4, minWidth: 0, color: color.text },
  heading: { margin: 0 },
  anchor: { marginInlineEnd: space.s3, color: color.textSubtle },
  para: { margin: 0, overflowWrap: "anywhere" },
  dim: { color: color.textMuted },
  figure: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s2, margin: 0 },
  frame: {
    boxSizing: "border-box",
    maxWidth: "100%",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
  },
  missing: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    height: size.figurePreview,
    color: color.textSubtle,
  },
  picture: { display: "block", objectFit: "contain", backgroundColor: color.surface },
  preview: { maxHeight: size.figurePreview },
  caption: { color: color.textMuted },
});

export type PassageFigure = {
  /** the picture's address; without it a framed placeholder stands at the figure's place */
  src?: string;
  /** the picture's text alternative (its caption when it has none) */
  alt?: string;
  caption: string;
};

export type PassageProps = {
  /** where it comes from, in mono and the link colour, first in the head (« D401-1_3 §5.6.6 ») */
  reference?: string;
  /** the document's title, after the reference */
  docTitle?: string;
  /** more in the head: the document's status badge, an Open button */
  head?: ReactNode;
  /** the section's title, in the reading face */
  heading?: string;
  /** the section's number before the title, in mono (« § 5.6.6 ») */
  anchor?: string;
  /** the level of the title in the page's outline (default 3) */
  level?: 2 | 3 | 4;
  /** the paragraphs, as the document says them: a string, or a node a screen built (emphasis, its own marks) */
  paragraphs: ReactNode[];
  /** the words a source quotes: found in the string paragraphs (case and spaces aside) and highlighted */
  quote?: string;
  /** with a quote: the paragraphs that do not hold it are muted, so the cited one stands out */
  dim?: boolean;
  figures?: PassageFigure[];
  /** preview (default): a figure stands at most 140 px high, beside a test or in the dock · full: as wide as the
   * passage, in the reader */
  figureSize?: "preview" | "full";
};

const squeeze = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

// ponytail: the quote is found whitespace- and case-insensitively (SPEC §6), on a squeezed copy mapped back to the
// paragraph's own offsets
export function quoteMarks(text: string, quote: string): [number, number][] {
  const q = squeeze(quote).trim();
  if (!q) return [];
  const keep: number[] = [];
  let flat = "";
  for (let i = 0; i < text.length; i++) {
    const c = /\s/.test(text[i]) ? " " : text[i].toLowerCase();
    if (c === " " && (flat.endsWith(" ") || !flat)) continue;
    flat += c;
    keep.push(i);
  }
  const at = flat.indexOf(q);
  return at < 0 ? [] : [[keep[at], keep[at + q.length - 1] + 1]];
}

// ponytail: a part of a specification as the document says it (kit.mjs passage, .passage*) — where it comes from, the
// section's number and title, the paragraphs in the reading face with the quoted words highlighted, its figures; the
// source panel, a passage in the dock and the documents reader draw a passage through it
export function Passage({
  reference,
  docTitle,
  head,
  heading,
  anchor,
  level = 3,
  paragraphs,
  quote,
  dim = false,
  figures = [],
  figureSize = "preview",
}: PassageProps) {
  const H = `h${level}` as const;
  return (
    <article {...stylex.props(styles.passage)}>
      {(reference || docTitle || head) && (
        <div {...stylex.props(type.small, styles.head)}>
          {reference && <span {...stylex.props(type.code, styles.ref)}>{reference}</span>}
          {docTitle && <span>{docTitle}</span>}
          {head}
        </div>
      )}
      <div {...stylex.props(type.reading, styles.body)}>
        {heading && (
          <H {...stylex.props(type.readingHeading, styles.heading)}>
            {anchor && <span {...stylex.props(type.code, styles.anchor)}>{anchor}</span>}
            {anchor && " "}
            {heading}
          </H>
        )}
        {paragraphs.map((p, i) => {
          const marks = typeof p === "string" && quote ? quoteMarks(p, quote) : [];
          const muted = dim && !!quote && marks.length === 0;
          return (
            <p key={i} data-cited={marks.length > 0 || undefined} {...stylex.props(styles.para, muted && styles.dim)}>
              {typeof p === "string" && marks.length ? <Marked text={p} marks={marks} look="quote" /> : p}
            </p>
          );
        })}
        {figures.map((f, i) => (
          <figure key={`${i}-${f.caption}`} {...stylex.props(styles.figure)}>
            {f.src ? (
              <img
                src={f.src}
                alt={f.alt || f.caption}
                {...stylex.props(styles.frame, styles.picture, figureSize === "preview" && styles.preview)}
              />
            ) : (
              <div {...stylex.props(styles.frame, styles.missing)}>
                <Icon name="image" size="lg" label={f.alt || f.caption} />
              </div>
            )}
            <figcaption {...stylex.props(type.small, styles.caption)}>{f.caption}</figcaption>
          </figure>
        ))}
      </div>
    </article>
  );
}
