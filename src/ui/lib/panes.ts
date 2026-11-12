import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { type PrefName, usePref } from "./prefs.ts";

export type WidthPref = Extract<PrefName, `${string}Width`>;
export type SharePref = Extract<PrefName, `${string}Share`>;

export type PaneLimits = { min: number; max: number; initial: number };

// what a ResizeHandle takes, but its label and its side (the screen says those)
export type PaneHandle = {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (px: number) => void;
  onCommit: (px: number) => void;
};

export type PaneWidth = {
  /** the width to draw now: the one being dragged, else the one kept, else the design's — within the limits */
  width: number;
  /** false while the pane is at the design's width (nothing dragged, nothing kept): its CSS may decide */
  moved: boolean;
  handle: PaneHandle;
};

const clamp = (px: number, l: PaneLimits) => Math.min(l.max, Math.max(l.min, px));

// ponytail: a pane the user can widen — the width follows the drag, is kept in lib/prefs once the gesture ends, and a
// double-click (or Home) brings back the design's width, which is kept as nothing
export function usePaneWidth(name: WidthPref, limits: PaneLimits): PaneWidth {
  const [kept, keep] = usePref(name);
  const [drag, setDrag] = useState<number | null>(null);
  const width = clamp(drag ?? kept ?? limits.initial, limits);
  return {
    width,
    moved: drag !== null || kept !== null,
    handle: {
      value: width,
      min: limits.min,
      max: limits.max,
      defaultValue: limits.initial,
      onChange: setDrag,
      onCommit: (px) => {
        keep(px === limits.initial ? null : px);
        setDrag(null);
      },
    },
  };
}

const SHARE = { min: 20, max: 80, initial: 50 };

export type PaneShare = {
  /** the first pane's share of the frame, in percent: the one being dragged, else the one kept, else half */
  share: number;
  /** the frame the two panes split: its size turns a drag in px into a share */
  frame: RefObject<HTMLDivElement | null>;
  handle: PaneHandle;
};

// ponytail: whether a frame is at least this wide, measured as it resizes — wide until measured (a page without layout)
export function useWide(min: number): { frame: RefObject<HTMLElement | null>; wide: boolean } {
  const frame = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { frame, wide: !width || width >= min };
}

// ponytail: two panes splitting one frame (side by side: its width, one above the other: its height) — the first one's
// share follows the drag, is kept in lib/prefs once the gesture ends, and a double-click (or Home) brings back half
export function usePaneShare(name: SharePref, axis: "width" | "height"): PaneShare {
  const [kept, keep] = usePref(name);
  const [drag, setDrag] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const [total, setTotal] = useState(0);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setTotal(axis === "width" ? el.clientWidth : el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);
  const share = Math.min(SHARE.max, Math.max(SHARE.min, drag ?? kept ?? SHARE.initial));
  const px = (pct: number) => Math.round((pct * total) / 100);
  const pct = (v: number) => (total ? Math.round((v * 100) / total) : share);
  return {
    share,
    frame,
    handle: {
      value: px(share),
      min: px(SHARE.min),
      max: px(SHARE.max),
      defaultValue: px(SHARE.initial),
      onChange: (v) => setDrag(pct(v)),
      onCommit: (v) => {
        const next = pct(v);
        keep(next === SHARE.initial ? null : next);
        setDrag(null);
      },
    },
  };
}
