import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useState } from "react";
import { floorOf, SECTION_MIN_HEIGHT } from "../../../lib/workspace/fit.ts";
import { type Column, NEW_COLUMN_WIDTH } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { space } from "../../../styles/tokens.stylex.ts";
import { ResizeHandle } from "../ResizeHandle.tsx";
import { FoldHint } from "./FoldHint.tsx";
import { SectionStrip } from "./SectionStrip.tsx";
import type { TabDragHandle } from "./useTabDrag.ts";
import { WorkspaceSection } from "./WorkspaceSection.tsx";

const styles = stylex.create({
  column: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: space.snug,
    minWidth: 0,
    minHeight: 0,
  },
  fill: (min: string) => ({ flex: 1, minWidth: min }),
  fixed: (width: string) => ({ flexGrow: 0, flexShrink: 1, flexBasis: width, width }),
  strip: { flex: "none", display: "flex" },
});

// ponytail: one column — a strip when folded (its sections stay mounted, hidden), else its one or two sections, the
// edge between two that both show resizing the top one's share; dragged past a section's least height, that section
// folds to its tab bar, said on it before the drag ends
export function WorkspaceColumn({
  ws,
  column,
  index,
  prefix,
  drag,
  fill,
  main = false,
  strip,
  onWidth,
  folding = false,
}: {
  ws: WorkspaceController;
  column: Column;
  index: number;
  prefix: string;
  drag: TabDragHandle;
  /** it takes the room the others leave */
  fill: boolean;
  /** it holds the screen's work: it keeps more room when it fills */
  main?: boolean;
  /** drawn as its strip: folded by the user, or because the window is narrow ("auto") */
  strip: false | "user" | "auto";
  /** its drawn width, for the edge beside it */
  onWidth: (index: number, px: number) => void;
  /** an edge is dragged past its least width: releasing folds it, it says so */
  folding?: boolean;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const [foldingRow, setFoldingRow] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => {
      setHeight(e.contentRect.height);
      onWidth(index, e.contentRect.width);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [el, index, onWidth]);

  const first = index === 0;
  const sideFold = { icon: first ? ("panel-left" as const) : ("panel-right" as const), label: "Collapse this section" };
  const stack = column.sections.length === 2;
  const bothOpen = stack && column.sections.every((s) => !s.collapsed);
  const share = column.split ?? 50;
  const top = Math.round((height * share) / 100);
  const least = Math.min(SECTION_MIN_HEIGHT, Math.floor(height / 2));

  if (strip)
    return (
      <div {...stylex.props(styles.strip)}>
        <SectionStrip ws={ws} column={column} index={index} auto={strip === "auto"} />
        {column.sections.map((s) => (
          <WorkspaceSection key={s.id} ws={ws} section={s} prefix={prefix} drag={drag} fold={sideFold} stowed />
        ))}
      </div>
    );

  return (
    <div
      ref={setEl}
      data-ws-column={index}
      {...stylex.props(
        styles.column,
        fill ? styles.fill(`${floorOf(main)}px`) : styles.fixed(`${column.width ?? NEW_COLUMN_WIDTH}px`),
      )}
    >
      {column.sections
        .map((s, row) => (
          <WorkspaceSection
            key={s.id}
            ws={ws}
            section={s}
            prefix={prefix}
            drag={drag}
            fold={
              stack ? { icon: row === 0 ? "chevron-up" : "chevron-down", label: "Collapse this section" } : sideFold
            }
            basis={bothOpen && row === 0 ? `calc(${share}% - ${space.snug})` : undefined}
            folding={foldingRow === row}
          />
        ))
        .flatMap((el, row) =>
          row === 1 && bothOpen
            ? [
                <ResizeHandle
                  key="edge"
                  label="Resize the two sections"
                  orientation="horizontal"
                  quiet
                  value={top}
                  min={least}
                  max={Math.max(least, Math.floor(height) - least)}
                  defaultValue={Math.round(height / 2)}
                  onChange={(px) => height && ws.resizeSplit(index, (px * 100) / height, false)}
                  onCommit={(px) => height && ws.resizeSplit(index, (px * 100) / height, true)}
                  fold={{
                    min: true,
                    max: true,
                    onPast: (end) => setFoldingRow(end === "min" ? 0 : end === "max" ? 1 : null),
                    onFold: (end, from) => {
                      setFoldingRow(null);
                      if (height) ws.foldSplit(index, end === "min" ? 0 : 1, (from * 100) / height);
                    },
                  }}
                />,
                el,
              ]
            : [el],
        )}
      {folding && <FoldHint icon={sideFold.icon} />}
    </div>
  );
}
