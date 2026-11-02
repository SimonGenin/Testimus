import { useSyncExternalStore } from "react";
import { ApiError } from "../api.ts";
import { message } from "./format.ts";

export type Toast = {
  id: number;
  kind: "error" | "info" | "ok";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  onExpire?: () => void;
  left: number;
};

const MAX = 3;

let items: Toast[] = [];
let seq = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const tick = () => {
  const next = items.map((t) => (Number.isFinite(t.left) ? { ...t, left: t.left - 1 } : t));
  for (const t of next) if (t.left <= 0) t.onExpire?.();
  items = next.filter((t) => t.left > 0);
  if (!items.some((t) => Number.isFinite(t.left)) && timer) {
    clearInterval(timer);
    timer = undefined;
  }
  emit();
};

export function toast(t: Omit<Toast, "id" | "left"> & { left?: number }): number {
  const id = ++seq;
  // ponytail: an error the user never saw is worse than a stale one — errors wait for a dismissal
  const all = [...items, { left: t.kind === "error" ? Number.POSITIVE_INFINITY : 6, ...t, id }];
  for (const dropped of all.slice(0, -MAX)) dropped.onExpire?.();
  items = all.slice(-MAX);
  if (!timer && items.some((x) => Number.isFinite(x.left))) timer = setInterval(tick, 1000);
  emit();
  return id;
}

export const errorToast = (e: unknown, title = "Something went wrong") =>
  toast({
    kind: "error",
    title,
    detail: e instanceof ApiError && e.fix ? `${e.message} — ${e.fix}` : message(e),
  });

export function closeToast(id: number, undone = false): void {
  if (!undone) items.find((t) => t.id === id)?.onExpire?.();
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => items,
    () => items,
  );
}
