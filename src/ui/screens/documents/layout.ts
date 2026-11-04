import { useState } from "react";
import { type PrefName, usePref } from "../../lib/prefs.ts";

export type Fold = "wide" | "medium" | "small" | "tiny";

export const TEXT = 496;
export const COLS = { list: 248, toc: 256, side: 300 };
export type Cols = typeof COLS;
export type Col = keyof Cols;

const LIMITS: Record<Col, { pref: PrefName & `docs${string}Width`; min: number; max: number }> = {
  list: { pref: "docsListWidth", min: 200, max: 420 },
  toc: { pref: "docsTocWidth", min: 180, max: 420 },
  side: { pref: "docsSideWidth", min: 260, max: 520 },
};

// ponytail: the outer columns fold first so the text keeps TEXT px, at the widths the user dragged them to
export const foldOf = (width: number, c: Cols = COLS): Fold =>
  width >= c.list + c.toc + c.side + TEXT
    ? "wide"
    : width >= c.toc + c.side + TEXT
      ? "medium"
      : width >= c.toc + TEXT
        ? "small"
        : "tiny";

export const SHOWN: Record<Fold, Col[]> = {
  wide: ["list", "toc", "side"],
  medium: ["toc", "side"],
  small: ["toc"],
  tiny: [],
};

export type Pane = {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (px: number) => void;
  onCommit: (px: number) => void;
};

// ponytail: a pane's width is the one being dragged, else the one last chosen (lib/prefs), else its default
function usePane(col: Col): Pane {
  const l = LIMITS[col];
  const [kept, keep] = usePref(l.pref);
  const [live, setLive] = useState<number | null>(null);
  return {
    value: live ?? kept ?? COLS[col],
    min: l.min,
    max: l.max,
    defaultValue: COLS[col],
    onChange: setLive,
    onCommit: (px) => {
      keep(px === COLS[col] ? null : px);
      setLive(null);
    },
  };
}

// ponytail: a column grows only into the room the text can spare, so a drag never folds what it resizes
export function useDocsLayout(width: number): { fold: Fold; panes: Record<Col, Pane> } {
  const raw = { list: usePane("list"), toc: usePane("toc"), side: usePane("side") };
  const cols = { list: raw.list.value, toc: raw.toc.value, side: raw.side.value };
  const fold = foldOf(width, cols);
  const room = (col: Col) => {
    const others = SHOWN[fold].filter((k) => k !== col).reduce((sum, k) => sum + cols[k], 0);
    return Math.min(raw[col].max, Math.max(cols[col], width - others - TEXT));
  };
  return {
    fold,
    panes: {
      list: { ...raw.list, max: room("list") },
      toc: { ...raw.toc, max: room("toc") },
      side: { ...raw.side, max: room("side") },
    },
  };
}
