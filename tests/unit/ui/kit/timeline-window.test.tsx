// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActList } from "../../../../src/ui/components/claude/ActList.tsx";
import { WINDOW_FROM } from "../../../../src/ui/components/ui/rowWindow.ts";
import { Timeline, type TimelineItem } from "../../../../src/ui/components/ui/Timeline.tsx";
import { scrolling } from "../../helpers/scrolling.ts";

const ROW = 40;
const FRAME = 400;
let scrolled = 0;

// ponytail: jsdom has no layout — every drawn item is 40 px high, the frame shows 400 px of a list that scrolls in it
beforeEach(() => {
  scrolled = 0;
  scrolling("[data-frame]");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "LI" && !this.hasAttribute("aria-hidden") ? ROW : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-frame") ? FRAME : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this.tagName === "OL" ? -scrolled : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    fn(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const items = (n: number, running = -1): TimelineItem[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `s${i}`,
    state: i === running ? "running" : "done",
    title: `Step ${i}`,
  }));

const drawn = (list: HTMLElement) =>
  [...list.querySelectorAll(":scope > li:not([aria-hidden])")].map((li) =>
    li.textContent?.replace(/^\D*?(Step)/, "$1"),
  );

it("a short timeline draws every item", () => {
  render(
    <div data-frame="">
      <Timeline label="Steps" items={items(WINDOW_FROM - 1)} />
    </div>,
  );
  expect(drawn(screen.getByRole("list", { name: "Steps" }))).toHaveLength(WINDOW_FROM - 1);
});

it("a long timeline draws the items near what is seen, and the running one; the others are room", () => {
  render(
    <div data-frame="">
      <Timeline label="Steps" items={items(500, 450)} />
    </div>,
  );
  const list = screen.getByRole("list", { name: "Steps" });
  const shown = drawn(list);
  expect(shown.length).toBeLessThan(120);
  expect(shown[0]).toContain("Step 0");
  expect(within(list).getByText("Step 450")).toBeInTheDocument();
  expect(list.querySelectorAll(":scope > li[aria-hidden]").length).toBeGreaterThan(0);
  scrolled = 300 * ROW;
  act(() => {
    fireEvent.scroll(document.querySelector("[data-frame]") as HTMLElement);
  });
  expect(within(list).getByText("Step 300")).toBeInTheDocument();
  expect(within(list).queryByText("Step 0")).toBeNull();
});

it("a Claude run's thousands of actions are drawn through the same window", () => {
  const acts = Array.from({ length: 1000 }, (_, i) => ({
    at: "2026-11-02T10:00:00.000Z",
    text: `Read passage ${i}`,
    level: "info" as const,
  }));
  const { container } = render(
    <div data-frame="">
      <ActList acts={acts} />
    </div>,
  );
  const list = container.querySelector("ol") as HTMLElement;
  expect(drawn(list).length).toBeLessThan(120);
  expect(within(list).getByText("Read passage 0")).toBeInTheDocument();
  expect(within(list).queryByText("Read passage 999")).toBeNull();
});
