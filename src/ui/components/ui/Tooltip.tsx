import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { color, fontSize, lineHeight, radius, shadow, size, space, z } from "../../styles/tokens.stylex.ts";
import { Kbd } from "./Kbd.tsx";
import { keyboardFocus } from "./layer.ts";

const SHOW_AFTER_MS = 500;
const GUTTER = 8;

const styles = stylex.create({
  anchor: { display: "inline-flex", maxWidth: "100%", minWidth: 0 },
  bubble: {
    boxSizing: "border-box",
    position: "fixed",
    inset: "auto",
    zIndex: z.tooltip,
    margin: 0,
    borderStyle: "none",
    overflow: "visible",
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
  top: { marginBottom: space.s2 },
  bottom: { marginTop: space.s2 },
  left: { marginRight: space.s2 },
  right: { marginLeft: space.s2 },
  closed: { display: "none" },
  rich: { flexDirection: "column", alignItems: "stretch", gap: space.s2, width: size.tooltipMax },
});

export type TooltipProps = {
  /** a few words: an icon button's name, a disabled control's reason, a truncated title in full */
  label: string;
  /** a shortcut shown as keys after the words */
  shortcut?: string;
  /** something to look at above the words — a source's picture and its first line — never a control; mounted only
   * while the tooltip is shown, so what it reads is read on hover */
  content?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** the catalogue only: shown without the pointer */
  debugState?: "open";
  /** the control it describes (its accessible description becomes the tooltip) */
  children: ReactElement<{ "aria-describedby"?: string; "aria-expanded"?: boolean | "true" | "false" }>;
};

type Side = NonNullable<TooltipProps["side"]>;

// ponytail: the bubble is placed in fixed position from its control's box — a scrolling frame around the control (a
// table, a pane) neither clips it nor grows a scroll bar for it — centred on the control, on the other side when its
// own has no room, and kept inside the window; while shown it is a manual popover in the browser's top layer, so no
// ancestor traps it — not a stacking context (a sticky head, the dock, a modal), nor a filter or a transform that would
// make « fixed » relative to itself (the modal's blurred scrim, a button's hover). The attribute comes and goes with
// the bubble: a page without the top layer (jsdom) keeps the plain fixed bubble rather than hiding it
function place(want: Side, a: DOMRect, b: HTMLElement): { side: Side; style: CSSProperties } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = b.offsetWidth + GUTTER;
  const h = b.offsetHeight + GUTTER;
  const side: Side =
    want === "top" && a.top < h && vh - a.bottom >= h
      ? "bottom"
      : want === "bottom" && vh - a.bottom < h && a.top >= h
        ? "top"
        : want === "left" && a.left < w && vw - a.right >= w
          ? "right"
          : want === "right" && vw - a.right < w && a.left >= w
            ? "left"
            : want;
  const x = Math.max(GUTTER, Math.min(a.left + a.width / 2 - b.offsetWidth / 2, vw - b.offsetWidth - GUTTER));
  const y = Math.max(GUTTER, Math.min(a.top + a.height / 2 - b.offsetHeight / 2, vh - b.offsetHeight - GUTTER));
  const style: CSSProperties =
    side === "top"
      ? { left: x, bottom: vh - a.top }
      : side === "bottom"
        ? { left: x, top: a.bottom }
        : side === "left"
          ? { top: y, right: vw - a.left }
          : { top: y, left: a.right };
  return { side, style };
}

// ponytail: shown on hover after 500 ms and at once on keyboard focus, hidden on Escape and while the control's own
// layer (a menu, a popover) is open; never interactive and never the only place for what is needed to act (SYSTEM.md)
export function Tooltip({ label, shortcut, content, side = "top", children, debugState }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const expanded = children.props["aria-expanded"] === true || children.props["aria-expanded"] === "true";
  const shown = (open || debugState === "open") && !expanded;
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ side: Side; style: CSSProperties }>();
  useLayoutEffect(() => {
    if (!shown) return;
    const b = bubble.current && "showPopover" in bubble.current ? bubble.current : undefined;
    b?.setAttribute("popover", "manual");
    b?.showPopover();
    const put = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (a && bubble.current) setAt(place(side, a, bubble.current));
    };
    put();
    window.addEventListener("resize", put);
    window.addEventListener("scroll", put, true);
    return () => {
      window.removeEventListener("resize", put);
      window.removeEventListener("scroll", put, true);
      if (b?.isConnected) b.hidePopover();
      b?.removeAttribute("popover");
    };
  }, [shown, side]);
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <span
      ref={anchor}
      {...stylex.props(styles.anchor)}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
      }}
      onMouseLeave={hide}
      onFocus={() => {
        if (keyboardFocus()) setOpen(true);
      }}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        ref={bubble}
        role="tooltip"
        id={id}
        style={shown ? at?.style : undefined}
        {...stylex.props(
          styles.bubble,
          !!content && styles.rich,
          styles[(shown && at?.side) || side],
          !shown && styles.closed,
        )}
      >
        {shown && content}
        {label}
        {shortcut && <Kbd onFill>{shortcut}</Kbd>}
      </span>
    </span>
  );
}
