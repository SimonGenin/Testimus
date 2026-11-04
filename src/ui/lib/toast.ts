import { useMemo } from "react";
import { dismissToast, toast as show, type ToastTone, useToasts as useLive } from "../components/ui/Toast.tsx";
import type { Screen } from "./app.ts";
import { ApiError } from "./data/client.ts";
import { message } from "./format.ts";

export type Toast = {
  id: number;
  /** the kit's tone, as Toast.tsx says it: neutral · success · warning · danger · claude */
  tone: ToastTone;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  onExpire?: () => void;
  left: number;
};

export type ToastInput = Omit<Toast, "id" | "left" | "tone"> & { tone?: ToastTone; left?: number };

// ponytail: the kit's one toast store (Toast.tsx), with the screens' detail and run; a toast closed with its action
// taken (undone) does not run its onExpire
const undone = new Set<number>();

export function toast(t: ToastInput): number {
  let id = 0;
  const expire = t.onExpire;
  id = show({
    tone: t.tone ?? "neutral",
    title: t.title,
    text: t.detail,
    action: t.action && { label: t.action.label, onAction: t.action.run },
    seconds: t.left,
    onExpire: () => {
      if (undone.delete(id)) return;
      expire?.();
    },
  });
  return id;
}

export const errorToast = (e: unknown, title = "Something went wrong") =>
  toast({
    tone: "danger",
    title,
    detail: e instanceof ApiError && e.fix ? `${e.message} — ${e.fix}` : message(e),
  });

// ponytail: a job started from anywhere says so the same way — what started, and « Open in Jobs » to that very job
export const jobToast = (
  title: string,
  jobId: string | null | undefined,
  navigate: (screen: Screen, arg?: string) => void,
  detail = "It runs in Jobs; you can keep working.",
) =>
  toast({
    tone: "neutral",
    title,
    detail,
    action: jobId ? { label: "Open in Jobs", run: () => navigate("jobs", jobId) } : undefined,
  });

export function closeToast(id: number, taken = false): void {
  if (taken) undone.add(id);
  dismissToast(id);
  undone.delete(id);
}

export function useToasts(): Toast[] {
  const live = useLive();
  return useMemo(
    () =>
      live.map((t) => ({
        id: t.id,
        tone: t.tone ?? "neutral",
        title: t.title,
        detail: t.text,
        action: t.action && { label: t.action.label, run: t.action.onAction },
        onExpire: t.onExpire,
        left: t.left,
      })),
    [live],
  );
}
