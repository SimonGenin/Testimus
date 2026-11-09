import { useSyncExternalStore } from "react";

/** what Claude's tab says of the one dock even while its section is folded: a run under way, the last one failed, no
 * Claude to talk to */
export type DockState = { running: boolean; failed: boolean; offline: boolean };

const IDLE: DockState = { running: false, failed: false, offline: false };

let state = IDLE;
const listeners = new Set<() => void>();

export function setDockState(next: DockState): void {
  if (next.running === state.running && next.failed === state.failed && next.offline === state.offline) return;
  state = next;
  for (const fn of listeners) fn();
}

export const dockState = (): DockState => state;

export function useDockState(): DockState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
