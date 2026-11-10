import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import { clock } from "../../../lib/media.ts";
import { border, color, radius, size, space } from "../../../styles/tokens.stylex.ts";
import { halo } from "../halo.ts";
import type { VideoMark, VideoRange } from "../Video.tsx";
import { RangeHandle } from "./RangeHandle.tsx";
import { tones } from "./tones.ts";
import type { VideoSpan } from "./useVideoLoop.ts";

const styles = stylex.create({
  timeline: { position: "relative", height: size.controlSm, userSelect: "none" },
  track: {
    position: "absolute",
    inset: 0,
    borderRadius: radius.r1,
    cursor: "pointer",
    touchAction: "none",
    outline: "none",
  },
  zone: { position: "absolute", insetBlock: 0, marginBlock: "auto", height: space.snug, pointerEvents: "none" },
  rail: { insetInline: 0, borderRadius: radius.full, backgroundColor: color.border },
  played: { left: 0, borderRadius: radius.full },
  cited: { height: space.pill, borderRadius: radius.mark },
  chapter: {
    position: "absolute",
    insetBlock: space.s2,
    display: "flex",
    justifyContent: "center",
    width: space.s3,
    transform: "translateX(-50%)",
  },
  tick: { width: border.widthStrong, borderRadius: radius.full, backgroundColor: color.borderControl },
  mark: {
    position: "absolute",
    insetBlock: 0,
    marginBlock: "auto",
    width: space.snug,
    height: space.snug,
    borderRadius: radius.full,
    backgroundColor: color.textMuted,
    boxShadow: `0 0 0 ${border.width} ${color.surface}`,
    transform: "translateX(-50%)",
  },
  playhead: {
    position: "absolute",
    insetBlock: 0,
    width: border.widthStrong,
    borderRadius: radius.full,
    backgroundColor: color.text,
    transform: "translateX(-50%)",
    pointerEvents: "none",
  },
});

export type VideoTimelineProps = {
  /** where the playhead is, seconds */
  time: number;
  /** the video's length, seconds (0 while it is not known: the bare track) */
  duration: number;
  /** the cited range, in the accent */
  cited?: VideoRange;
  /** what the loop plays (the range and its margins), in the paler accent */
  span?: VideoSpan;
  chapters: { at: number; title: string }[];
  marks: VideoMark[];
  /** a click or a drag on the track, Home, End */
  onSeek: (seconds: number) => void;
  /** given: the cited range's bounds are handles; told while one moves, and once more (done) when it is let go */
  onBounds?: (range: VideoRange, done: boolean) => void;
};

// ponytail: the video as a line — the whole of it in grey, what the loop plays in a pale accent, the cited range in the
// accent, chapters as ticks, key frames as dots, the playhead. The track is one slider (click, drag, Home, End; its
// ← → are the player's own ±5 s, which reach it from here); the cited range's two bounds are sliders of their own
// beside it, never inside (a slider has no children to reach)
export function VideoTimeline({ time, duration, cited, span, chapters, marks, onSeek, onBounds }: VideoTimelineProps) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moved = useRef<VideoRange | null>(null);
  const known = duration > 0;
  const pct = (seconds: number) => `${known ? (Math.min(Math.max(0, seconds), duration) * 100) / duration : 0}%`;
  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    return r?.width && known ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration : null;
  };
  const seek = (clientX: number) => {
    const seconds = at(clientX);
    if (seconds !== null) onSeek(seconds);
  };
  const last = Math.floor(duration);
  const move = (bound: "from" | "to", seconds: number) => {
    const now = moved.current ?? cited;
    if (!now || !onBounds) return;
    const whole = Math.round(seconds);
    const next =
      bound === "from"
        ? { from: Math.min(Math.max(0, whole), Math.round(now.to) - 1), to: Math.round(now.to) }
        : { from: Math.round(now.from), to: Math.max(Math.min(last, whole), Math.round(now.from) + 1) };
    if (next.from === now.from && next.to === now.to) return;
    moved.current = next;
    onBounds(next, false);
  };
  const done = () => {
    if (moved.current) onBounds?.(moved.current, true);
    moved.current = null;
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the timeline's sliders side by side, not a form's fieldset
    <div ref={box} role="group" aria-label="Timeline" {...stylex.props(styles.timeline)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={Math.floor(time)}
        aria-valuetext={`${clock(time)} of ${clock(duration)}`}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seek(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onLostPointerCapture={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          onSeek(e.key === "Home" ? 0 : duration);
        }}
        {...stylex.props(halo.visible, styles.track)}
      >
        <span {...stylex.props(styles.zone, styles.rail)} />
        {known && span && (
          <span
            data-part="margins"
            style={{ left: pct(span.from), width: pct(span.to - span.from) }}
            {...stylex.props(styles.zone, tones.margin)}
          />
        )}
        {known && !cited && (
          <span
            data-part="played"
            style={{ width: pct(time) }}
            {...stylex.props(styles.zone, styles.played, tones.cited)}
          />
        )}
        {known && cited && (
          <span
            data-part="cited"
            style={{ left: pct(cited.from), width: pct(cited.to - cited.from) }}
            {...stylex.props(styles.zone, styles.cited, tones.cited)}
          />
        )}
        {known &&
          chapters.map((c) => (
            <span key={c.at} title={c.title} style={{ left: pct(c.at) }} {...stylex.props(styles.chapter)}>
              <i {...stylex.props(styles.tick)} />
            </span>
          ))}
        {known &&
          marks.map((m) => (
            <span key={m.at} title={m.label} style={{ left: pct(m.at) }} {...stylex.props(styles.mark)} />
          ))}
        <span data-part="playhead" style={{ left: pct(time) }} {...stylex.props(styles.playhead)} />
      </div>
      {known && cited && onBounds && (
        <>
          <RangeHandle
            label="Start of the cited range"
            value={Math.round(cited.from)}
            min={0}
            max={Math.round(cited.to) - 1}
            left={pct(cited.from)}
            at={at}
            onMove={(s) => move("from", s)}
            onDone={done}
          />
          <RangeHandle
            label="End of the cited range"
            value={Math.round(cited.to)}
            min={Math.round(cited.from) + 1}
            max={last}
            left={pct(cited.to)}
            at={at}
            onMove={(s) => move("to", s)}
            onDone={done}
          />
        </>
      )}
    </div>
  );
}
