import * as stylex from "@stylexjs/stylex";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { overflowed } from "../../../lib/workspace/fit.ts";
import {
  COLUMN_WIDTH,
  columnCollapsed,
  locate,
  NEW_COLUMN_WIDTH,
  pendingSection,
  sectionOf,
} from "../../../lib/workspace/layout.ts";
import { currentBar, setBar } from "../../../lib/workspace/signals.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import { ResizeHandle } from "../ResizeHandle.tsx";
import { TabGhost } from "./TabGhost.tsx";
import { useTabDrag } from "./useTabDrag.ts";
import { WorkspaceColumn } from "./WorkspaceColumn.tsx";

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    gap: space.snug,
    padding: space.snug,
    backgroundColor: color.canvas,
  },
});

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// ponytail: a screen's sections side by side — the columns and the edges between them (dragged, they resize the
// column that has a width of its own), the column holding the work taking the room left; a narrow window folds the
// columns it cannot hold to their strip (the rightmost first; the work's and the one in use last, the one in use kept when both cannot fit). The keys that act
// on the layout as a whole live here: Ctrl Shift B folds the section in use, Ctrl Alt → adds a column, Ctrl Alt ↓
// splits the one in use, Esc drops a section still empty. The top bar's controls are handed these sections
export type WorkspaceProps = {
  /** the screen's sections and tabs, from useWorkspace (lib/workspace): each tab has its icon, its content, its foot */
  ws: WorkspaceController;
};

export function Workspace({ ws }: WorkspaceProps) {
  const prefix = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const widths = useRef(new Map<number, number>());
  const drag = useTabDrag(ws);
  const latest = useRef(ws);
  latest.current = ws;

  useEffect(() => {
    setBar(ws);
  });
  useEffect(
    () => () => {
      if (currentBar()?.label === latest.current.label) setBar(null);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(el.getBoundingClientRect().width);
    const watch = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const layout = ws.layout;
  const focusedSection = ws.focused ?? sectionOf(layout, ws.tabs.find((t) => t.main)?.id ?? "")?.id ?? null;
  const focusedColumn = focusedSection ? locate(layout, focusedSection)?.column : undefined;
  const mainColumn = (() => {
    const s = sectionOf(layout, ws.tabs.find((t) => t.main)?.id ?? "");
    return s ? locate(layout, s.id)?.column : undefined;
  })();
  const keep = new Set([focusedColumn, mainColumn].filter((c): c is number => c !== undefined));
  const folded = overflowed(layout, width, keep, mainColumn, focusedColumn);
  const stripOf = (i: number) =>
    columnCollapsed(layout.columns[i]) ? ("user" as const) : folded.has(i) ? ("auto" as const) : false;
  const open = layout.columns.map((_, i) => !stripOf(i));
  const fill = (() => {
    const free = layout.columns.findIndex((c, i) => open[i] && c.width === null);
    return free >= 0 ? free : open.lastIndexOf(true);
  })();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const w = latest.current;
      const at = w.focused ?? focusedSection;
      if (e.key === "Escape" && pendingSection(w.layout) && !editable(e.target)) {
        w.dismiss();
        return;
      }
      if (editable(e.target)) return;
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === "b" && at) {
        e.preventDefault();
        const s = w.layout.columns.flatMap((c) => c.sections).find((x) => x.id === at);
        if (s) w.collapse(s.id, !s.collapsed);
      } else if (e.ctrlKey && e.altKey && !e.shiftKey && e.key === "ArrowRight") {
        e.preventDefault();
        if (!w.addRefusal("column")) w.add("column");
      } else if (e.ctrlKey && e.altKey && !e.shiftKey && e.key === "ArrowDown" && at) {
        e.preventDefault();
        if (!w.addRefusal({ split: at })) w.add({ split: at });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedSection]);

  const pending = pendingSection(layout);
  const onWidth = useCallback((i: number, px: number) => widths.current.set(i, px), []);
  const dragged = drag.drag ? ws.tab(drag.drag.tab) : undefined;

  return (
    <div
      ref={root}
      data-workspace={ws.label}
      onPointerDownCapture={(e) => {
        if (pending && !(e.target as HTMLElement).closest(`[data-ws-section="${pending.id}"]`)) ws.dismiss();
      }}
      {...stylex.props(styles.root)}
    >
      {layout.columns.map((c, i) => {
        const edgeOn = i > 0 && open[i - 1] && open[i];
        const resized = layout.columns[i - 1]?.width !== null && i - 1 !== fill ? i - 1 : i;
        const side = resized === i ? "left" : "right";
        const now = layout.columns[resized]?.width ?? widths.current.get(resized) ?? NEW_COLUMN_WIDTH;
        return (
          <Fragment key={c.sections[0]?.id ?? i}>
            {edgeOn && (
              <ResizeHandle
                label={`Resize section ${resized + 1}`}
                side={side}
                quiet
                value={now}
                min={COLUMN_WIDTH.min}
                max={COLUMN_WIDTH.max}
                defaultValue={NEW_COLUMN_WIDTH}
                onChange={(px) => ws.resizeColumn(resized, px, false)}
                onCommit={(px) => ws.resizeColumn(resized, px, true)}
              />
            )}
            <WorkspaceColumn
              ws={ws}
              column={c}
              index={i}
              prefix={prefix}
              drag={drag}
              fill={i === fill}
              main={i === mainColumn}
              strip={stripOf(i)}
              onWidth={onWidth}
            />
          </Fragment>
        );
      })}
      {drag.drag && dragged && (
        <TabGhost x={drag.drag.x} y={drag.drag.y} label={dragged.label} icon={dragged.icon} claude={dragged.claude} />
      )}
    </div>
  );
}
