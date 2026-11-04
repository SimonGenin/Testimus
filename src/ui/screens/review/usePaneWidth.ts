import { useState } from "react";
import type { ResizeHandleProps } from "../../components/ui/ResizeHandle.tsx";
import { usePref } from "../../lib/prefs.ts";

type Limits = { min: number; max: number; initial: number };

// ponytail: a pane the reviewer can widen — the width follows the drag, is kept in the prefs once the gesture ends, and
// goes back to the design's width (no inline width) when reset
export function usePaneWidth(name: "queueWidth" | "sourceWidth", limits: Limits, label: string) {
  const [kept, keep] = usePref(name);
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? kept ?? limits.initial;
  const handle: ResizeHandleProps = {
    label,
    value,
    min: limits.min,
    max: limits.max,
    defaultValue: limits.initial,
    onChange: setDrag,
    onCommit: (px) => {
      keep(px === limits.initial ? null : px);
      setDrag(null);
    },
  };
  return { width: drag === null && kept === null ? undefined : value, handle };
}
