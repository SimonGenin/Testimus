import { useMemo } from "react";
import { dismissToast, toast as show, type ToastTone, useToasts as useLive } from "../components/ui/Toast.tsx";
import { ApiError } from "./data/client.ts";
import { message } from "./format.ts";

export type Toast = {
  id: number;
  kind: "error" | "info" | "ok" | "claude";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
  onExpire?: () => void;
  left: number;
};

const TONE: Record<Toast["kind"], ToastTone> = { error: "danger", info: "neutral", ok: "success", claude: "claude" };
const KIND: Partial<Record<ToastTone, Toast["kind"]>> = { danger: "error", success: "ok", claude: "claude" };

// ponytail: the screens' words for a toast (kind, detail, run) put on the kit's one store (Toast.tsx); a toast closed
// with its action taken (undone) does not run its onExpire
const undone = new Set<number>();

export function toast(t: Omit<Toast, "id" | "left"> & { left?: number }): number {
  let id = 0;
  const expire = t.onExpire;
  id = show({
    tone: TONE[t.kind],
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
    kind: "error",
    title,
    detail: e instanceof ApiError && e.fix ? `${e.message} — ${e.fix}` : message(e),
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
        kind: KIND[t.tone ?? "neutral"] ?? "info",
        title: t.title,
        detail: t.text,
        action: t.action && { label: t.action.label, run: t.action.onAction },
        onExpire: t.onExpire,
        left: t.left,
      })),
    [live],
  );
}
