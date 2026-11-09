import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { findSection, type TabId, type Target } from "../../../lib/workspace/layout.ts";
import type { WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";
import { insertIndex, targetOf, type Zone, zoneAt } from "../../../lib/workspace/zones.ts";

const THRESHOLD = 5;

export type DragOver = {
  section: string;
  zone: Zone;
  /** px from the section's left edge where the tab would go among the others (the tab bar only) */
  marker: number | null;
  target: Target | null;
  refused: string | null;
};

export type TabDrag = { tab: TabId; x: number; y: number; over: DragOver | null };

// ponytail: a tab is dragged from wherever it is pressed once the pointer has moved a few px (a click stays a click);
// what is under the pointer is read from the page — a section says data-ws-section, its tab bar data-ws-bar, its tabs
// data-ws-tab — so the sections need not report their place; Esc puts it back
export function useTabDrag(ws: WorkspaceController) {
  const [drag, setDrag] = useState<TabDrag | null>(null);
  const press = useRef<{ tab: TabId; x: number; y: number; live: boolean } | null>(null);
  const clicked = useRef(false);
  const last = useRef(ws);
  last.current = ws;
  const detach = useRef<(() => void) | null>(null);

  const hover = useCallback((tab: TabId, x: number, y: number): DragOver | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-ws-section]");
    const section = el?.dataset.wsSection;
    if (!el || !section) return null;
    const box = el.getBoundingClientRect();
    const bar = el.querySelector<HTMLElement>("[data-ws-bar]");
    const barHeight = bar?.getBoundingClientRect().height ?? 0;
    const tabs = bar
      ? Array.from(bar.querySelectorAll<HTMLElement>("[data-ws-tab]")).map((t) => t.getBoundingClientRect())
      : [];
    const zone: Zone = el.hasAttribute("data-ws-strip") ? "center" : zoneAt(box, barHeight, x, y);
    const index = insertIndex(tabs, x);
    const layout = last.current.layout;
    const target = targetOf(layout, section, zone, index, findSection(layout, section)?.tabs.length ?? 0);
    const marker =
      zone === "tabs" ? (index < tabs.length ? tabs[index].left : (tabs.at(-1)?.right ?? box.left)) - box.left : null;
    return { section, zone, marker, target, refused: target ? last.current.refusal(tab, target) : null };
  }, []);

  const stop = useCallback(() => {
    detach.current?.();
    detach.current = null;
    press.current = null;
    setDrag(null);
  }, []);

  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(
    (tab: TabId, e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      stop();
      press.current = { tab, x: e.clientX, y: e.clientY, live: false };
      const move = (ev: PointerEvent) => {
        const p = press.current;
        if (!p) return;
        if (!p.live && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < THRESHOLD) return;
        p.live = true;
        setDrag({ tab: p.tab, x: ev.clientX, y: ev.clientY, over: hover(p.tab, ev.clientX, ev.clientY) });
      };
      const up = (ev: PointerEvent) => {
        const p = press.current;
        if (p?.live) {
          clicked.current = true;
          const over = hover(p.tab, ev.clientX, ev.clientY);
          if (over?.target && !over.refused) last.current.move(p.tab, over.target);
        }
        stop();
      };
      const key = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && press.current?.live) {
          ev.preventDefault();
          clicked.current = true;
          stop();
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", stop);
      window.addEventListener("keydown", key, true);
      detach.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", stop);
        window.removeEventListener("keydown", key, true);
      };
    },
    [hover, stop],
  );

  /** true once after a drag: the click that ends it does not also select the tab */
  const swallowClick = useCallback(() => {
    const was = clicked.current;
    clicked.current = false;
    return was;
  }, []);

  return { drag, onPointerDown, swallowClick };
}

export type TabDragHandle = ReturnType<typeof useTabDrag>;
