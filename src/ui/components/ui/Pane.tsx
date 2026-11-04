import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useId } from "react";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { type } from "./type.ts";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: color.surface,
    color: color.text,
  },
  canvas: { backgroundColor: color.canvas },
  fill: { flex: 1 },
  head: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    minWidth: 0,
    minHeight: size.topbar,
    paddingBlock: space.s2,
    paddingInline: space.s6,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  title: { margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tools: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  actions: { display: "flex", alignItems: "center", gap: space.s2, marginInlineStart: "auto", flex: "none" },
  body: { flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" },
  still: { overflow: "visible", display: "flex", flexDirection: "column" },
  foot: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    paddingBlock: space.s4,
    paddingInline: space.s6,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
});

export type PaneProps = {
  /** the pane's title in its head (title-sm); it names the pane */
  title?: ReactNode;
  /** in the head after the title: a count badge, a filter field, a segmented choice */
  tools?: ReactNode;
  /** at the right end of the head: its buttons */
  actions?: ReactNode;
  /** the body; it scrolls inside the pane */
  children: ReactNode;
  /** under a hairline at the bottom: the pane's main action and its summary */
  footer?: ReactNode;
  /** the accessible name when there is no title (a list, a reader) */
  label?: string;
  /** section (default) · aside (a side list, a drawer) */
  as?: "section" | "aside";
  /** the canvas ground (cards sit on it) instead of the surface */
  canvas?: boolean;
  /** takes the room left in its row */
  fill?: boolean;
  /** false: the body does not scroll — what it holds has its own scroller (a list with its own head, a split) */
  scroll?: boolean;
};

// ponytail: a pane of a screen (shell.mjs .pane, .pane__head, .pane__title, .pane__body, .pane__foot) — the documents
// list, a reader, the review queue and its source, the jobs list, Generate's request: a head as tall as the top bar
// with its title, tools and buttons, a body that scrolls, a foot; the one place a pane head is drawn
export function Pane({
  title,
  tools,
  actions,
  children,
  footer,
  label,
  as = "section",
  canvas = false,
  fill = false,
  scroll = true,
}: PaneProps) {
  const id = useId();
  const Tag = as;
  const head = title !== undefined || tools !== undefined || actions !== undefined;
  return (
    <Tag
      aria-labelledby={title !== undefined && !label ? id : undefined}
      aria-label={label}
      {...stylex.props(styles.pane, canvas && styles.canvas, fill && styles.fill)}
    >
      {head && (
        <div {...stylex.props(styles.head)}>
          {title !== undefined && (
            <h2 id={id} {...stylex.props(type.titleSm, styles.title)}>
              {title}
            </h2>
          )}
          {tools && <div {...stylex.props(styles.tools)}>{tools}</div>}
          {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
        </div>
      )}
      <div {...stylex.props(styles.body, !scroll && styles.still)}>{children}</div>
      {footer && <div {...stylex.props(styles.foot)}>{footer}</div>}
    </Tag>
  );
}
