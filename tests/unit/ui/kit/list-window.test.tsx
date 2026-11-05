// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { List } from "../../../../src/ui/components/ui/List.tsx";
import { WINDOW_FROM } from "../../../../src/ui/components/ui/rowWindow.ts";
import { scrolling } from "../../helpers/scrolling.ts";

const ROW = 40;
const FRAME = 400;
const items = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

// ponytail: jsdom has no layout — here every row is 40 px high and the frame shows 400 px of a list that scrolls in it;
// the list's top moves up as the frame scrolls
let scrolled = 0;
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
    return this.getAttribute("role") === "option" ? ROW : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-frame") ? FRAME : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = this.hasAttribute("data-frame") ? 0 : this.getAttribute("role") === "listbox" ? -scrolled : 0;
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

const Long = ({ n, selected }: { n: number; selected?: string }) => (
  <div data-frame="">
    <List label="Tests" items={items(n)} getKey={String} renderItem={(t) => ({ title: t })} selected={selected} />
  </div>
);

const drawn = () => screen.getAllByRole("option").map((o) => o.textContent);
const rooms = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>("li[aria-hidden=true]")].map((li) => li.style.height);

it("a short list draws every row", () => {
  render(<Long n={WINDOW_FROM - 1} />);
  expect(drawn()).toHaveLength(WINDOW_FROM - 1);
});

it("a long list draws the rows near what is seen, the others are room as high as they are", () => {
  render(<Long n={600} />);
  const box = screen.getByRole("listbox", { name: "Tests" });
  const shown = drawn();
  expect(shown.length).toBeGreaterThan(FRAME / ROW);
  expect(shown.length).toBeLessThan(100);
  expect(shown[0]).toBe("t0");
  expect(rooms(box)).toEqual([`${(600 - shown.length) * ROW}px`]);
});

it("scrolling down draws the rows there, and keeps the room above", () => {
  render(<Long n={600} />);
  const frame = document.querySelector("[data-frame]") as HTMLElement;
  scrolled = 300 * ROW;
  act(() => {
    fireEvent.scroll(frame);
  });
  const shown = drawn();
  expect(shown).toContain("t300");
  expect(shown).not.toContain("t100");
  // ponytail: the first row stays, as the list's tab stop; the room after it is the rows up to those drawn
  expect(shown[0]).toBe("t0");
  const box = screen.getByRole("listbox", { name: "Tests" });
  const [above] = rooms(box);
  expect(Number.parseInt(above, 10)).toBe((Number(shown[1]?.slice(1)) - 1) * ROW);
});

it("the picked row is drawn wherever it is, and End takes the focus to the last row", () => {
  render(<Long n={600} selected="t450" />);
  expect(drawn()).toContain("t450");
  const first = screen.getByRole("option", { name: "t0" });
  first.focus();
  act(() => {
    fireEvent.keyDown(first, { key: "End" });
  });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "t599" }));
});
