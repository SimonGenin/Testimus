import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { border, color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";

type View = { z: number; x: number; y: number };
const FIT: View = { z: 1, x: 0, y: 0 };

const styles = stylex.create({
  stage: {
    boxSizing: "border-box",
    position: "relative",
    height: "60vh",
    display: "flex",
    padding: space.s6,
    backgroundColor: color.surfaceSunken,
  },
  well: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pic: {
    maxWidth: "100%",
    maxHeight: "100%",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
    backgroundColor: color.surface,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
  },
  group: { display: "flex", alignItems: "center", gap: space.s1 },
  sep: { alignSelf: "stretch", width: border.width, backgroundColor: color.border },
  count: {
    minWidth: space.s10,
    textAlign: "center",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
});

// ponytail: the screenshots of a step, one at a time — zoom at the cursor (wheel), + / − / 0, drag to pan, ← → to move,
// Esc (the Modal's) to close
export function Lightbox({
  names,
  urls,
  index,
  step,
  column,
  onIndex,
  onClose,
}: {
  names: string[];
  urls: string[];
  index: number;
  step: number;
  /** the column the picture sits in (« Expected Result ») */
  column?: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const n = names.length;
  const [view, setView] = useState<View>(FIT);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view resets when the picture changes
  useEffect(() => {
    setView(FIT);
    setSize(null);
  }, [index]);

  const zoomBy = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const r = stage.current?.getBoundingClientRect();
      const px = r && cx !== undefined ? cx - (r.left + r.width / 2) : 0;
      const py = r && cy !== undefined ? cy - (r.top + r.height / 2) : 0;
      return { z: v.z * factor, x: px - (px - v.x) * factor, y: py - (py - v.y) * factor };
    });
  const zoom = useRef(zoomBy);
  zoom.current = zoomBy;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // ponytail: React attaches wheel passively, so preventDefault there is a no-op — this one listener
    // is the only reason the handler is not inline
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current(Math.exp(-e.deltaY / 400), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const prev = () => onIndex((index - 1 + n) % n);
  const next = () => onIndex((index + 1) % n);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else if (e.key === "0") setView(FIT);
  };
  // ponytail: the keys work wherever the focus is in the dialog (its foot's buttons included)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const where = [`Step ${step}`, column, size && `${size.w} × ${size.h}`].filter(Boolean).join(" · ");

  return (
    <Modal
      title={`Screenshot ${names[index]}`}
      subtitle={where}
      icon="image"
      size="lg"
      flush
      onClose={onClose}
      footNote="Scroll to zoom at the cursor · drag to pan · 0 or double-click fits · Esc closes"
      actions={
        <>
          <span {...stylex.props(styles.group)}>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="chevron-left"
              label="Previous image"
              shortcut="←"
              disabled={n < 2}
              onClick={prev}
            />
            <span {...stylex.props(styles.count)}>
              {index + 1} of {n}
            </span>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="chevron-right"
              label="Next image"
              shortcut="→"
              disabled={n < 2}
              onClick={next}
            />
          </span>
          <span {...stylex.props(styles.sep)} />
          <span {...stylex.props(styles.group)}>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="zoom-out"
              label="Zoom out"
              shortcut="−"
              onClick={() => zoomBy(1 / 1.25)}
            />
            <span {...stylex.props(styles.count)}>{Math.round(view.z * 100)} %</span>
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon="zoom-in"
              label="Zoom in"
              shortcut="+"
              onClick={() => zoomBy(1.25)}
            />
          </span>
          <Button size="sm" icon="fit" label="Fit" shortcut="0" onClick={() => setView(FIT)} />
        </>
      }
    >
      <div {...stylex.props(styles.stage)}>
        <div ref={stage} {...stylex.props(styles.well)}>
          <img
            src={urls[index]}
            alt={names[index]}
            draggable={false}
            {...stylex.props(styles.pic)}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onDoubleClick={() => setView(FIT)}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const from = drag.current;
              if (!from) return;
              drag.current = { x: e.clientX, y: e.clientY };
              setView((v) => ({ ...v, x: v.x + e.clientX - from.x, y: v.y + e.clientY - from.y }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
