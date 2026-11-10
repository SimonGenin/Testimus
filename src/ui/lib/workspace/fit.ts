import { COLUMN_WIDTH, type Column, columnCollapsed, type Layout } from "./layout.ts";

export const SECTION_MIN = COLUMN_WIDTH.min;
/** the least the work's column keeps (the test reviewed, the step played) */
export const MAIN_MIN = 420;
export const STRIP = 40;
export const GAP = 6;
/** px: the least a section of a split column keeps — dragged past it, it folds to its tab bar */
export const SECTION_MIN_HEIGHT = 120;

/** the least a column keeps while open: the work's more */
export const floorOf = (main: boolean): number => (main ? MAIN_MIN : SECTION_MIN);

/** the room a column asks for: a strip when collapsed, its width (or the least its sections need) when open */
export const columnNeed = (c: Column, main = false): number =>
  columnCollapsed(c) ? STRIP : Math.max(floorOf(main), c.width ?? 0);

// ponytail: a narrow window folds columns to their strip, the rightmost first, the work's and the one in use last —
// when both cannot fit, the one in use stays (the user just opened it) and the work's folds; what the user chose is
// kept, only what is drawn changes
export function overflowed(
  l: Layout,
  width: number,
  keep: Set<number>,
  main?: number,
  inUse: number | undefined = main,
): Set<number> {
  const folded = new Set<number>();
  if (!Number.isFinite(width) || width <= 0) return folded;
  const need = () =>
    l.columns.reduce((sum, c, i) => sum + (folded.has(i) ? STRIP : columnNeed(c, i === main)), 0) +
    GAP * Math.max(0, l.columns.length - 1);
  for (const spare of [(i: number) => !keep.has(i), (i: number) => i !== inUse])
    for (let i = l.columns.length - 1; i >= 0 && need() > width; i--)
      if (spare(i) && !columnCollapsed(l.columns[i])) folded.add(i);
  return folded;
}

/** the widest a column can be drawn before the window must fold another: the room less what the others need */
export function roomFor(
  l: Layout,
  width: number,
  column: number,
  strip: (i: number) => boolean,
  main?: number,
): number {
  const others = l.columns.reduce(
    (sum, c, i) => (i === column ? sum : sum + (strip(i) ? STRIP : columnNeed(c, i === main))),
    0,
  );
  return Math.floor(width - others - GAP * Math.max(0, l.columns.length - 1));
}
