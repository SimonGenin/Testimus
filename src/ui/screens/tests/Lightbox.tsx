import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { border, color, fontFamily, fontSize, lineHeight, size, space } from "../../styles/tokens.stylex.ts";

type View = { z: number; x: number; y: number };
const FIT: View = { z: 1, x: 0, y: 0 };

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", height: `calc(100vh - ${space.s11})` },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s4,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  name: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.text },
  muted: { color: color.textMuted },
  grow: { flex: 1 },
  stage: {
    boxSizing: "border-box",
    position: "relative",
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    paddingInline: space.s2,
    backgroundColor: color.surfaceSunken,
  },
  well: {
    flex: 1,
    height: "100%",
    minWidth: 0,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pic: { maxWidth: "100%", maxHeight: "100%", cursor: "grab", userSelect: "none", touchAction: "none" },
  foot: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    minHeight: size.controlMd,
    paddingInline: space.s4,
    fontSize: fontSize.small,
    color: color.textMuted,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
});

// ponytail: the screenshots of a step, one at a time — zoom at the cursor (wheel), + / − / 0, drag to pan, ← → to move,
// Esc (the Modal's) to close
export function Lightbox({
  names,
  urls,
  index,
  step,
  onIndex,
  onClose,
}: {
  names: string[];
  urls: string[];
  index: number;
  step: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const n = names.length;
  const [view, setView] = useState<View>(FIT);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the view resets when the picture changes
  useEffect(() => setView(FIT), [index]);

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

  return (
    <Modal title={`Screenshot ${names[index]}`} size="lg" frameless onClose={onClose}>
      <div
        {...stylex.props(styles.box)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") prev();
          else if (e.key === "ArrowRight") next();
          else if (e.key === "+" || e.key === "=") zoomBy(1.25);
          else if (e.key === "-") zoomBy(1 / 1.25);
          else if (e.key === "0") setView(FIT);
        }}
      >
        <div {...stylex.props(styles.bar)}>
          <span {...stylex.props(styles.name)}>{names[index]}</span>
          <span {...stylex.props(styles.muted)}>step {step}</span>
          <span {...stylex.props(styles.grow)} />
          <span {...stylex.props(styles.muted)}>{Math.round(view.z * 100)}%</span>
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon="zoom-out"
            label="Zoom out"
            shortcut="−"
            onClick={() => zoomBy(1 / 1.25)}
          />
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon="zoom-in"
            label="Zoom in"
            shortcut="+"
            onClick={() => zoomBy(1.25)}
          />
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon="fit"
            label="Reset zoom"
            shortcut="0"
            onClick={() => setView(FIT)}
          />
          <Button variant="quiet" size="sm" iconOnly icon="close" label="Close" shortcut="Esc" onClick={onClose} />
        </div>
        <div {...stylex.props(styles.stage)}>
          {n > 1 && <Button variant="quiet" iconOnly icon="chevron-left" label="Previous image" onClick={prev} />}
          <div ref={stage} {...stylex.props(styles.well)}>
            <img
              src={urls[index]}
              alt={names[index]}
              draggable={false}
              {...stylex.props(styles.pic)}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
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
          {n > 1 && <Button variant="quiet" iconOnly icon="chevron-right" label="Next image" onClick={next} />}
        </div>
        <div {...stylex.props(styles.foot)}>
          <span {...stylex.props(styles.name)}>
            {index + 1} of {n}
          </span>
          <span>← → to move · scroll to zoom · drag to pan · 0 to fit · Esc to close</span>
        </div>
      </div>
    </Modal>
  );
}
