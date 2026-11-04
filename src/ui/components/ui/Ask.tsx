import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import { type } from "./type.ts";

const styles = stylex.create({
  ask: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: space.s1, minWidth: 0 },
  meta: { color: color.textSubtle },
  bubble: {
    boxSizing: "border-box",
    maxWidth: "88%",
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
    color: color.text,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  empty: { color: color.textSubtle },
});

export type AskProps = {
  /** what the person asked, as typed (line breaks kept); empty: `empty` is shown in its place */
  children?: ReactNode;
  /** above the bubble, small and subtle: where the request was made (« Step 2 · Add the negative path ») */
  meta?: string;
  /** shown in the bubble when nothing was typed */
  empty?: string;
  /** the accessible name (a region); default « Request » with the meta */
  label?: string;
};

// ponytail: the person's request in a Claude conversation (kit.css .ask, claude.mjs turn-meta) — a sunken bubble on the
// right, its scope above it; Claude's reply under it is an Answer
export function Ask({ children, meta, empty = "No request", label }: AskProps) {
  const has = children !== undefined && children !== null && children !== "";
  return (
    <section aria-label={label ?? `Request${meta ? ` · ${meta}` : ""}`} {...stylex.props(styles.ask)}>
      {meta && <span {...stylex.props(type.small, styles.meta)}>{meta}</span>}
      <div {...stylex.props(type.body, styles.bubble)}>
        {has ? children : <span {...stylex.props(styles.empty)}>{empty}</span>}
      </div>
    </section>
  );
}
