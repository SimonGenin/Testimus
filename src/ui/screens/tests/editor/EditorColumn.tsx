import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { ResizeHandle } from "../../../components/ui/ResizeHandle.tsx";
import { breakpoint, size, space } from "../../../styles/tokens.stylex.ts";

const MIN = 560;
const MAX = 4000;
const DEFAULT = 1180;

const styles = stylex.create({
  scroll: { flex: 1, minHeight: 0, overflow: "auto", isolation: "isolate" },
  col: {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: `calc(${size.reading} + ${size.dock})`,
    marginInline: "auto",
    paddingTop: space.s6,
    paddingInline: { default: space.s7, [breakpoint.narrow]: space.s4 },
    paddingBottom: space.s11,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
  },
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    display: { default: "flex", [breakpoint.narrow]: "none" },
  },
  held: { display: "contents" },
  left: { left: 0 },
  right: { right: 0 },
});

// ponytail: the editor's column, centred, resizable from either edge (a drag widens both sides at once, so the handle
// moves half the width); a double-click or Home goes back to the default. Under the narrow breakpoint the handles go
// away: they would sit over the steps' fields
export function EditorColumn({
  width,
  onWidth,
  inert,
  top,
  children,
}: {
  width: number | null;
  onWidth: (px: number | null) => void;
  inert?: boolean;
  /** above the content and never inert: the notices, whose buttons act while the rest waits */
  top?: ReactNode;
  children: ReactNode;
}) {
  const half = (width ?? DEFAULT) / 2;
  const handle = (side: "left" | "right") => (
    <span {...stylex.props(styles.edge, side === "left" ? styles.left : styles.right)}>
      <ResizeHandle
        quiet
        label="Resize the editor column"
        side={side}
        value={half}
        min={MIN / 2}
        max={MAX / 2}
        defaultValue={DEFAULT / 2}
        onChange={(v) => onWidth(v * 2)}
        onCommit={(v) => onWidth(v * 2 === DEFAULT ? null : v * 2)}
      />
    </span>
  );
  return (
    <div {...stylex.props(styles.scroll)}>
      <div data-testid="editor-column" {...stylex.props(styles.col)} style={width ? { maxWidth: width } : undefined}>
        {handle("left")}
        {handle("right")}
        {top}
        <div data-testid="editor-held" inert={inert} {...stylex.props(styles.held)}>
          {children}
        </div>
      </div>
    </div>
  );
}
