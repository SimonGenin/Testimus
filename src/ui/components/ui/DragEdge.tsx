import { useRef, useState } from "react";
import { cx } from "../../lib/format.ts";

export function DragEdge({
  className,
  label,
  target,
  width,
  onWidth,
  onCommit,
  onReset,
}: {
  className?: string;
  label: string;
  target: (edge: HTMLElement) => HTMLElement;
  width: (dx: number, startWidth: number, el: HTMLElement) => number;
  onWidth: (w: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ x: number; w: number; el: HTMLElement } | null>(null);
  // ponytail: pointerup, pointercancel and the implicit capture release all end the same gesture —
  // the ref makes the first one that arrives the only one that counts
  const end = () => {
    if (!from.current) return;
    from.current = null;
    setDragging(false);
    onCommit();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a resize handle takes pointer drags, an <hr> cannot
    <div
      className={cx("drag-edge", className, dragging && "is-dragging")}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} — double-click to reset`}
      onPointerDown={(e) => {
        const el = target(e.currentTarget);
        from.current = { x: e.clientX, w: el.getBoundingClientRect().width, el };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const f = from.current;
        if (f) onWidth(Math.round(width(e.clientX - f.x, f.w, f.el)));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
    />
  );
}
