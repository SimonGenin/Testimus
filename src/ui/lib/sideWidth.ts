import { useState } from "react";

const read = (key: string, min: number, max: number): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= min && v <= max ? v : null;
  } catch {
    return null;
  }
};

const write = (key: string, w: number | null) => {
  try {
    if (w === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(w));
  } catch {}
};

// ponytail: one side bar's chosen width — null until the user drags (the CSS default applies), kept in
// localStorage; `side` says where the bar sits from its DragEdge: "before" (left bar) or "after" (right bar)
export function useSideWidth(key: string, min: number, max: number, side: "before" | "after") {
  const [width, setWidth] = useState(() => read(key, min, max));
  const [dragW, setDragW] = useState<number | null>(null);
  const edge = {
    target: (el: HTMLElement) => (side === "before" ? el.previousElementSibling : el.nextElementSibling) as HTMLElement,
    width: (dx: number, w: number) => Math.min(Math.max(side === "before" ? w + dx : w - dx, min), max),
    onWidth: setDragW,
    onCommit: () => {
      if (dragW === null) return;
      setWidth(dragW);
      write(key, dragW);
      setDragW(null);
    },
    onReset: () => {
      setDragW(null);
      setWidth(null);
      write(key, null);
    },
  };
  return [dragW ?? width, edge] as const;
}
