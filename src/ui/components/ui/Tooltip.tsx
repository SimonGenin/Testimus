import * as stylex from "@stylexjs/stylex";
import { cloneElement, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { color, fontSize, lineHeight, radius, shadow, size, space, z } from "../../styles/tokens.stylex.ts";
import { Kbd } from "./Kbd.tsx";

const SHOW_AFTER_MS = 500;

const styles = stylex.create({
  anchor: { position: "relative", display: "inline-flex", maxWidth: "100%", minWidth: 0 },
  bubble: {
    boxSizing: "border-box",
    position: "absolute",
    zIndex: z.tooltip,
    display: "inline-flex",
    alignItems: "center",
    gap: space.s3,
    width: "max-content",
    maxWidth: size.tooltipMax,
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceInverse,
    color: color.textInverse,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: "normal",
    whiteSpace: "normal",
    boxShadow: shadow.s2,
    pointerEvents: "none",
  },
  top: { bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: space.s2 },
  bottom: { top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: space.s2 },
  left: { right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: space.s2 },
  right: { left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: space.s2 },
  closed: { display: "none" },
});

export type TooltipProps = {
  /** a few words: an icon button's name, a disabled control's reason, a truncated title in full */
  label: string;
  /** a shortcut shown as keys after the words */
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  /** the control it describes (its accessible description becomes the tooltip) */
  children: ReactElement<{ "aria-describedby"?: string; "aria-expanded"?: boolean | "true" | "false" }>;
};

// ponytail: what the person used last, as :focus-visible knows it — a focus given back by a click (a menu that closes on
// its item and opens a confirmation) is not a keyboard focus and shows no tooltip
let lastInput: "keyboard" | "pointer" = "keyboard";
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      lastInput = "keyboard";
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      lastInput = "pointer";
    },
    true,
  );
}

// ponytail: shown on hover after 500 ms and at once on keyboard focus, hidden on Escape and while the control's own
// layer (a menu, a popover) is open; never interactive and never the only place for what is needed to act (SYSTEM.md)
export function Tooltip({ label, shortcut, side = "top", children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const expanded = children.props["aria-expanded"] === true || children.props["aria-expanded"] === "true";
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <span
      {...stylex.props(styles.anchor)}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
      }}
      onMouseLeave={hide}
      onFocus={() => {
        if (lastInput === "keyboard") setOpen(true);
      }}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span role="tooltip" id={id} {...stylex.props(styles.bubble, styles[side], (!open || expanded) && styles.closed)}>
        {label}
        {shortcut && <Kbd onFill>{shortcut}</Kbd>}
      </span>
    </span>
  );
}
