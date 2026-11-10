import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, useRef, useState } from "react";
import { border, color, duration, easing, radius, size, space, z } from "../../styles/tokens.stylex.ts";

const KEY_STEP = 16;
/** how far past a bound a drag goes before it folds the pane instead */
export const FOLD_PAST = 32;

const styles = stylex.create({
  handle: {
    position: "relative",
    zIndex: z.sticky,
    flex: "none",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
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
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: border.width,
    height: "100%",
    backgroundColor: color.border,
  },
  lineRow: { width: "100%", height: border.width },
  quiet: { backgroundColor: "transparent" },
  grip: {
    flex: "none",
    width: space.inset,
    height: size.controlSm,
    borderRadius: radius.full,
    backgroundColor: color.borderField,
    transitionProperty: "background-color, width, height",
    transitionDuration: duration.fast,
    transitionTimingFunction: easing.standard,
  },
  gripRow: { width: size.controlSm, height: space.inset },
  hover: { height: size.controlLg, backgroundColor: color.borderControl },
  hoverRow: { width: size.controlLg, height: space.inset },
  drag: { backgroundColor: color.accent },
  focused: { backgroundColor: color.focusRing },
});

type End = "min" | "max";

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
  /** no line, only its grip (sections, the editor column, whose edges are the boxes beside it) */
  quiet?: boolean;
  /** a drag that goes FOLD_PAST beyond a bound folds a pane instead (min: the pane resized, max: the one across the
   * edge): onPast says so while the pointer is there (to show it before it happens, null when it comes back),
   * onFold when the drag ends there — with the size the pane had when the drag began, and no onCommit */
  fold?: {
    min?: boolean;
    max?: boolean;
    onPast: (end: End | null) => void;
    onFold: (end: End, from: number) => void;
  };
  /** what it resizes (« Test list width ») */
  label: string;
  /** the catalogue only */
  debugState?: "hover" | "focus" | "drag";
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

// ponytail: the edge of a resizable pane — a grip on a hairline: drag it, double-click it to reset, or focus it and use
// the arrows (16 px), Home (the default), End (the largest); dragged well past a bound it can fold a pane (fold); a
// separator with its value so a screen reader hears the size
export function ResizeHandle({
  value,
  min,
  max,
  defaultValue,
  onChange,
  onCommit,
  side = "right",
  orientation = "vertical",
  quiet = false,
  fold,
  label,
  debugState,
}: ResizeHandleProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const from = useRef<{ at: number; value: number; last: number; past: End | null } | null>(null);
  const row = orientation === "horizontal";
  const sign = side === "left" ? -1 : 1;
  const set = (v: number) => {
    const next = clamp(v, min, max);
    onChange(next);
    return next;
  };
  const pastOf = (raw: number): End | null =>
    fold?.min && raw < min - FOLD_PAST ? "min" : fold?.max && raw > max + FOLD_PAST ? "max" : null;
  // ponytail: pointerup, pointercancel and the capture's loss all end the same gesture — the first one counts
  const end = () => {
    const f = from.current;
    if (!f) return;
    from.current = null;
    setDrag(false);
    if (f.past && fold) fold.onFold(f.past, f.value);
    else onCommit?.(f.last);
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
  const dragged = drag || debugState === "drag";
  const lit = dragged || hover || debugState === "hover";
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
        from.current = { at: row ? e.clientY : e.clientX, value, last: value, past: null };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag(true);
      }}
      onPointerMove={(e) => {
        const f = from.current;
        if (!f) return;
        const raw = f.value + ((row ? e.clientY : e.clientX) - f.at) * sign;
        f.last = set(raw);
        const past = pastOf(raw);
        if (past !== f.past) {
          f.past = past;
          fold?.onPast(past);
        }
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
      <span {...stylex.props(styles.line, row && styles.lineRow, quiet && styles.quiet)}>
        <span
          {...stylex.props(
            styles.grip,
            row && styles.gripRow,
            lit && styles.hover,
            lit && row && styles.hoverRow,
            dragged && styles.drag,
            ringed && styles.focused,
          )}
        />
      </span>
    </div>
  );
}
