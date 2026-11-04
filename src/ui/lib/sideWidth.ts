import { useState } from "react";
import { type PrefName, usePref } from "./prefs.ts";

type WidthPref = Extract<
  PrefName,
  | "dockWidth"
  | "sidebarWidth"
  | "editorWidth"
  | "docsListWidth"
  | "docsTocWidth"
  | "docsSideWidth"
  | "genFormWidth"
  | "jobsSideWidth"
  | "queueWidth"
  | "sourceWidth"
  | "settingsNavWidth"
>;

// ponytail: one side bar's chosen width for the screens still on the old drag edge — null until the user drags (the
// default applies), kept in lib/prefs; `side` says where the bar sits from its edge: "before" (left) or "after"
export function useSideWidth(key: string, min: number, max: number, side: "before" | "after") {
  const [width, setWidth] = usePref(key.replace(/^testimus\./, "") as WidthPref);
  const [dragW, setDragW] = useState<number | null>(null);
  const edge = {
    target: (el: HTMLElement) => (side === "before" ? el.previousElementSibling : el.nextElementSibling) as HTMLElement,
    width: (dx: number, w: number) => Math.min(Math.max(side === "before" ? w + dx : w - dx, min), max),
    onWidth: setDragW,
    onCommit: () => {
      if (dragW === null) return;
      setWidth(dragW);
      setDragW(null);
    },
    onReset: () => {
      setDragW(null);
      setWidth(null);
    },
  };
  return [dragW ?? width, edge] as const;
}

export type SideEdge = ReturnType<typeof useSideWidth>[1];
