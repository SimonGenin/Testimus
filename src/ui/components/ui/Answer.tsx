import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  answer: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    padding: space.s5,
    borderRadius: radius.r3,
    backgroundColor: color.claudeSubtle,
    color: color.text,
  },
  error: { backgroundColor: color.dangerSubtle },
  head: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0, color: color.claudeText },
  headError: { color: color.danger },
  headActions: { display: "flex", alignItems: "center", gap: space.s2, marginInlineStart: "auto" },
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0, overflowWrap: "anywhere" },
  meta: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.textMuted },
  foot: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
});

export type AnswerProps = {
  /** the head's words after the spark: « Claude », « Claude · Step 2 · Add the negative path », « Why » */
  title?: string;
  /** the run failed: a danger ground, an alert icon in place of the spark */
  error?: boolean;
  /** at the right of the head (a Copy button) */
  actions?: ReactNode;
  /** what Claude said: paragraphs, its sources, the run's badges, a raw block */
  children: ReactNode;
  /** under the body, small and muted, tabular: « 12.3 s · 24k tokens in · opus / high » */
  meta?: ReactNode;
  /** the buttons under it: Show changes, Revert, Show raw output, Retry */
  footer?: ReactNode;
  /** the accessible name of the answer (a region); default its title */
  label?: string;
};

// ponytail: what Claude says back (kit.mjs answer, .answer) — the dock's answers and run cards, the result of a quick
// action, Claude's reading of a figure, the « Why » of a pattern; violet ground, the spark and a title, the body, a meta
// line, the buttons. The request it answers is an Ask
export function Answer({ title = "Claude", error = false, actions, children, meta, footer, label }: AnswerProps) {
  return (
    <section aria-label={label ?? title} {...stylex.props(type.body, styles.answer, error && styles.error)}>
      <div {...stylex.props(type.small, type.strong, styles.head, error && styles.headError)}>
        <Icon name={error ? "alert-circle" : "claude"} size="sm" />
        <span>{title}</span>
        {actions && <span {...stylex.props(styles.headActions)}>{actions}</span>}
      </div>
      <div {...stylex.props(styles.body)}>{children}</div>
      {meta && <div {...stylex.props(type.small, type.tabular, styles.meta)}>{meta}</div>}
      {footer && <div {...stylex.props(styles.foot)}>{footer}</div>}
    </section>
  );
}
