import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId, useState } from "react";
import {
  border,
  color,
  duration,
  easing,
  focus,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  space,
} from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";

const styles = stylex.create({
  wrap: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  summary: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    paddingBlock: 0,
    paddingInline: space.s1,
    borderWidth: 0,
    borderRadius: radius.r1,
    backgroundColor: "transparent",
    color: { default: color.text, ":hover": color.textLink },
    fontFamily: "inherit",
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: focus.offset,
  },
  muted: { color: { default: color.textMuted, ":hover": color.text } },
  chevron: {
    display: "inline-flex",
    color: color.textSubtle,
    transitionProperty: "transform",
    transitionDuration: duration.fast,
    transitionTimingFunction: easing.standard,
  },
  open: { transform: "rotate(90deg)" },
  meta: {
    marginInlineStart: "auto",
    color: color.textSubtle,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  hover: { color: color.textLink },
  focus: { outline: `${border.widthStrong} solid ${color.focusRing}` },
});

export type DisclosureProps = {
  /** what is folded (« Technical details », « Sources read · 4 ») */
  summary: string;
  /** controlled: open or not (with onOpenChange) */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** uncontrolled: open at first */
  defaultOpen?: boolean;
  /** on the right of the summary: a count, a time */
  meta?: ReactNode;
  /** a secondary fold (raw output, details under a banner): the summary in the muted tone */
  quiet?: boolean;
  /** shown when open; not rendered when folded */
  children: ReactNode;
  /** the catalogue only */
  debugState?: "hover" | "focus";
};

// ponytail: folds a part of a pane away behind its summary — the summary is a button that says whether it is open
// (aria-expanded) and which region it opens (aria-controls)
export function Disclosure({
  summary,
  open,
  onOpenChange,
  defaultOpen = false,
  meta,
  quiet = false,
  children,
  debugState,
}: DisclosureProps) {
  const id = useId();
  const [own, setOwn] = useState(defaultOpen);
  const shown = open ?? own;
  return (
    <div {...stylex.props(styles.wrap)}>
      <div {...stylex.props(styles.head)}>
        <button
          type="button"
          aria-expanded={shown}
          aria-controls={shown ? id : undefined}
          onClick={() => {
            setOwn(!shown);
            onOpenChange?.(!shown);
          }}
          {...stylex.props(
            styles.summary,
            quiet && styles.muted,
            debugState === "hover" && styles.hover,
            debugState === "focus" && styles.focus,
          )}
        >
          <span {...stylex.props(styles.chevron, shown && styles.open)}>
            <Icon name="chevron-right" size="sm" />
          </span>
          {summary}
        </button>
        {meta && <span {...stylex.props(styles.meta)}>{meta}</span>}
      </div>
      {shown && (
        <section id={id} aria-label={summary} {...stylex.props(styles.body)}>
          {children}
        </section>
      )}
    </div>
  );
}
