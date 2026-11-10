import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { sectionOf } from "../../../lib/workspace/layout.ts";
import type { SideTab, WorkspaceController } from "../../../lib/workspace/useWorkspace.ts";

/** the sections a tab's content is drawn in: what useSideTab offers its tab to */
export const WorkspaceHost = createContext<WorkspaceController | null>(null);

const styles = stylex.create({
  holder: { flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" },
});

function TabSlot({ el }: { el: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const at = slot.current;
    if (!at) return;
    at.appendChild(el);
    return () => {
      if (el.parentNode === at) at.removeChild(el);
    };
  }, [el]);
  return <div ref={slot} {...stylex.props(styles.holder)} />;
}

export type SideTabView = {
  /** what to render where the owner is: the portal into the tab (nothing while closed) */
  node: ReactNode;
  /** the tab is the one its section shows, open */
  shown: boolean;
  reveal: () => void;
};

// ponytail: a tab that a piece of a screen opens beside its work while it needs it (a test's analysis, from the editor
// in the Test tab) — offered to the screen's sections while `open`, placed right of the work and shown; its content
// stays the owner's (its state, its events) and is drawn into the tab through a portal. Outside any sections it is
// drawn in place. `host`: the sections to offer it to when the owner is not inside them (the shell's, the screen shown)
export function useSideTab(
  tab: Omit<SideTab, "content">,
  open: boolean,
  content: ReactNode,
  host?: WorkspaceController | null,
): SideTabView {
  const inside = useContext(WorkspaceHost);
  const ws = host === undefined ? inside : host;
  const [el] = useState(() => {
    const d = document.createElement("div");
    d.className = stylex.props(styles.holder).className ?? "";
    return d;
  });
  const slot = useMemo(() => <TabSlot el={el} />, [el]);
  const offer = ws?.offer;
  const withdraw = ws?.withdraw;
  const { id, label, icon, count, dot, claude } = tab;
  useEffect(() => {
    if (open) offer?.({ id, label, icon, count, dot, claude, content: slot });
  }, [offer, open, id, label, icon, count, dot, claude, slot]);
  useEffect(() => {
    if (open && withdraw) return () => withdraw(id);
  }, [withdraw, open, id]);
  const s = ws ? sectionOf(ws.layout, id) : undefined;
  return {
    node: open ? (ws ? createPortal(content, el) : content) : null,
    shown: ws ? !!s && s.active === id && !s.collapsed : open,
    reveal: () => ws?.reveal(id),
  };
}
