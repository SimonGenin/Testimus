// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionControls } from "../../../../src/ui/components/ui/workspace/SectionControls.tsx";
import { useSideTab } from "../../../../src/ui/components/ui/workspace/useSideTab.tsx";
import { Workspace } from "../../../../src/ui/components/ui/workspace/Workspace.tsx";
import { column, layoutOf, section } from "../../../../src/ui/lib/workspace/layout.ts";
import { askReveal } from "../../../../src/ui/lib/workspace/signals.ts";
import { useWorkspace } from "../../../../src/ui/lib/workspace/useWorkspace.ts";

const LAYOUT = layoutOf(
  column(300, section(["queue"])),
  column(null, section(["test"])),
  column(420, section(["source", "claude"])),
);

function Work() {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  const side = useSideTab(
    { id: "analysis", label: "Analysis", icon: "verify", ...(n ? { count: n } : {}) },
    open,
    <button type="button" onClick={() => setN((x) => x + 1)}>
      Count one more
    </button>,
  );
  return (
    <>
      <p>the test</p>
      <button type="button" onClick={() => (open && !side.shown ? side.reveal() : setOpen(!open))}>
        Analysis
      </button>
      {side.node}
    </>
  );
}

function Screen({ work = <p>the test</p> }: { work?: ReactNode }) {
  const ws = useWorkspace({
    pref: "layoutReview",
    label: "Review",
    defaults: LAYOUT,
    tabs: [
      { id: "queue", label: "Queue", icon: "list", count: 2, content: <p>the queue</p> },
      {
        id: "test",
        label: "Test",
        icon: "tests",
        main: true,
        content: work,
        footer: <button type="button">Validate</button>,
      },
      { id: "source", label: "Source", icon: "quote", content: <input aria-label="note" /> },
      { id: "claude", label: "Claude", icon: "claude", claude: true, dot: "claude", content: <p>Claude here</p> },
    ],
  });
  return (
    <>
      <SectionControls ws={ws} />
      <Workspace ws={ws} />
    </>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const kept = () => JSON.parse(localStorage.getItem("testimus.layoutReview") ?? "null");
const tabsKept = () => kept().columns.map((c: { sections: { tabs: string[] }[] }) => c.sections.map((s) => s.tabs));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Workspace", () => {
  it("draws each section's tabs with their icons, the tab shown and its foot", () => {
    render(<Screen />);
    expect(screen.getAllByRole("tablist")).toHaveLength(3);
    expect(tab("Queue")).toHaveAttribute("aria-selected", "true");
    expect(tab("Queue").querySelector('[data-icon="list"]')).not.toBeNull();
    expect(tab("Queue")).toHaveTextContent("2");
    expect(screen.getByRole("tabpanel", { name: /Test/ })).toHaveTextContent("the test");
    expect(screen.getByRole("button", { name: "Validate" })).toBeInTheDocument();
    expect(screen.queryByText("Claude here")).toBeNull();
  });

  it("switches tabs by click and by arrows, keeping what a tab held", () => {
    render(<Screen />);
    fireEvent.change(screen.getByRole("textbox", { name: "note" }), { target: { value: "kept" } });
    fireEvent.click(tab("Claude"));
    expect(screen.getByText("Claude here")).toBeVisible();
    expect(tab("Claude")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Claude"), { key: "ArrowLeft" });
    expect(tab("Source")).toHaveAttribute("aria-selected", "true");
    expect(tab("Source")).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "note" })).toHaveValue("kept");
    expect(tabsKept()[2]).toEqual([["source", "claude"]]);
    expect(kept().columns[2].sections[0].active).toBe("source");
  });

  it("folds a column to its strip of icons, and a click on one opens it on that tab", () => {
    render(<Screen />);
    const bars = screen.getAllByRole("tablist");
    fireEvent.click(
      within(bars[2].parentElement as HTMLElement).getByRole("button", { name: "Collapse this section" }),
    );
    const strip = screen.getByRole("navigation", { name: "Section 3, collapsed" });
    expect(within(strip).getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
    expect(kept().columns[2].sections[0].collapsed).toBe(true);
    fireEvent.click(within(strip).getByRole("button", { name: "Claude" }));
    expect(screen.queryByRole("navigation", { name: "Section 3, collapsed" })).toBeNull();
    expect(tab("Claude")).toHaveAttribute("aria-selected", "true");
  });

  it("moves a tab with Alt Shift and an arrow, and from the section's menu, saying why when it cannot", async () => {
    const user = userEvent.setup();
    render(<Screen />);
    fireEvent.click(tab("Claude"));
    fireEvent.keyDown(tab("Claude"), { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(tabsKept()).toEqual([[["queue"]], [["test", "claude"]], [["source"]]]);
    const menus = screen.getAllByRole("button", { name: "Section menu" });
    await user.click(menus[0]);
    expect(screen.getByRole("menuitem", { name: /Section 2 · Claude/ })).not.toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: /A new section below/ }));
    expect(tabsKept()).toEqual([[["queue"]], [["test", "claude"]], [["source"]]]);
    await user.click(screen.getAllByRole("button", { name: "Section menu" })[2]);
    await user.click(screen.getByRole("menuitem", { name: /Section 2 · Claude/ }));
    expect(tabsKept()).toEqual([[["queue"]], [["test", "claude", "source"]]]);
    await user.click(screen.getAllByRole("button", { name: "Section menu" })[0]);
    const refused = screen.getByRole("menuitem", { name: /Section 2 · Source/ });
    expect(refused).toHaveAttribute("aria-disabled", "true");
    expect(refused).toHaveAccessibleDescription(/2 sections at least/);
  });

  it("adds a column from the top bar: it waits for a tab, takes one, or goes on Escape", async () => {
    const user = userEvent.setup();
    render(<Screen />);
    const bar = screen.getByRole("group", { name: "Sections of Review" });
    expect(bar).toHaveTextContent("3/4");
    await user.click(within(bar).getByRole("button", { name: "Add column" }));
    expect(bar).toHaveTextContent("4/4");
    expect(within(bar).getByRole("button", { name: "Add column" })).toBeDisabled();
    expect(screen.getByText("Drag a tab here, or move one:")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Drag a tab here, or move one:")).toBeNull();
    await user.click(within(bar).getByRole("button", { name: "Add column" }));
    await user.click(screen.getByRole("button", { name: "Claude" }));
    expect(tabsKept()).toEqual([[["queue"]], [["test"]], [["source"]], [["claude"]]]);
  });

  it("starts from what was kept, and Reset goes back to the screen's own layout", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "testimus.layoutReview",
      JSON.stringify(layoutOf(column(null, section(["test", "queue"])), column(300, section(["claude", "source"])))),
    );
    render(<Screen />);
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Layout menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset the layout of Review" }));
    expect(screen.getAllByRole("tablist")).toHaveLength(3);
    expect(tabsKept()).toEqual([[["queue"]], [["test"]], [["source", "claude"]]]);
  });

  it("shows a tab the shell asks for, and folds it when asked to toggle", () => {
    render(<Screen />);
    act(() => askReveal("claude"));
    expect(tab("Claude")).toHaveAttribute("aria-selected", "true");
    act(() => askReveal("claude", true));
    expect(screen.getByRole("navigation", { name: "Section 3, collapsed" })).toBeInTheDocument();
    act(() => askReveal("claude", true));
    expect(tab("Claude")).toHaveAttribute("aria-selected", "true");
  });

  it("drops a dragged tab where the pointer leaves it, with the zone it would take", () => {
    render(<Screen />);
    const target = document.querySelectorAll<HTMLElement>("[data-ws-section]")[1];
    target.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 440,
      right: 400,
      bottom: 440,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const at = vi.fn(() => target);
    document.elementFromPoint = at;
    fireEvent.pointerDown(tab("Source"), { button: 0, clientX: 900, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 420 });
    expect(screen.getByRole("status")).toHaveTextContent("Split: below");
    fireEvent.pointerUp(window, { clientX: 200, clientY: 420 });
    expect(tabsKept()).toEqual([[["queue"]], [["test"], ["source"]], [["claude"]]]);
    fireEvent.click(tab("Source"));
    expect(tab("Source")).toHaveAttribute("aria-selected", "true");
  });

  it("an edge dragged past a column's least width says it will fold and folds it on release, its width kept", () => {
    render(<Screen />);
    const edge = screen.getByRole("separator", { name: "Resize sections 1 and 2" });
    expect(edge).toHaveAttribute("aria-valuemin", "200");
    fireEvent.pointerDown(edge, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 380 });
    expect(edge).toHaveAttribute("aria-valuenow", "200");
    expect(screen.queryByText("Release to collapse")).toBeNull();
    fireEvent.pointerMove(edge, { clientX: 360 });
    expect(screen.getByRole("status")).toHaveTextContent("Release to collapse");
    fireEvent.pointerMove(edge, { clientX: 450 });
    expect(screen.queryByText("Release to collapse")).toBeNull();
    fireEvent.pointerMove(edge, { clientX: 300 });
    fireEvent.pointerUp(edge);
    expect(screen.getByRole("navigation", { name: "Section 1, collapsed" })).toBeInTheDocument();
    expect(kept().columns[0]).toMatchObject({ width: 300, sections: [{ collapsed: true }] });
  });

  it("an edge dragged past the room the column beside it needs folds that column instead", () => {
    render(<Screen />);
    const edge = screen.getByRole("separator", { name: "Resize sections 2 and 3" });
    fireEvent.pointerDown(edge, { clientX: 5000, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 5000 - 3580 - 40 });
    expect(edge).toHaveAttribute("aria-valuenow", "4000");
    expect(screen.getByRole("status")).toHaveTextContent("Release to collapse");
    fireEvent.pointerUp(edge);
    expect(kept().columns[1].sections[0].collapsed).toBe(true);
    expect(kept().columns[2]).toMatchObject({ width: 420, sections: [{ collapsed: false }] });
  });

  it("draws an edge between two open columns across a folded one, the fill taking what it gives", () => {
    localStorage.setItem(
      "testimus.layoutReview",
      JSON.stringify(
        layoutOf(
          column(300, section(["queue"])),
          column(null, section(["test"], true)),
          column(420, section(["source", "claude"])),
        ),
      ),
    );
    render(<Screen />);
    const edges = screen.getAllByRole("separator");
    expect(edges).toHaveLength(1);
    expect(edges[0]).toHaveAccessibleName("Resize sections 1 and 3");
    fireEvent.pointerDown(edges[0], { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(edges[0], { clientX: 560 });
    fireEvent.pointerUp(edges[0]);
    expect(kept().columns.map((c: { width: number | null }) => c.width)).toEqual([360, null, 420]);
  });

  it("an edge between two columns of their own width moves only them: one gains what the other gives", () => {
    localStorage.setItem(
      "testimus.layoutReview",
      JSON.stringify(
        layoutOf(
          column(null, section(["queue"])),
          column(600, section(["test"])),
          column(380, section(["source", "claude"])),
        ),
      ),
    );
    render(<Screen />);
    const edge = screen.getByRole("separator", { name: "Resize sections 2 and 3" });
    expect(edge).toHaveAttribute("aria-valuemax", String(600 + 380 - 200));
    fireEvent.pointerDown(edge, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 540 });
    fireEvent.pointerMove(edge, { clientX: 600 });
    fireEvent.pointerUp(edge);
    expect(kept().columns.map((c: { width: number | null }) => c.width)).toEqual([null, 700, 280]);
    fireEvent.pointerDown(edge, { clientX: 500, pointerId: 2 });
    fireEvent.pointerMove(edge, { clientX: 500 + 280 - 200 + 40 });
    expect(screen.getByRole("status")).toHaveTextContent("Release to collapse");
    fireEvent.pointerUp(edge);
    expect(kept().columns[2]).toMatchObject({ width: 280, sections: [{ collapsed: true }] });
    expect(kept().columns[1].width).toBe(700);
  });

  it("offers no split over a column that already has 2 sections: its middle takes the tab", () => {
    localStorage.setItem(
      "testimus.layoutReview",
      JSON.stringify(
        layoutOf(
          column(300, section(["queue"])),
          column(null, section(["test"]), section(["source"])),
          column(420, section(["claude"])),
        ),
      ),
    );
    render(<Screen />);
    const target = document.querySelectorAll<HTMLElement>("[data-ws-section]")[1];
    target.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 440,
      right: 400,
      bottom: 440,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    document.elementFromPoint = vi.fn(() => target);
    fireEvent.pointerDown(tab("Claude"), { button: 0, clientX: 900, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 420 });
    expect(screen.getByRole("status")).toHaveTextContent("Add as a tab here");
    expect(screen.queryByText(/^Split:/)).toBeNull();
    expect(screen.getByText("New column on the left")).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 200, clientY: 420 });
    expect(tabsKept()).toEqual([[["queue"]], [["test", "claude"], ["source"]]]);
  });

  it("a tab the work opens arrives beside it, shown; it holds what the work draws there, and goes when closed", () => {
    render(<Screen work={<Work />} />);
    fireEvent.click(screen.getByRole("button", { name: "Analysis" }));
    expect(tab("Analysis")).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tablist")[2]).toContainElement(tab("Analysis"));
    expect(tab("Test")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Count one more" }));
    expect(tab("Analysis")).toHaveTextContent("1");
    fireEvent.click(tab("Claude"));
    fireEvent.click(screen.getByRole("button", { name: "Analysis" }));
    expect(tab("Analysis")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Analysis" }));
    expect(screen.queryByRole("tab", { name: /^Analysis/ })).toBeNull();
  });

  it("comes back to the section the user moved it to", async () => {
    render(<Screen work={<Work />} />);
    const toggle = () => fireEvent.click(screen.getByRole("button", { name: "Analysis" }));
    toggle();
    fireEvent.keyDown(tab("Analysis"), { key: "ArrowLeft", altKey: true, shiftKey: true });
    fireEvent.keyDown(tab("Analysis"), { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(screen.getAllByRole("tablist")[0]).toContainElement(tab("Analysis"));
    toggle();
    toggle();
    expect(screen.getAllByRole("tablist")[0]).toContainElement(tab("Analysis"));
  });
});
