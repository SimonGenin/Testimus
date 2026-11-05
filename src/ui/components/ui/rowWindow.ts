import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

// ponytail: a list this long draws only the rows near what is seen — hundreds of tests, a long review queue, a document
// with a thousand sections; a shorter one draws every row, as before
export const WINDOW_FROM = 150;
// ponytail: rows drawn above and below what is seen, so a scroll shows rows already there
const OVERSCAN = 1500;
// ponytail: the part seen is taken again once it moved this far, not at every pixel of a scroll
const STEP = 400;
const FIRST = 60;
const GUESS = 40;

type View = { top: number; bottom: number };

const scrolls = (el: Element) => /^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY);

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (scrolls(p)) return p;
  return null;
}

export type RowWindow = {
  /** every row is drawn (a short list, or a page without layout) */
  all: boolean;
  /** the row is drawn; the others are room of the height they last had */
  shown: (index: number) => boolean;
  /** the room a row not drawn takes */
  room: (key: string) => number;
};

// ponytail: which rows of a long list are drawn — those whose place is within OVERSCAN of the part of its scrolling
// frame that is seen, and the pinned ones (the picked row, the focused one); each drawn row's height is kept, so the
// room left for a row not drawn is the height it had (or the rows' average), and the scroll bar stays where it was
export function useRowWindow(
  list: RefObject<HTMLElement | null>,
  rows: RefObject<Map<string, HTMLElement>>,
  keys: string[],
  pinned: (string | null)[],
): RowWindow {
  const long = keys.length >= WINDOW_FROM;
  const heights = useRef(new Map<string, number>());
  const avg = useRef(GUESS);
  const [view, setView] = useState<View | null>(null);
  // ponytail: a page with no layout at all (jsdom: no box has a height, no ResizeObserver) draws every row
  const flat = typeof ResizeObserver === "undefined";
  const [, redraw] = useState(0);
  const all = !long || flat;

  // ponytail: each drawn row's height, after every draw; a guess far from the rows' average draws once more
  useLayoutEffect(() => {
    if (all) return;
    let sum = 0;
    let n = 0;
    for (const [k, li] of rows.current) {
      const h = li.offsetHeight;
      if (!h) continue;
      heights.current.set(k, h);
      sum += h;
      n++;
    }
    if (!n) return;
    const next = sum / n;
    if (Math.abs(next - avg.current) > 2) {
      avg.current = next;
      redraw((x) => x + 1);
    }
  });

  useEffect(() => {
    const el = list.current;
    if (!long || flat || !el) return;
    const frame = scrollerOf(el);
    let shown: View | null = null;
    let raf = 0;
    const look = () => {
      raf = 0;
      const box = el.getBoundingClientRect();
      const seen = frame ? frame.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const top = seen.top - box.top;
      const next = { top, bottom: top + (frame ? frame.clientHeight : seen.height) };
      if (shown && Math.abs(next.top - shown.top) < STEP && Math.abs(next.bottom - shown.bottom) < STEP) return;
      shown = next;
      setView(next);
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(look);
    };
    look();
    const target: HTMLElement | Window = frame ?? window;
    target.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    sized?.observe(frame ?? el);
    return () => {
      cancelAnimationFrame(raf);
      target.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
      sized?.disconnect();
    };
  }, [list, long, flat]);

  const room = (key: string) => heights.current.get(key) ?? avg.current;
  if (all) return { all: true, shown: () => true, room };
  const pins = new Set(pinned.filter((k): k is string => !!k));
  const on = new Uint8Array(keys.length);
  if (!view) for (let i = 0; i < Math.min(FIRST, keys.length); i++) on[i] = 1;
  else {
    let y = 0;
    const from = view.top - OVERSCAN;
    const to = view.bottom + OVERSCAN;
    for (let i = 0; i < keys.length; i++) {
      const h = room(keys[i]);
      if (y + h >= from && y <= to) on[i] = 1;
      y += h;
      if (y > to) break;
    }
  }
  keys.forEach((k, i) => {
    if (pins.has(k)) on[i] = 1;
  });
  return { all: false, shown: (i) => on[i] === 1, room };
}
