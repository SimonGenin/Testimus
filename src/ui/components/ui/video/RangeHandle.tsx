import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import { clock } from "../../../lib/media.ts";
import { border, color, radius, space } from "../../../styles/tokens.stylex.ts";
import { halo } from "../halo.ts";

const styles = stylex.create({
  handle: {
    position: "absolute",
    insetBlock: space.inset,
    boxSizing: "border-box",
    width: space.pill,
    borderStyle: "solid",
    borderWidth: border.widthStrong,
    borderColor: color.surface,
    borderRadius: radius.r1,
    backgroundColor: { default: color.accentHover, ":hover": color.accentPressed },
    transform: "translateX(-50%)",
    cursor: "ew-resize",
    touchAction: "none",
    outline: "none",
  },
});

export type RangeHandleProps = {
  /** which bound it is (« Start of the cited range ») */
  label: string;
  /** the bound, seconds, and how far it may go */
  value: number;
  min: number;
  max: number;
  /** where it stands on the timeline (« 60% ») */
  left: string;
  /** the second under the pointer, null while the timeline has no width or no length */
  at: (clientX: number) => number | null;
  /** while dragged and on each arrow key */
  onMove: (seconds: number) => void;
  /** the bound is let go: the pointer or the key is released */
  onDone: () => void;
};

// ponytail: one bound of the cited range — a slider of its own on the timeline: dragged, or moved a second at a time
// with the arrows, which stay here (the player's own ← → would move the playhead)
export function RangeHandle({ label, value, min, max, left, at, onMove, onDone }: RangeHandleProps) {
  const dragging = useRef(false);
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onDone();
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={clock(value)}
      style={{ left }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const seconds = dragging.current ? at(e.clientX) : null;
        if (seconds !== null) onMove(seconds);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        onMove(value + (e.key === "ArrowLeft" ? -1 : 1));
      }}
      onKeyUp={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") onDone();
      }}
      onBlur={onDone}
      {...stylex.props(halo.visible, styles.handle)}
    />
  );
}
