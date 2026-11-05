import { vi } from "vitest";

// ponytail: jsdom has no CSS and no layout — the boxes matching `selectors` scroll up and down (overflow auto, taller
// inside than out), the way the readers' frames do in a page; spied, so vi.restoreAllMocks undoes it
export function scrolling(...selectors: string[]) {
  const scrolls = (el: Element) => selectors.some((s) => el.matches(s));
  const style = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    const s = style(el, pseudo);
    if (!scrolls(el)) return s;
    return new Proxy(s, {
      get: (t, k) => {
        if (k === "overflowY") return "auto";
        const v = t[k as keyof CSSStyleDeclaration];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return scrolls(this) ? 10_000 : 0;
  });
}
