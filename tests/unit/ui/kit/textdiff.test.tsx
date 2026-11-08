// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TextDiff } from "../../../../src/ui/components/ui/TextDiff.tsx";
import { lineDiff, withContext } from "../../../../src/ui/lib/textDiff.ts";

afterEach(cleanup);

const lines = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${i + from}`);

describe("TextDiff", () => {
  it("marks the lines added and removed with their word, and folds the unchanged ones far from a change", () => {
    const before = [...lines(10), "old"].join("\n");
    const after = [...lines(10), "new", "more"].join("\n");
    render(<TextDiff label="Changes" before={before} after={after} context={1} />);
    const list = screen.getByRole("list", { name: "Changes" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["9 unchanged lines", "line 10", "old", "new", "more"]);
    expect(within(items[2]).getByRole("img", { name: "Removed" })).toBeInTheDocument();
    expect(within(items[3]).getByRole("img", { name: "Added" })).toBeInTheDocument();
    expect(items[3]).toHaveAttribute("data-kind", "added");
  });

  it("says when there is no difference; context keeps every line close to a change", () => {
    render(<TextDiff label="Same" before={"a\nb\n"} after={"a\nb"} />);
    expect(screen.getByText("No difference.")).toBeInTheDocument();
    cleanup();
    render(<TextDiff label="All" before={lines(5).join("\n")} after={[...lines(4), "x"].join("\n")} context={20} />);
    expect(within(screen.getByRole("list", { name: "All" })).queryByText(/unchanged line/)).toBeNull();
  });

  it("lineDiff pairs the longest common lines; an empty text is no line", () => {
    expect(lineDiff("", "a\nb")).toEqual([
      { kind: "added", text: "a" },
      { kind: "added", text: "b" },
    ]);
    expect(lineDiff("a\nb\nc", "a\nc").map((l) => l.kind)).toEqual(["same", "removed", "same"]);
    expect(withContext(lineDiff("a\nb\nc\nd", "a\nb\nc\nX"), 0)).toEqual([
      { kind: "skipped", count: 3 },
      { kind: "removed", text: "d" },
      { kind: "added", text: "X" },
    ]);
  });
});
