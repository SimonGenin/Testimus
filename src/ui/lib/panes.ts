import { useState } from "react";
import { type PrefName, usePref } from "./prefs.ts";

export type WidthPref = Extract<PrefName, `${string}Width`>;

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
