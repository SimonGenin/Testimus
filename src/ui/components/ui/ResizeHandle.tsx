import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, useRef, useState } from "react";
import { border, color, duration, easing, size, space, z } from "../../styles/tokens.stylex.ts";

const KEY_STEP = 16;

const styles = stylex.create({
  handle: {
    position: "relative",
    zIndex: z.sticky,
    flex: "none",
    display: "flex",
    justifyContent: "center",
    width: size.resizeHit,
    marginBlock: 0,
    marginInline: `calc(-1 * ${space.s2})`,
    cursor: "col-resize",
    touchAction: "none",
    outline: "none",
  },
  row: {
    flexDirection: "column",
    alignItems: "stretch",
    width: "auto",
    height: size.resizeHit,
    marginBlock: `calc(-1 * ${space.s2})`,
    marginInline: 0,
    cursor: "row-resize",
  },
  line: {
    width: border.width,
    height: "100%",
    backgroundColor: color.border,
    transitionProperty: "background-color, width, height",
    transitionDuration: duration.fast,
    transitionTimingFunction: easing.standard,
  },
  lineRow: { width: "100%", height: border.width },
  active: { width: border.widthStrong, backgroundColor: color.accent },
  activeRow: { width: "100%", height: border.widthStrong },
  focused: { width: border.widthStrong, backgroundColor: color.focusRing },
});

export type ResizeHandleProps = {
  /** the pane's size now, in px */
  value: number;
  min: number;
  max: number;
  /** what a double-click or Home brings it back to */
  defaultValue: number;
  /** while dragging and on each key */
  onChange: (px: number) => void;
  /** once the gesture ends (the place to remember it in lib/prefs) */
  onCommit?: (px: number) => void;
  /** which edge of the pane the handle is on: right (default; dragging right widens) or left (dragging left widens) —
   * for a horizontal handle, bottom or top */
  side?: "left" | "right";
  /** vertical (default): between panes side by side, it resizes a width · horizontal: between panes one above the
   * other, it resizes a height */
  orientation?: "vertical" | "horizontal";
  /** what it resizes (« Test list width ») */
  label: string;
  /** the catalogue only */
  debugState?: "hover" | "focus" | "drag";
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

// ponytail: the edge of a resizable pane — drag it, double-click it to reset, or focus it and use the arrows (16 px),
// Home (the default), End (the largest); a separator with its value so a screen reader hears the size
export function ResizeHandle({
  value,
  min,
  max,
  defaultValue,
  onChange,
  onCommit,
  side = "right",
  orientation = "vertical",
  label,
  debugState,
}: ResizeHandleProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const from = useRef<{ at: number; value: number; last: number } | null>(null);
  const row = orientation === "horizontal";
  const sign = side === "left" ? -1 : 1;
  const set = (v: number) => {
    const next = clamp(v, min, max);
    onChange(next);
    return next;
  };
  // ponytail: pointerup, pointercancel and the capture's loss all end the same gesture — the first one counts
  const end = () => {
    const f = from.current;
    if (!f) return;
    from.current = null;
    setDrag(false);
    onCommit?.(f.last);
  };
  const key = (e: KeyboardEvent) => {
    const less = row ? "ArrowUp" : "ArrowLeft";
    const more = row ? "ArrowDown" : "ArrowRight";
    const to =
      e.key === less
        ? value - KEY_STEP * sign
        : e.key === more
          ? value + KEY_STEP * sign
          : e.key === "Home"
            ? defaultValue
            : e.key === "End"
              ? max
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const next = set(to);
    onCommit?.(next);
  };
  const lit = drag || hover || debugState === "hover" || debugState === "drag";
  const ringed = (focus || debugState === "focus") && !lit;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter takes drags and keys, an <hr> cannot
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={row ? "horizontal" : "vertical"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPointerDown={(e) => {
        from.current = { at: row ? e.clientY : e.clientX, value, last: value };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag(true);
      }}
      onPointerMove={(e) => {
        const f = from.current;
        if (f) f.last = set(f.value + ((row ? e.clientY : e.clientX) - f.at) * sign);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => {
        const next = set(defaultValue);
        onCommit?.(next);
      }}
      onKeyDown={key}
      {...stylex.props(styles.handle, row && styles.row)}
    >
      <span
        {...stylex.props(
          styles.line,
          row && styles.lineRow,
          lit && styles.active,
          lit && row && styles.activeRow,
          ringed && styles.focused,
          ringed && row && styles.activeRow,
        )}
      />
    </div>
  );
}
