import { describe, expect, it } from "vitest";
import { overflowed } from "../../../../src/ui/lib/workspace/fit.ts";
import {
  addRefusal,
  addSection,
  allSections,
  column,
  dropPending,
  type Layout,
  layoutOf,
  moveTab,
  neighbor,
  normalize,
  pendingSection,
  place,
  REFUSED,
  refusal,
  resizeColumn,
  resizeSplit,
  reveal,
  section,
  sectionCount,
  sectionOf,
  setActive,
  setCollapsed,
} from "../../../../src/ui/lib/workspace/layout.ts";
import { insertIndex, targetOf, zoneAt } from "../../../../src/ui/lib/workspace/zones.ts";

const TABS = ["queue", "test", "source", "claude"];
const REVIEW = layoutOf(
  column(300, section(["queue"])),
  column(null, section(["test"])),
  column(420, section(["source", "claude"])),
);
const tabsOf = (l: Layout) => l.columns.map((c) => c.sections.map((s) => s.tabs));

describe("a screen's layout", () => {
  it("is written as columns of sections, each section numbered", () => {
    expect(tabsOf(REVIEW)).toEqual([[["queue"]], [["test"]], [["source", "claude"]]]);
    expect(allSections(REVIEW).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(sectionOf(REVIEW, "claude")?.active).toBe("source");
  });

  it("reads back what was kept, and its own layout for anything it cannot read", () => {
    expect(normalize(REVIEW, TABS, REVIEW)).toEqual(REVIEW);
    expect(normalize(null, TABS, REVIEW)).toEqual(REVIEW);
    expect(normalize("nonsense", TABS, REVIEW)).toEqual(REVIEW);
    expect(normalize({ columns: [{ sections: "x" }] }, TABS, REVIEW)).toEqual(REVIEW);
  });

  it("drops tabs the screen no longer has, adds the new ones to the last section, keeps each tab once", () => {
    const kept = layoutOf(
      column(300, section(["queue", "gone"])),
      column(null, section(["test", "queue"])),
      column(420, section(["claude"])),
    );
    const l = normalize(kept, TABS, REVIEW);
    expect(tabsOf(l)).toEqual([[["queue"]], [["test"]], [["claude", "source"]]]);
  });

  it("keeps the limits when what was kept breaks them: 2 per column, 4 at most, 2 at least", () => {
    const three = layoutOf(column(null, section(["a"]), section(["b"]), section(["c"])));
    const fixed = normalize(three, ["a", "b", "c"], REVIEW);
    expect(fixed.columns[0].sections).toHaveLength(2);
    expect(fixed.columns[0].sections[1].tabs).toEqual(["b", "c"]);
    const five = layoutOf(...["a", "b", "c", "d", "e"].map((t) => column(200, section([t]))));
    expect(sectionCount(normalize(five, ["a", "b", "c", "d", "e"], REVIEW))).toBe(4);
    const one = layoutOf(column(null, section(TABS)));
    expect(normalize(one, TABS, REVIEW)).toEqual(REVIEW);
  });

  it("clamps kept widths and splits to what a column may take", () => {
    const wild = layoutOf(
      column(5, section(["queue"])),
      column(null, section(["test"]), section(["source", "claude"])),
    );
    wild.columns[1].split = 99;
    const l = normalize(wild, TABS, REVIEW);
    expect(l.columns[0].width).toBe(200);
    expect(l.columns[1].split).toBe(95);
  });
});

describe("moving a tab", () => {
  it("goes among another section's tabs, which shows it and opens", () => {
    const folded = setCollapsed(REVIEW, "s1", true);
    const l = moveTab(folded, "claude", { kind: "tabs", section: "s1", index: 0 });
    expect(tabsOf(l)).toEqual([[["claude", "queue"]], [["test"]], [["source"]]]);
    expect(allSections(l)[0]).toMatchObject({ active: "claude", collapsed: false });
  });

  it("reorders within its own section", () => {
    const l = moveTab(REVIEW, "claude", { kind: "tabs", section: "s3", index: 0 });
    expect(tabsOf(l)[2]).toEqual([["claude", "source"]]);
    expect(tabsOf(moveTab(l, "claude", { kind: "tabs", section: "s3", index: 2 }))[2]).toEqual([["source", "claude"]]);
  });

  it("splits a column, above or below", () => {
    const below = moveTab(REVIEW, "claude", { kind: "split", section: "s2", where: "below" });
    expect(tabsOf(below)).toEqual([[["queue"]], [["test"], ["claude"]], [["source"]]]);
    const above = moveTab(REVIEW, "claude", { kind: "split", section: "s2", where: "above" });
    expect(tabsOf(above)[1]).toEqual([["claude"], ["test"]]);
  });

  it("opens a new column on either side", () => {
    const l = moveTab(REVIEW, "claude", { kind: "column", column: 0, side: "left" });
    expect(tabsOf(l)).toEqual([[["claude"]], [["queue"]], [["test"]], [["source"]]]);
    expect(l.columns[0].width).toBe(320);
  });

  it("leaves a section emptied of its last tab behind: it goes, its place to the others", () => {
    const l = moveTab(REVIEW, "queue", { kind: "tabs", section: "s2", index: 1 });
    expect(tabsOf(l)).toEqual([[["test", "queue"]], [["source", "claude"]]]);
    expect(sectionCount(l)).toBe(2);
  });

  it("says why it cannot go there, and does not move", () => {
    const two = layoutOf(column(null, section(["test"])), column(300, section(["claude"])));
    expect(refusal(two, "claude", { kind: "tabs", section: "s1", index: 1 })).toBe(REFUSED.fewest);
    expect(moveTab(two, "claude", { kind: "tabs", section: "s1", index: 1 })).toBe(two);
    const four = moveTab(REVIEW, "claude", { kind: "column", column: 2, side: "right" });
    expect(sectionCount(four)).toBe(4);
    expect(refusal(four, "source", { kind: "split", section: "s1", where: "below" })).toBe(null);
    expect(refusal(four, "test", { kind: "column", column: 0, side: "left" })).toBe(null);
    const stacked = moveTab(REVIEW, "claude", { kind: "split", section: "s2", where: "below" });
    expect(refusal(stacked, "queue", { kind: "split", section: "s2", where: "above" })).toBe(REFUSED.column);
    expect(refusal(REVIEW, "queue", { kind: "split", section: "s1", where: "below" })).toBe(REFUSED.same);
    expect(refusal(REVIEW, "queue", { kind: "column", column: 0, side: "right" })).toBe(REFUSED.same);
    const full = layoutOf(...["a", "b", "c", "d"].map((t) => column(200, section([t, `${t}2`]))));
    expect(refusal(full, "a2", { kind: "column", column: 3, side: "right" })).toBe(REFUSED.most);
  });

  it("goes to the next section with Alt Shift and an arrow, or to a new place at the edge", () => {
    expect(neighbor(REVIEW, "s1", "right")).toEqual({ kind: "tabs", section: "s2", index: 1 });
    expect(neighbor(REVIEW, "s1", "left")).toEqual({ kind: "column", column: 0, side: "left" });
    expect(neighbor(REVIEW, "s2", "down")).toEqual({ kind: "split", section: "s2", where: "below" });
    const stacked = moveTab(REVIEW, "claude", { kind: "split", section: "s2", where: "below" });
    const lower = stacked.columns[1].sections[1].id;
    expect(neighbor(stacked, lower, "up")).toEqual({ kind: "tabs", section: "s2", index: 1 });
  });
});

describe("a tab that comes and goes", () => {
  it("arrives in the nearest section right of the work, shown and open", () => {
    const l = place(setCollapsed(REVIEW, "s3", true), "analysis", "test");
    expect(tabsOf(l)).toEqual([[["queue"]], [["test"]], [["source", "claude", "analysis"]]]);
    expect(sectionOf(l, "analysis")).toMatchObject({ active: "analysis", collapsed: false });
  });

  it("opens a column on the right when nothing is right of the work, and never joins the work's section", () => {
    const two = layoutOf(column(300, section(["queue", "claude"])), column(null, section(["test"])));
    expect(tabsOf(place(two, "analysis", "test"))).toEqual([[["queue", "claude"]], [["test"]], [["analysis"]]]);
    const full = layoutOf(
      column(300, section(["queue"]), section(["source"])),
      column(null, section(["test"]), section(["claude"])),
    );
    expect(tabsOf(place(full, "analysis", "test"))).toEqual([
      [["queue"], ["source"]],
      [["test"], ["claude", "analysis"]],
    ]);
  });

  it("comes back to the section it was in last, and is only shown when it is already there", () => {
    expect(tabsOf(place(REVIEW, "analysis", "test", "s1"))[0]).toEqual([["queue", "analysis"]]);
    expect(tabsOf(place(REVIEW, "analysis", "test", "gone"))[2]).toEqual([["source", "claude", "analysis"]]);
    expect(sectionOf(place(REVIEW, "claude", "test"), "claude")?.active).toBe("claude");
  });
});

describe("adding, folding, resizing", () => {
  it("adds an empty section that waits for a tab, and drops it when dismissed", () => {
    const l = addSection(REVIEW, "column");
    const waiting = pendingSection(l);
    expect(waiting).toMatchObject({ tabs: [], pending: true });
    expect(sectionCount(l)).toBe(4);
    expect(addRefusal(l, "column")).toBe(REFUSED.most);
    const filled = moveTab(l, "claude", { kind: "tabs", section: waiting?.id ?? "", index: 0 });
    expect(pendingSection(filled)).toBeUndefined();
    expect(tabsOf(filled)[3]).toEqual([["claude"]]);
    expect(dropPending(l)).toEqual(REVIEW);
  });

  it("adds a section under another unless its column is full", () => {
    const l = addSection(REVIEW, { split: "s2" });
    expect(l.columns[1].sections).toHaveLength(2);
    expect(addRefusal(l, { split: "s2" })).toBe(REFUSED.most);
    const two = layoutOf(column(null, section(["test"]), section(["claude"])), column(300, section(["queue"])));
    expect(addRefusal(two, { split: "s1" })).toBe(REFUSED.column);
  });

  it("folds and opens a section; showing a tab opens its section on it", () => {
    const folded = setCollapsed(REVIEW, "s3", true);
    expect(allSections(folded)[2].collapsed).toBe(true);
    const shown = reveal(folded, "claude");
    expect(allSections(shown)[2]).toMatchObject({ active: "claude", collapsed: false });
    expect(reveal(shown, "claude")).toBe(shown);
    expect(setActive(REVIEW, "s3", "nope")).toEqual(REVIEW);
  });

  it("resizes a column and the share of a split column, within limits", () => {
    expect(resizeColumn(REVIEW, 0, 9999).columns[0].width).toBe(4000);
    expect(resizeColumn(REVIEW, 0, 50).columns[0].width).toBe(200);
    const stacked = moveTab(REVIEW, "claude", { kind: "split", section: "s2", where: "below" });
    expect(resizeSplit(stacked, 1, 10).columns[1].split).toBe(10);
    expect(resizeSplit(stacked, 1, 1).columns[1].split).toBe(5);
    expect(resizeSplit(REVIEW, 1, 40).columns[1].split).toBe(null);
  });
});

describe("a narrow window", () => {
  it("folds the rightmost columns it cannot hold, never the work nor the one in use", () => {
    expect(overflowed(REVIEW, 2000, new Set([1])).size).toBe(0);
    expect([...overflowed(REVIEW, 900, new Set([1]))]).toEqual([2]);
    expect([...overflowed(REVIEW, 500, new Set([1]))].sort()).toEqual([0, 2]);
    expect([...overflowed(REVIEW, 900, new Set([1, 2]))]).toEqual([0]);
  });

  it("keeps the work's column at its least width; when it and the one in use cannot both fit, the one in use stays", () => {
    expect([...overflowed(REVIEW, 1200, new Set([1, 2]), 1)]).toEqual([]);
    expect([...overflowed(REVIEW, 760, new Set([1]), 1)].sort()).toEqual([0, 2]);
    expect([...overflowed(REVIEW, 760, new Set([1, 2]), 1, 2)].sort()).toEqual([0, 1]);
    expect([...overflowed(REVIEW, 460, new Set([0, 1]), 1, 0)].sort()).toEqual([1, 2]);
  });
});

describe("where a dragged tab lands", () => {
  const box = { left: 0, top: 0, width: 400, height: 440 };
  it("reads the tab bar, the edges and the middle of a section", () => {
    expect(zoneAt(box, 40, 200, 20)).toBe("tabs");
    expect(zoneAt(box, 40, 20, 200)).toBe("left");
    expect(zoneAt(box, 40, 390, 200)).toBe("right");
    expect(zoneAt(box, 40, 200, 60)).toBe("above");
    expect(zoneAt(box, 40, 200, 430)).toBe("below");
    expect(zoneAt(box, 40, 200, 240)).toBe("center");
  });

  it("gives the middle the place of an edge that cannot take the tab", () => {
    expect(zoneAt(box, 40, 200, 60, ["left", "right"])).toBe("center");
    expect(zoneAt(box, 40, 200, 430, ["left", "right"])).toBe("center");
    expect(zoneAt(box, 40, 20, 60, ["above", "below"])).toBe("above");
    expect(zoneAt(box, 40, 20, 200, [])).toBe("center");
  });

  it("takes a place among the tabs, and turns a zone into a move", () => {
    const tabs = [
      { left: 0, top: 0, width: 100, height: 30 },
      { left: 100, top: 0, width: 100, height: 30 },
    ];
    expect(insertIndex(tabs, 10)).toBe(0);
    expect(insertIndex(tabs, 160)).toBe(2);
    expect(insertIndex(tabs, 120)).toBe(1);
    expect(targetOf(REVIEW, "s2", "center", 0, 1)).toEqual({ kind: "tabs", section: "s2", index: 1 });
    expect(targetOf(REVIEW, "s2", "right", 0, 1)).toEqual({ kind: "column", column: 1, side: "right" });
    expect(targetOf(REVIEW, "s2", "below", 0, 1)).toEqual({ kind: "split", section: "s2", where: "below" });
    expect(targetOf(REVIEW, "nope", "center", 0, 1)).toBe(null);
  });
});
