import { type Column, columnCollapsed, type Layout } from "./layout.ts";

export const SECTION_MIN = 300;
/** the least the work's column keeps (the test reviewed, the step played) */
export const MAIN_MIN = 420;
export const STRIP = 40;
export const GAP = 6;

/** the room a column asks for: a strip when collapsed, its width (or the least its sections need) when open */
export const columnNeed = (c: Column, main = false): number =>
  columnCollapsed(c) ? STRIP : Math.max(main ? MAIN_MIN : SECTION_MIN, c.width ?? 0);

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
