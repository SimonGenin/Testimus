import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/legacy/index.ts";

type View = { z: number; x: number; y: number };
const FIT: View = { z: 1, x: 0, y: 0 };

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndex((index - 1 + n) % n);
      else if (e.key === "ArrowRight") onIndex((index + 1) % n);
      else if (e.key === "+" || e.key === "=") zoom.current(1.25);
      else if (e.key === "-") zoom.current(1 / 1.25);
      else if (e.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onIndex, onClose]);

  return (
    <div
      className="overlay overlay-lightbox"
      onMouseDown={(e) => !(e.target as HTMLElement).closest(".lb-pic, .lb-bar, .lb-nav") && onClose()}
    >
      <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Screenshot ${names[index]}`}>
        <div className="lb-bar">
          <span className="mono">{names[index]}</span>
          <span className="muted">step {step}</span>
          <div className="spacer" />
          <span className="muted">{Math.round(view.z * 100)}%</span>
          <button
            type="button"
            className="btn btn-quiet btn-sm iconbtn"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.25)}
          >
            <Icon name="zoomOut" />
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm iconbtn"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.25)}
          >
            <Icon name="zoomIn" />
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm iconbtn"
            aria-label="Reset zoom"
            onClick={() => setView(FIT)}
          >
            <Icon name="fit" />
          </button>
          <button type="button" className="btn btn-quiet btn-sm iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="lb-stage">
          {n > 1 && (
            <button
              type="button"
              className="btn btn-quiet iconbtn lb-nav"
              aria-label="Previous image"
              onClick={() => onIndex((index - 1 + n) % n)}
            >
              <Icon name="left" />
            </button>
          )}
          <div className="lb-img" ref={stage}>
            <img
              className="lb-pic"
              src={urls[index]}
              alt={names[index]}
              draggable={false}
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
          {n > 1 && (
            <button
              type="button"
              className="btn btn-quiet iconbtn lb-nav"
              aria-label="Next image"
              onClick={() => onIndex((index + 1) % n)}
            >
              <Icon name="right" />
            </button>
          )}
        </div>
        <div className="lb-foot muted">
          <span className="mono">
            {index + 1} of {n}
          </span>
          <span>← → to move · scroll to zoom · drag to pan · 0 to fit · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
