import { type Layout, locate, type Target } from "./layout.ts";

export type Box = { left: number; top: number; width: number; height: number };

/** where in a section a dragged tab is: its tab bar, its middle, or one of its edges */
export type Zone = "tabs" | "center" | "above" | "below" | "left" | "right";

const EDGE_X = 0.2;
const EDGE_Y = 0.3;

// ponytail: the tab bar takes the tab at a place among the others; under it, the outer fifth left or right opens a
// column, the outer third above or below splits the column, the rest adds the tab at the end
export function zoneAt(section: Box, bar: number, x: number, y: number): Zone {
  if (y - section.top < bar) return "tabs";
  const fx = (x - section.left) / Math.max(1, section.width);
  const fy = (y - section.top - bar) / Math.max(1, section.height - bar);
  if (fx < EDGE_X) return "left";
  if (fx > 1 - EDGE_X) return "right";
  if (fy < EDGE_Y) return "above";
  if (fy > 1 - EDGE_Y) return "below";
  return "center";
}

/** the place among the tabs a drop at x takes: before the first tab whose middle is right of it */
export function insertIndex(tabs: Box[], x: number): number {
  const i = tabs.findIndex((t) => x < t.left + t.width / 2);
  return i < 0 ? tabs.length : i;
}

export function targetOf(l: Layout, sectionId: string, zone: Zone, index: number, count: number): Target | null {
  const at = locate(l, sectionId);
  if (!at) return null;
  switch (zone) {
    case "tabs":
      return { kind: "tabs", section: sectionId, index };
    case "center":
      return { kind: "tabs", section: sectionId, index: count };
    case "above":
    case "below":
      return { kind: "split", section: sectionId, where: zone };
    default:
      return { kind: "column", column: at.column, side: zone };
  }
}
