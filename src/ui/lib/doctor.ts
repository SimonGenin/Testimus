import { useSyncExternalStore } from "react";
import type { CheckState, DoctorCheck } from "../../core/types.ts";
import { call } from "../api.ts";

export type DoctorState = { checks: DoctorCheck[]; at: number; running: boolean; error?: string };

let state: DoctorState = { checks: [], at: 0, running: false };
const listeners = new Set<() => void>();

const set = (next: DoctorState) => {
  state = next;
  for (const l of listeners) l();
};

export const worst = (checks: DoctorCheck[]): CheckState =>
  checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : checks.length && checks.every((c) => c.state === "skip")
        ? "skip"
        : "ok";

export async function runDoctor(claude = false): Promise<DoctorCheck[]> {
  set({ ...state, running: true, error: undefined });
  try {
    const r = await call<{ checks: DoctorCheck[] } | DoctorCheck[]>("system.doctor", claude ? { claude: true } : {});
    const checks = Array.isArray(r) ? r : (r?.checks ?? []);
    // ponytail: a run without the sign-in probe keeps the last real sign-in answer instead of « not checked »
    const merged = claude
      ? checks
      : checks.map((c) =>
          c.state === "skip" && c.id === "claudeLogin" ? (state.checks.find((p) => p.id === c.id) ?? c) : c,
        );
    set({ checks: merged, at: Date.now(), running: false });
    return merged;
  } catch (e) {
    set({ ...state, running: false, error: e instanceof Error ? e.message : String(e) });
    return state.checks;
  }
}

export function useDoctor(): DoctorState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

export function resetDoctor(): void {
  set({ checks: [], at: 0, running: false });
}
