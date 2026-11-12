import { useSyncExternalStore } from "react";

/** the generation whose plan Generate shows while it waits for the user's go: the dock's questions go with it, so
 * Claude has the plan and may propose a new one */
let plan: string | null = null;
const listeners = new Set<() => void>();

export function setDockPlan(next: string | null): void {
  if (next === plan) return;
  plan = next;
  for (const fn of listeners) fn();
}

export function useDockPlan(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => plan,
  );
}
