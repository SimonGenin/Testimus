import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, radius, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  mark: { backgroundColor: color.highlight, color: color.highlightText, borderRadius: radius.r1 },
  quote: {
    borderRadius: radius.mark,
    paddingBlock: 0,
    paddingInline: border.width,
    boxShadow: `0 0 0 ${space.s1} ${color.highlight}`,
  },
});

export type MarkedProps = {
  /** the text, shown as it is */
  text: string;
  /** the parts to highlight: [start, end) offsets in `text`, in order (search.all's marks); one that overlaps the one
   * before or runs past the text is left out */
  marks: readonly (readonly [number, number])[];
  /** search (default): the words a search matched — the palette, the test list · quote: the words a source quotes,
   * inside its passage, with a soft halo */
  look?: "search" | "quote";
};

// ponytail: the one way to highlight words in a text (N2) — a search's matches, a source's quote
export function Marked({ text, marks, look = "search" }: MarkedProps) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at || b > text.length || b <= a) continue;
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <mark key={a} data-hl="" {...stylex.props(styles.mark, look === "quote" && styles.quote)}>
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
