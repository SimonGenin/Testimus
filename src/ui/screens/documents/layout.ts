import { type PaneHandle, usePaneWidth } from "../../lib/panes.ts";
import type { PrefName } from "../../lib/prefs.ts";

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

export type Pane = PaneHandle;

function usePane(col: Col): Pane {
  const l = LIMITS[col];
  return usePaneWidth(l.pref, { min: l.min, max: l.max, initial: COLS[col] }).handle;
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
