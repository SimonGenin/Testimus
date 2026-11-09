import { useSyncExternalStore } from "react";
import type { TabId } from "./layout.ts";
import type { WorkspaceController } from "./useWorkspace.ts";

// ponytail: two small shared stores — what the shell asks of the screen's sections (show Claude, toggle it), and the
// sections of the screen shown now, which the top bar's controls act on. Outside React state so the shell does not
// redraw the screen to pass them

export type RevealAsk = { tab: TabId; toggle: boolean; nonce: number };

let ask: RevealAsk | null = null;
const askListeners = new Set<() => void>();

/** the screen's sections show that tab (toggle: hide it if it is the one shown) */
export function askReveal(tab: TabId, toggle = false): void {
  ask = { tab, toggle, nonce: (ask?.nonce ?? 0) + 1 };
  for (const fn of askListeners) fn();
}

export function useRevealAsk(): RevealAsk | null {
  return useSyncExternalStore(
    (fn) => {
      askListeners.add(fn);
      return () => askListeners.delete(fn);
    },
    () => ask,
  );
}

let bar: WorkspaceController | null = null;
const barListeners = new Set<() => void>();

/** the sections the top bar acts on: the screen shown sets them, and clears them when it goes */
export function setBar(next: WorkspaceController | null): void {
  if (bar === next) return;
  bar = next;
  for (const fn of barListeners) fn();
}

export const currentBar = (): WorkspaceController | null => bar;

export function useBar(): WorkspaceController | null {
  return useSyncExternalStore(
    (fn) => {
      barListeners.add(fn);
      return () => barListeners.delete(fn);
    },
    () => bar,
  );
}
