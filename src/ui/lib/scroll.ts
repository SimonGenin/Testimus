import { type RefObject, useLayoutEffect } from "react";

// ponytail: how far `box` must scroll to show `el` — into view, or centred for the line a link points at
export function into(box: HTMLElement, el: HTMLElement, center = false): number {
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (center) return r.top - b.top - Math.max(0, (b.height - r.height) / 2);
  if (r.top < b.top) return r.top - b.top;
  return r.bottom > b.bottom ? r.bottom - b.bottom : 0;
}

// ponytail: the frame that scrolls `el` up and down — the nearest box that scrolls and is taller inside than out (a
// table's frame scrolls sideways only; a box that only clips is never scrolled)
export function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (scrolls(p) && p.scrollHeight > p.clientHeight) return p;
  return null;
}

const scrolls = (el: HTMLElement) => ["auto", "scroll"].includes(getComputedStyle(el).overflowY);

const ACTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
const MARK = "[data-focus], [data-target]";

// ponytail: what a link points at inside `root` (the quote, the figure, the heading, the table row: `mark`) is centred in
// the frame that scrolls it — whatever reader holds it, a page, a dialog or a pane — and kept there while pictures and
// fonts arrive above it or a banner over the text comes or goes, until the reader acts; `at` says what moves the mark (the text, the quote, the anchor), so a
// render that keeps it leaves the reader where they scrolled
export function useShowMark(root: RefObject<HTMLElement | null>, at: string, mark = MARK) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `at` is what moves the mark in the DOM
  useLayoutEffect(() => {
    const r = root.current;
    const hot = r?.querySelector<HTMLElement>(mark);
    if (!r || !hot) return;
    const go = () => {
      const box = scroller(hot);
      if (box) box.scrollTop += into(box, hot, true);
    };
    go();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(go);
    for (let p: HTMLElement | null = r; p && !scrolls(p); p = p.parentElement) watch.observe(p);
    const stop = () => {
      watch.disconnect();
      for (const k of ACTS) window.removeEventListener(k, stop, true);
    };
    for (const k of ACTS) window.addEventListener(k, stop, true);
    return stop;
  }, [at, mark, root]);
}
