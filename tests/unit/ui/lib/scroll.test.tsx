// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "../../../../src/core/types.ts";
import { PassageText } from "../../../../src/ui/components/sources/PassageView.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { scroller } from "../../../../src/ui/lib/scroll.ts";
import { scrolling } from "../../helpers/scrolling.ts";
import { boxes } from "../documents/helpers.tsx";

afterEach(() => {
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const passage = (text: string): Passage => ({
  docId: "D1",
  anchor: "§5.6.6",
  path: "",
  title: "5.6.6 Sectionneur",
  text,
  figures: [],
  doc: { code: "D1", title: "", version: "", status: "draft" },
});

const LONG = Array.from({ length: 30 }, (_, i) => `Ligne ${i}.`).join("\n\n");

// ponytail: a source opened in the dialog or in Review's panel is a passage in a frame that scrolls: the quote is
// centred in it, wherever the frame is
function framed(text: string, quote: string) {
  setProject("C:/p");
  return render(
    <div data-testid="frame">
      <PassageText passage={passage(text)} quote={quote} />
    </div>,
  );
}

describe("a reader scrolls to what a link points at", () => {
  it("centres the quote of a passage in the frame that holds it, and follows it while pictures arrive", () => {
    const { tops } = boxes({
      '[data-testid="frame"]': { top: 0, bottom: 400, height: 400 },
      "[data-focus]": { top: 2000, bottom: 2020, height: 20 },
    });
    scrolling('[data-testid="frame"]');
    const watch = { cb: () => {}, disconnect: vi.fn() };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          watch.cb = cb;
        }
        observe() {}
        disconnect = watch.disconnect;
      },
    );
    const { getByTestId } = framed(`${LONG}\n\nLe menu contextuel propose Ouvrir.`, "menu contextuel");
    expect(document.querySelector("[data-focus]")).toHaveTextContent("menu contextuel");
    const frame = getByTestId("frame");
    expect(tops.get(frame)).toBe(1810);
    watch.cb();
    expect(tops.get(frame)).toBe(3620);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(watch.disconnect).toHaveBeenCalled();
  });

  it("scrolls the reader, not the table's own frame, to a quote in a table row", () => {
    const { tops } = boxes({
      '[data-testid="frame"]': { top: 0, bottom: 400, height: 400 },
      "tr[data-focus]": { top: 1000, bottom: 1020, height: 20 },
    });
    scrolling('[data-testid="frame"]');
    const { getByTestId } = framed(`${LONG}\n\n| Commande | Effet |\n| --- | --- |\n| Ouvrir | ouvre |`, "ouvre");
    const row = document.querySelector("tr[data-focus]") as HTMLElement;
    expect(row).toHaveTextContent("Ouvrir");
    expect(tops.get(getByTestId("frame"))).toBe(810);
  });

  it("leaves a passage with nothing marked where it is", () => {
    const { tops } = boxes({ '[data-testid="frame"]': { top: 0, bottom: 400, height: 400 } });
    scrolling('[data-testid="frame"]');
    const { getByTestId } = framed(LONG, "");
    expect(tops.get(getByTestId("frame"))).toBeUndefined();
  });

  it("takes the nearest frame that scrolls up and down: not one that scrolls sideways only, nor one that clips", () => {
    const { container } = render(
      <div data-testid="reader">
        <div data-testid="clip">
          <div data-testid="sideways">
            <span data-testid="mark" />
          </div>
        </div>
      </div>,
    );
    const over: Record<string, string> = { reader: "auto", clip: "hidden", sideways: "auto" };
    const style = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element) =>
        ({ ...style(el), overflowY: over[el.getAttribute("data-testid") ?? ""] ?? "visible" }) as CSSStyleDeclaration,
    );
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      return this.getAttribute("data-testid") === "sideways" ? 0 : 500;
    });
    const mark = container.querySelector('[data-testid="mark"]') as HTMLElement;
    expect(scroller(mark)).toBe(container.querySelector('[data-testid="reader"]'));
    expect(scroller(container.querySelector('[data-testid="reader"]') as HTMLElement)).toBeNull();
  });
});
