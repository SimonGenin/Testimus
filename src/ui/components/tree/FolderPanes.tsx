import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { usePaneShare } from "../../lib/panes.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { ResizeHandle } from "../ui/ResizeHandle.tsx";
import { type } from "../ui/type.ts";

export type PanesLayout = "columns" | "rows";

const styles = stylex.create({
  split: { flex: 1, minHeight: 0, minWidth: 0, display: "flex" },
  rows: { flexDirection: "column" },
  pane: { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 },
  first: { flexGrow: 0, flexShrink: 0 },
  rest: { flex: 1 },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingBlock: space.s2,
  },
  flush: { borderBlockStartStyle: "none" },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.row,
    paddingInline: space.s5,
    backgroundColor: color.surfaceSunken,
    borderBlockStyle: "solid",
    borderBlockWidth: border.width,
    borderBlockColor: color.border,
  },
  path: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  range: { color: color.textMuted },
});

// ponytail: a folder tree and the tests of the folder picked, in two panes each scrolling on its own — side by side
// (folders left) or one above the other (folders on top), the split kept per side (Jira's, the local one)
export function FolderPanes({
  name,
  layout,
  foldersTitle = "Folders",
  folders,
  title,
  code,
  meta,
  children,
}: {
  name: "jira" | "local" | "generate";
  layout: PanesLayout;
  /** the first pane's head: Folders by default */
  foldersTitle?: string;
  /** the folders pane's body */
  folders: ReactNode;
  /** the tests pane's head: what it lists (a folder's path, a search) */
  title: string;
  /** the title is a path, set as code */
  code: boolean;
  /** how many it lists, at the head's end — nothing while it loads */
  meta?: ReactNode;
  /** the tests pane's body */
  children: ReactNode;
}) {
  const rowsLayout = layout === "rows";
  const split = usePaneShare(rowsLayout ? `${name}RowsShare` : `${name}ColumnsShare`, rowsLayout ? "height" : "width");
  return (
    <div ref={split.frame} {...stylex.props(styles.split, rowsLayout && styles.rows)}>
      <div {...stylex.props(styles.pane, styles.first)} style={{ flexBasis: `${split.share}%` }}>
        <div {...stylex.props(type.small, styles.head)}>
          <span {...stylex.props(styles.path)}>{foldersTitle}</span>
        </div>
        <div data-testid={`${name}-folders`} {...stylex.props(styles.scroll)}>
          {folders}
        </div>
      </div>
      <ResizeHandle
        label={
          rowsLayout
            ? `Resize the ${foldersTitle.toLowerCase()} and the tests`
            : `Resize the ${foldersTitle.toLowerCase()}`
        }
        orientation={rowsLayout ? "horizontal" : "vertical"}
        {...split.handle}
      />
      <div {...stylex.props(styles.pane, styles.rest)}>
        <div {...stylex.props(type.small, styles.head, rowsLayout && styles.flush)}>
          <span {...stylex.props(code && type.code, styles.path)}>{title}</span>
          {meta != null && (
            <span data-testid={`${name}-range`} {...stylex.props(styles.range)}>
              {meta}
            </span>
          )}
        </div>
        <div data-testid={`${name}-tests`} {...stylex.props(styles.scroll)}>
          {children}
        </div>
      </div>
    </div>
  );
}
