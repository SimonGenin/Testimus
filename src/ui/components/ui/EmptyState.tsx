import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { color, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  empty: {
    boxSizing: "content-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s3,
    maxWidth: size.emptyMax,
    marginInline: "auto",
    paddingBlock: space.s10,
    paddingInline: space.s7,
    textAlign: "center",
    color: color.textMuted,
  },
  compact: { paddingBlock: space.s7, paddingInline: space.s5 },
  wide: { boxSizing: "border-box", maxWidth: size.reading },
  mark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: space.s9,
    height: space.s9,
    marginBottom: space.s2,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  title: { color: color.text },
  text: { fontSize: fontSize.compact, lineHeight: lineHeight.compact },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: space.s3,
    marginTop: space.s3,
  },
});

export type EmptyStateProps = {
  /** the mark: what is missing (documents, tests, review…) */
  icon: IconName;
  /** what is missing, in one line (« No document yet ») */
  title: string;
  /** how to fill it, in one line */
  text?: ReactNode;
  /** at most two buttons; the first is the way forward (« Add documents ») */
  actions?: ReactNode;
  /** inside a list's frame or a small card: less room above and below */
  compact?: boolean;
  /** alone in a wide pane (Generate's result): the text runs to the reading width */
  wide?: boolean;
};

// ponytail: fills a list or a pane that has nothing — no illustration, no joke; the title is text, not a heading, so it
// never breaks the screen's outline
export function EmptyState({ icon, title, text, actions, compact = false, wide = false }: EmptyStateProps) {
  return (
    <div {...stylex.props(styles.empty, compact && styles.compact, wide && styles.wide)}>
      <span {...stylex.props(styles.mark)}>
        <Icon name={icon} size="lg" />
      </span>
      <span {...stylex.props(type.titleSm, styles.title)}>{title}</span>
      {text && <span {...stylex.props(styles.text)}>{text}</span>}
      {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
    </div>
  );
}
