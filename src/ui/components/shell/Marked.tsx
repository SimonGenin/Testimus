import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { SearchMark } from "../../../core/types.ts";
import { color, radius } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  mark: { backgroundColor: color.highlight, color: color.highlightText, borderRadius: radius.r1 },
});

// ponytail: the words a search found, highlighted where they are in the text
export function Marked({ text, marks }: { text: string; marks: SearchMark[] }) {
  if (!marks.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at || b > text.length) continue;
    if (a > at) parts.push(text.slice(at, a));
    parts.push(
      <mark key={a} {...stylex.props(styles.mark)}>
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
