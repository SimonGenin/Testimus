import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { ResizeHandle, type ResizeHandleProps } from "../../../components/ui/ResizeHandle.tsx";
import { color, fontSize, lineHeight, size, space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  frame: { display: "flex", width: "100%", height: size.thumbLarge, backgroundColor: color.canvas },
  column: { flexDirection: "column", height: "auto" },
  pane: {
    boxSizing: "border-box",
    flex: "none",
    overflow: "hidden",
    padding: space.s3,
    backgroundColor: color.surface,
    color: color.textMuted,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
  },
  rest: { flex: 1, padding: space.s3, color: color.textSubtle, fontSize: fontSize.small },
});

function Split({
  orientation = "vertical",
  debugState,
}: {
  orientation?: ResizeHandleProps["orientation"];
  debugState?: ResizeHandleProps["debugState"];
}): ReactNode {
  const [px, setPx] = useState(orientation === "horizontal" ? 64 : 120);
  const row = orientation === "horizontal";
  return (
    <div {...stylex.props(styles.frame, row && styles.column)}>
      <div {...stylex.props(styles.pane)} style={row ? { height: px } : { width: px }}>
        {px} px
      </div>
      <ResizeHandle
        label={row ? "Editor height" : "Sidebar width"}
        orientation={orientation}
        value={px}
        min={row ? 40 : 80}
        max={row ? 120 : 200}
        defaultValue={row ? 64 : 120}
        onChange={setPx}
        debugState={debugState}
      />
      <div {...stylex.props(styles.rest)}>Drag, double-click, or focus and use the arrows</div>
    </div>
  );
}

export const section: KitSection = {
  name: "ResizeHandle",
  family: "Layout",
  file: "ResizeHandle.tsx",
  summary:
    "The edge of a resizable pane: a hairline that becomes a 2 px accent bar on hover, drag and keyboard focus. ←/→ move it by 16 px, Home resets, End is the largest, a double-click resets. The caller remembers the width in lib/prefs.",
  states: () => (
    <States>
      <Cell label="rest" column>
        <Split />
      </Cell>
      <Cell label="hover · drag" column>
        <Split debugState="hover" />
      </Cell>
      <Cell label="focus" column>
        <Split debugState="focus" />
      </Cell>
      <Cell label="horizontal (resizes a height)" column>
        <Split orientation="horizontal" />
      </Cell>
    </States>
  ),
};
