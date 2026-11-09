// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterBar } from "../../../../src/ui/components/filters/FilterBar.tsx";
import { CheckTree } from "../../../../src/ui/components/pick/CheckTree.tsx";

afterEach(cleanup);

const bar = (o: Partial<Parameters<typeof FilterBar>[0]> = {}) => ({
  label: "Filter the things",
  placeholder: "Filter — name",
  words: "",
  onWords: vi.fn(),
  shown: 3,
  total: 3,
  onClear: vi.fn(),
  menus: [
    {
      key: "color",
      label: "Colour",
      options: [
        { value: "red", label: "Red", count: 2 },
        { value: "blue", label: "Blue", count: 1 },
      ],
      selected: [] as string[],
      onChange: vi.fn(),
      note: "Ticks add up.",
    },
    { key: "size", label: "Size", options: [{ value: "s", label: "Small" }], selected: [], onChange: vi.fn() },
  ],
  ...o,
});

describe("FilterBar", () => {
  it("words, a menu of ticks with their counts and its note; a dimension with one value is left out", () => {
    const p = bar();
    render(<FilterBar {...p} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter the things" }), { target: { value: "x" } });
    expect(p.onWords).toHaveBeenCalledWith("x");
    expect(screen.queryByRole("button", { name: "Size" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Colour" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Red/ })).toHaveTextContent("2");
    expect(screen.getByText("Ticks add up.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Blue/ }));
    expect(p.menus[0].onChange).toHaveBeenCalledWith(["blue"]);
  });

  it("a menu on is pressed and says what it keeps; untick takes it off; « n of m shown » and Clear", () => {
    const p = bar({ shown: 1 });
    p.menus[0].selected = ["red", "blue"];
    render(<FilterBar {...p} />);
    const on = screen.getByRole("button", { name: "Colour: red, blue" });
    expect(on).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(on);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Red/ }));
    expect(p.menus[0].onChange).toHaveBeenCalledWith(["blue"]);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("1 of 3 shown");
    fireEvent.click(within(status).getByRole("button", { name: "Clear the filters" }));
    expect(p.onClear).toHaveBeenCalled();
  });

  it("long lists get a search field in the menu", () => {
    const p = bar();
    p.menus[0].options = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `Value ${i}` }));
    render(<FilterBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Colour" }));
    expect(screen.getByPlaceholderText("Find a colour")).toBeInTheDocument();
  });
});

describe("CheckTree", () => {
  const nodes = [
    {
      key: "/A",
      label: "A",
      children: [
        { key: "a1", label: "First", meta: "K-1" },
        { key: "a2", label: "Second" },
      ],
    },
    { key: "b", label: "Alone" },
  ];

  it("a branch ticks all its leaves, shows mixed and how many, and folds", () => {
    const onPick = vi.fn();
    const { rerender } = render(<CheckTree label="Things" nodes={nodes} picked={new Set()} onPick={onPick} />);
    const tree = screen.getByRole("list", { name: "Things" });
    fireEvent.click(within(tree).getByRole("checkbox", { name: "A" }));
    expect(onPick).toHaveBeenLastCalledWith(["a1", "a2"], true);
    expect(tree).toHaveTextContent("0 of 2");
    expect(tree).toHaveTextContent("K-1");
    rerender(<CheckTree label="Things" nodes={nodes} picked={new Set(["a1"])} onPick={onPick} />);
    expect(within(tree).getByRole("checkbox", { name: "A" })).toBePartiallyChecked();
    fireEvent.click(within(tree).getByRole("checkbox", { name: "A" }));
    expect(onPick).toHaveBeenLastCalledWith(["a1", "a2"], true);
    rerender(<CheckTree label="Things" nodes={nodes} picked={new Set(["a1", "a2"])} onPick={onPick} />);
    fireEvent.click(within(tree).getByRole("checkbox", { name: "A" }));
    expect(onPick).toHaveBeenLastCalledWith(["a1", "a2"], false);
    fireEvent.click(within(tree).getByRole("checkbox", { name: "Alone" }));
    expect(onPick).toHaveBeenLastCalledWith(["b"], true);
    fireEvent.click(within(tree).getByRole("button", { name: "Fold A" }));
    expect(within(tree).queryByRole("checkbox", { name: "First" })).toBeNull();
    fireEvent.click(within(tree).getByRole("button", { name: "Unfold A" }));
    expect(within(tree).getByRole("checkbox", { name: "First" })).toBeInTheDocument();
  });
});
