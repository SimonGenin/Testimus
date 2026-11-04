import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

// ponytail: what Tab can reach inside a layer, in document order (the modal's trap, a popover's first field)
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]"));
}

export type Anchored = { style: CSSProperties | undefined; up: boolean; beside?: boolean };

const GUTTER = 8;

// ponytail: the shared mechanics of Menu and Popover — a layer in fixed position computed from its trigger's box
// (so it leaves a narrow pane), below it or above when there is no room, its start or end edge on the trigger's (a
// start layer that would leave the window jumps to the trigger's other edge, or with slide moves back just enough;
// beside: right of the trigger, its top on the trigger's, for a trigger in the rail),
// following scroll and resize, and closed by a press outside the trigger and the layer
export function useAnchor({
  open,
  anchor,
  layer,
  align,
  slide = false,
  onDismiss,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  layer: RefObject<HTMLElement | null>;
  align: "start" | "end" | "beside";
  slide?: boolean;
  onDismiss: () => void;
}): Anchored {
  const [placed, setPlaced] = useState<Anchored>({ style: undefined, up: false });
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const l = layer.current;
      if (!a || !l) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (align === "beside") {
        const top = Math.max(GUTTER, Math.min(a.top, vh - l.offsetHeight - GUTTER));
        setPlaced({ up: false, beside: true, style: { top, left: a.right } });
        return;
      }
      const below = vh - a.bottom;
      const up = l.offsetHeight > below && a.top > below;
      let start = align === "start";
      if (start && !slide && a.left + l.offsetWidth > vw && a.right - l.offsetWidth >= 0) start = false;
      else if (!start && a.right - l.offsetWidth < 0) start = true;
      const left = !start
        ? undefined
        : slide
          ? Math.max(GUTTER, Math.min(a.left, vw - l.offsetWidth - GUTTER))
          : a.left;
      setPlaced({
        up,
        style: {
          top: up ? undefined : a.bottom,
          bottom: up ? vh - a.top : undefined,
          left,
          right: start ? undefined : vw - a.right,
        },
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, layer, align, slide]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !layer.current?.contains(t)) dismiss.current();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, anchor, layer]);
  return placed;
}
