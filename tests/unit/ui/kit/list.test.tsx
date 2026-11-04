// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { EmptyState } from "../../../../src/ui/components/ui/EmptyState.tsx";
import { List, type ListProps, optionId } from "../../../../src/ui/components/ui/List.tsx";
import { ListItem } from "../../../../src/ui/components/ui/ListItem.tsx";

afterEach(cleanup);

type T = { id: string; title: string; meta?: string; off?: boolean };
const TESTS: T[] = [
  { id: "a", title: "Sectionneur sans TK", meta: "LFRPS12-1420" },
  { id: "b", title: "Sectionneur avec TK", meta: "LFRPS12-1421" },
  { id: "c", title: "Disjoncteur", off: true },
  { id: "d", title: "Signalisation" },
];

function Tests(p: Partial<ListProps<T>>) {
  return (
    <List
      label="Tests"
      items={TESTS}
      getKey={(t) => t.id}
      renderItem={(t) => ({ title: t.title, meta: t.meta, disabled: t.off })}
      {...p}
    />
  );
}

const cls = (el: Element) => el.getAttribute("class") ?? "";

describe("List", () => {
  it("is a listbox named by its label whose rows are options, the picked one selected", () => {
    render(<Tests selected="b" />);
    const box = screen.getByRole("listbox", { name: "Tests" });
    const options = within(box).getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(screen.getByRole("option", { name: /avec TK/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /sans TK/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /Disjoncteur/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("has one tab stop — the picked row, else the first — and the arrows, Home and End move it past disabled rows", () => {
    render(<Tests selected="b" />);
    const [a, b, c, d] = screen.getAllByRole("option");
    expect(b).toHaveAttribute("tabindex", "0");
    expect(a).toHaveAttribute("tabindex", "-1");
    b.focus();
    fireEvent.keyDown(b, { key: "ArrowDown" });
    expect(d).toHaveFocus();
    expect(c).not.toHaveFocus();
    fireEvent.keyDown(d, { key: "ArrowUp" });
    expect(b).toHaveFocus();
    fireEvent.keyDown(b, { key: "Home" });
    expect(a).toHaveFocus();
    expect(a).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(a, { key: "End" });
    expect(d).toHaveFocus();
    fireEvent.keyDown(d, { key: "ArrowDown" });
    expect(d).toHaveFocus();
  });

  it("picks a row with Enter, Space or a click, never a disabled one", () => {
    const onSelect = vi.fn();
    render(<Tests onSelect={onSelect} />);
    const [a, b, c] = screen.getAllByRole("option");
    fireEvent.keyDown(a, { key: "Enter" });
    fireEvent.keyDown(b, { key: " " });
    fireEvent.click(screen.getByText("Signalisation"));
    fireEvent.click(c);
    expect(onSelect.mock.calls.map((x) => x[0])).toEqual(["a", "b", "d"]);
  });

  it("keys typed inside a row's own controls are left to them", () => {
    const onSelect = vi.fn();
    render(
      <List
        label="Tests"
        items={TESTS.slice(0, 1)}
        getKey={(t) => t.id}
        renderItem={(t) => ({ title: t.title, actions: <Button iconOnly size="xs" icon="trash" label="Delete" /> })}
        onSelect={onSelect}
        selected="a"
      />,
    );
    const row = screen.getByRole("option");
    act(() => row.focus());
    expect(row).toHaveFocus();
    const del = screen.getByRole("button", { name: "Delete" });
    fireEvent.keyDown(del, { key: "Enter" });
    fireEvent.click(del);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a row's actions on hover and on focus, in place of its trail", () => {
    render(
      <List
        label="Folders"
        items={TESTS.slice(0, 1)}
        getKey={(t) => t.id}
        renderItem={(t) => ({
          title: t.title,
          trail: "48",
          actions: <Button iconOnly size="xs" icon="download" label="Pull the folder" />,
        })}
      />,
    );
    const row = screen.getByRole("option");
    expect(screen.queryByRole("button", { name: "Pull the folder" })).toBeNull();
    expect(row).toHaveTextContent("48");
    fireEvent.pointerEnter(row);
    expect(screen.getByRole("button", { name: "Pull the folder" })).toBeVisible();
    expect(row).not.toHaveTextContent("48");
    fireEvent.pointerLeave(row);
    expect(screen.queryByRole("button", { name: "Pull the folder" })).toBeNull();
    fireEvent.focus(row);
    const pull = screen.getByRole("button", { name: "Pull the folder" });
    fireEvent.blur(row, { relatedTarget: pull });
    fireEvent.focus(pull);
    expect(screen.getByRole("button", { name: "Pull the folder" })).toBeVisible();
    fireEvent.blur(pull, { relatedTarget: document.body });
    expect(screen.queryByRole("button", { name: "Pull the folder" })).toBeNull();
  });

  it("as a tree, gives levels and open states, and → / ← open, close and go to the parent", () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const folders = [
      { id: "repo", depth: 0, open: true },
      { id: "traction", depth: 1, open: false },
      { id: "leaf", depth: 1, open: null },
    ];
    render(
      <List
        label="Jira folders"
        tree
        items={folders}
        getKey={(f) => f.id}
        renderItem={(f) => ({ title: f.id, depth: f.depth, expanded: f.open })}
        onToggle={onToggle}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("tree", { name: "Jira folders" })).toBeInTheDocument();
    const [repo, traction, leaf] = screen.getAllByRole("treeitem");
    expect(repo).toHaveAttribute("aria-level", "1");
    expect(repo).toHaveAttribute("aria-expanded", "true");
    expect(traction).toHaveAttribute("aria-level", "2");
    expect(traction).toHaveAttribute("aria-expanded", "false");
    expect(leaf).not.toHaveAttribute("aria-expanded");
    repo.focus();
    fireEvent.keyDown(repo, { key: "ArrowRight" });
    expect(traction).toHaveFocus();
    fireEvent.keyDown(traction, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenLastCalledWith("traction");
    fireEvent.keyDown(leaf, { key: "ArrowLeft" });
    expect(repo).toHaveFocus();
    fireEvent.keyDown(repo, { key: "ArrowLeft" });
    expect(onToggle).toHaveBeenLastCalledWith("repo");
    const twisty = traction.querySelector("[data-twisty]");
    if (!twisty) throw new Error("no twisty");
    fireEvent.click(twisty);
    expect(onToggle).toHaveBeenLastCalledWith("traction");
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(traction);
    expect(onSelect).toHaveBeenCalledWith("traction");
  });

  it("shows groups with a head and a count, rows in the groups' order", () => {
    render(
      <Tests
        groups={[
          { label: "Disjoncteurs", meta: "1", keys: ["d"] },
          { label: "Sectionneurs", meta: "2", keys: ["b", "a", "missing"] },
          { label: "Empty", keys: [] },
        ]}
      />,
    );
    const g = screen.getAllByRole("group");
    expect(g.map((x) => x.getAttribute("aria-label"))).toEqual(["Disjoncteurs", "Sectionneurs"]);
    expect(g[1]).toHaveTextContent("Sectionneurs2");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Signalisation",
      "Sectionneur avec TKLFRPS12-1421",
      "Sectionneur sans TKLFRPS12-1420",
    ]);
  });

  it("gives a group head an action the reader can reach, and a group without a head", () => {
    const more = vi.fn();
    render(
      <Tests
        groups={[
          {
            label: "Sectionneurs",
            meta: "9",
            keys: ["a", "b"],
            action: <Button size="xs" label="All 9" onClick={more} />,
          },
          { label: "Claude", head: false, keys: ["d"] },
        ]}
      />,
    );
    const [first, second] = screen.getAllByRole("group");
    fireEvent.click(within(first).getByRole("button", { name: "All 9" }));
    expect(more).toHaveBeenCalled();
    expect(first).toHaveTextContent("SectionneursAll 99");
    expect(second).toHaveAttribute("aria-label", "Claude");
    expect(second.textContent).toBe("Signalisation");
  });

  it("leaves the focus in the field that drives it: the active row is named by its id, the pointer makes a row active", () => {
    const onActive = vi.fn();
    const onSelect = vi.fn();
    const { rerender } = render(
      <>
        <input aria-label="Search" />
        <Tests selected="b" onSelect={onSelect} activeDescendant={{ id: "res", onActive }} />
      </>,
    );
    const box = screen.getByRole("listbox", { name: "Tests" });
    expect(box).toHaveAttribute("id", "res");
    const [a, b] = screen.getAllByRole("option");
    expect(b).toHaveAttribute("id", optionId("res", "b"));
    expect(b).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option").every((o) => !o.hasAttribute("tabindex"))).toBe(true);
    screen.getByRole("textbox", { name: "Search" }).focus();
    fireEvent.mouseEnter(a);
    expect(onActive).toHaveBeenCalledWith("a");
    fireEvent.click(a);
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus();
    const seen: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      seen.push(this.id);
    };
    try {
      rerender(
        <>
          <input aria-label="Search" />
          <Tests selected="d" onSelect={onSelect} activeDescendant={{ id: "res", onActive }} />
        </>,
      );
      expect(seen).toEqual([optionId("res", "d")]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("while loading shows skeleton rows and never the old rows; with nothing, the empty state in its frame", () => {
    const { rerender } = render(<Tests loading />);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("listbox").querySelectorAll("li")).toHaveLength(3);
    rerender(<Tests loading={5} />);
    expect(screen.getByRole("listbox").querySelectorAll("li")).toHaveLength(5);
    rerender(<Tests items={[]} empty={<EmptyState icon="tests" title="No test yet" />} />);
    expect(screen.getByRole("region", { name: "Tests" })).toHaveTextContent("No test yet");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("paged: « x of y » until all are loaded, and asks for more when the focus reaches the end", () => {
    const onEndReached = vi.fn();
    const { rerender } = render(<Tests total={9} onEndReached={onEndReached} />);
    expect(screen.getByRole("listbox")).toHaveTextContent("4 of 9");
    const [, , , d] = screen.getAllByRole("option");
    const b = screen.getAllByRole("option")[1];
    fireEvent.keyDown(b, { key: "ArrowDown" });
    expect(d).toHaveFocus();
    expect(onEndReached).toHaveBeenCalledTimes(1);
    rerender(<Tests total={4} onEndReached={onEndReached} />);
    expect(screen.getByRole("listbox")).toHaveTextContent("All 4 loaded");
  });

  it("asks for more when its end scrolls into view", () => {
    const seen: Array<(e: { isIntersecting: boolean }[]) => void> = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
          seen.push(cb);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const onEndReached = vi.fn();
    const { unmount } = render(<Tests onEndReached={onEndReached} />);
    seen[0]([{ isIntersecting: false }]);
    expect(onEndReached).not.toHaveBeenCalled();
    seen[0]([{ isIntersecting: true }]);
    expect(onEndReached).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("without selection is a plain list of rows", () => {
    render(<Tests selection="none" />);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("list", { name: "Tests" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getAllByRole("listitem")[0]).not.toHaveAttribute("tabindex");
  });

  it("draws one-line, two-line, divided, danger, lead, badges, tooltip and the catalogue states differently", () => {
    render(
      <ul>
        <ListItem title="plain" role="option" />
        <ListItem title="two" role="option" twoLine />
        <ListItem title="divided" role="option" divided />
        <ListItem title="danger" role="option" danger lead={<span>!</span>} />
        <ListItem title="hover" role="option" debugState="hover" />
        <ListItem title="focus" role="option" debugState="focus" />
        <ListItem title="selected" role="option" selected />
        <ListItem title="badged" role="option" badges={<span>Draft</span>} tooltip="badged in full" />
      </ul>,
    );
    const looks = new Set(
      ["plain", "two", "divided", "danger", "hover", "focus", "selected"].map((n) =>
        cls(screen.getByRole("option", { name: new RegExp(n) })),
      ),
    );
    expect(looks.size).toBe(7);
    const badged = screen.getByRole("option", { name: /badged/ });
    expect(badged).toHaveTextContent("Draft");
    expect(within(badged).getByRole("tooltip", { hidden: true })).toHaveTextContent("badged in full");
  });

  it("rings a row the keyboard reached, not one focused after a click (design-gaps point 83)", () => {
    render(<Tests />);
    const [a, b] = screen.getAllByRole("option");
    fireEvent.pointerDown(document.body);
    act(() => b.focus());
    const quiet = b.className;
    act(() => b.blur());
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    act(() => b.focus());
    expect(b.className).not.toBe(quiet);
    expect(a).toBeInTheDocument();
  });

  it("indents a tree row by its depth", () => {
    render(
      <ul>
        <ListItem title="deep" role="treeitem" depth={2} expanded={false} />
      </ul>,
    );
    const row = screen.getByRole("treeitem");
    const indent = row.firstElementChild as HTMLElement;
    expect(indent.style.width).toContain("* 2");
  });
});
