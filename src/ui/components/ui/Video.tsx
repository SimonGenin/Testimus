import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type Ref, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { clock } from "../../lib/media.ts";
import { color, radius, space } from "../../styles/tokens.stylex.ts";
import { halo } from "./halo.ts";
import { Icon } from "./Icon.tsx";
import { type } from "./type.ts";
import { useVideoLoop } from "./video/useVideoLoop.ts";
import { VideoControls } from "./video/VideoControls.tsx";
import { VideoLegend } from "./video/VideoLegend.tsx";
import { VideoTimeline } from "./video/VideoTimeline.tsx";

const styles = stylex.create({
  player: {
    boxSizing: "border-box",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minWidth: 0,
    borderRadius: radius.r3,
    outline: "none",
  },
  tight: { gap: space.s3 },
  frame: {
    position: "relative",
    flex: "none",
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: radius.r3,
    overflow: "hidden",
    backgroundColor: color.surfaceInverse,
  },
  video: { display: "block", width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" },
  looping: {
    position: "absolute",
    top: space.s4,
    left: space.s4,
    display: "inline-flex",
    alignItems: "center",
    gap: space.snug,
    paddingBlock: space.s1,
    paddingInline: space.s3,
    borderRadius: radius.full,
    backgroundColor: color.surfaceInverse,
    color: color.textInverse,
    opacity: 0.85,
    pointerEvents: "none",
  },
  line: { display: "flex", flexDirection: "column", gap: space.snug },
  band: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.s4,
    rowGap: space.s1,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  unseen: { display: "none" },
  loopingBand: { display: "inline-flex", alignItems: "center", gap: space.snug, marginInlineStart: "auto" },
});

export type VideoRange = { from: number; to: number };
export type VideoTrack = { src: string; label: string; lang: string };
export type VideoMark = { at: number; label: string };

export type VideoHandle = {
  /** go to this moment (seconds) and show it; leaves the loop when the moment is outside it */
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  /** play this range in a loop, with its margins — a source opened, a line to listen to */
  loop: (range: VideoRange) => void;
};

export type VideoProps = {
  /** the file to play (a project file through /files: it answers byte ranges, so the player seeks) */
  src: string;
  /** what the video is, read out (« Video manoeuvre.mp4 ») */
  label: string;
  /** a picture shown before it plays */
  poster?: string;
  /** where it opens, seconds (a link to a moment: t:04:30) */
  start?: number;
  /** told as it plays and when it is moved, seconds — the transcript beside it marks the line being said */
  onTime?: (seconds: number) => void;
  /** from outside: seek(seconds), play(), pause(), loop(range) — a transcript line, a chapter, a key frame */
  ref?: Ref<VideoHandle>;
  /** its length, seconds, when known before the file says it: the timeline is drawn at once */
  duration?: number;
  /** the range a source cites, seconds: drawn on the timeline and played in a loop with its margins, from its start;
   * another range restarts the loop there */
  range?: VideoRange;
  /** seconds played before and after the range (4 by default; shorter at the video's two ends) */
  margin?: number;
  /** a source just opened: its range plays in its loop at once, and so does another range cited later. A browser that
   * refuses to play before any gesture leaves it paused, without a word */
  autoPlay?: boolean;
  /** a recording of sound alone: no picture — a short band « Sound only » in its place, the same timeline, loop and
   * keys; no subtitles and no full screen, which are drawn on a picture */
  sound?: boolean;
  /** given, the range's two bounds can be dragged or moved with the arrows; told when a bound is let go, in whole
   * seconds, from < to. An owner that keeps the moved range gives it back as `range` */
  onRange?: (range: VideoRange) => void;
  /** where each chapter starts: a tick on the timeline, its title as a tooltip */
  chapters?: { at: number; title: string }[];
  /** the key frames: a dot on the timeline at each, its label as a tooltip */
  marks?: VideoMark[];
  /** WebVTT tracks of what is said; « Subtitles » shows the first, and with two (original, translated) goes off →
   * first → second */
  subtitles?: VideoTrack[];
  /** the file cannot be played here (a format the browser does not read): told once per file */
  onUnplayable?: () => void;
  /** md (default) · sm: a side tab — the same controls, Loop, Back to the excerpt and Subtitles as icons alone */
  size?: "md" | "sm";
};

const FRAME = 1 / 25;
const RATES = [1, 1.5, 0.5];
const NOT_SUPPORTED = 4;

// ponytail: the one place a video is drawn, and a player made to check a source: the range a source cites is played in
// a loop with a margin around it and drawn on the timeline, the loop is left by looking elsewhere and found again with
// « Back to the excerpt ». The browser's own controls are off: they can neither loop on a range nor show one. The keys
// (Space or K, ← →, , and . for one frame when paused, L) act while the focus is in the player, never on the page. The
// group is named by its <video> (aria-labelledby), which keeps the name: a label finds the <video> alone. A recording
// of sound alone is played by the same <video>, not drawn: a band says « Sound only » where the picture would be
export function Video({
  src,
  label,
  poster,
  start,
  onTime,
  ref,
  duration,
  range,
  margin = 4,
  autoPlay = false,
  sound = false,
  onRange,
  chapters = [],
  marks = [],
  subtitles = [],
  onUnplayable,
  size = "md",
}: VideoProps) {
  const el = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLSpanElement>(null);
  const id = useId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: where the file opens; a range cited later moves the playhead and never loads the file again
  const opens = useMemo(
    () => (start !== undefined ? Math.floor(start) : range ? Math.max(0, range.from - margin) : 0),
    [src, start],
  );
  const p = useVideoLoop(el, { opens, range, margin, duration, onTime, onRange, autoPlay });
  const [rate, setRate] = useState(1);
  const [shown, setShown] = useState(-1);
  const told = useRef<string | null>(null);
  const tracks = sound ? 0 : subtitles.length;

  useImperativeHandle(ref, () => ({ seek: p.go, play: p.play, pause: p.pause, loop: p.loop }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: a source opened plays once per file; a range cited later is the loop's own to start
  useEffect(() => {
    if (autoPlay && range) p.play();
  }, [src]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: another file or other tracks are new text tracks to set
  useEffect(() => {
    const list = el.current?.textTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].mode = i === shown ? "showing" : "disabled";
  }, [shown, tracks, src]);

  const speed = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    if (el.current) el.current.playbackRate = next;
    setRate(next);
  };
  const fullScreen = () => {
    const f = frame.current;
    if (!f) return;
    if (document.fullscreenElement === f) void document.exitFullscreen?.()?.catch(() => {});
    else void f.requestFullscreen?.()?.catch(() => {});
  };
  const step = (frames: number) => {
    if (el.current?.paused) p.skip(frames * FRAME);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = !!(e.target as HTMLElement).closest("button");
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const act =
      key === "k" || (key === " " && !onButton)
        ? p.toggle
        : key === "ArrowLeft"
          ? () => p.skip(-5)
          : key === "ArrowRight"
            ? () => p.skip(5)
            : key === ","
              ? () => step(-1)
              : key === "."
                ? () => step(1)
                : key === "l"
                  ? () => p.setLoop(!p.looping)
                  : undefined;
    if (!act) return;
    e.preventDefault();
    act();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a player's controls around its video, not a form's fieldset
    <div
      role="group"
      aria-labelledby={id}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the player takes the focus so its keys work before any control is reached
      tabIndex={0}
      onKeyDown={keys}
      {...stylex.props(halo.visible, styles.player, size === "sm" && styles.tight)}
    >
      <span ref={frame} {...stylex.props(sound ? styles.band : styles.frame)}>
        <video
          ref={el}
          id={id}
          src={opens ? `${src}#t=${opens}` : src}
          poster={sound ? undefined : poster}
          aria-label={label}
          preload="metadata"
          playsInline
          onClick={p.toggle}
          onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
          onError={(e) => {
            if (e.currentTarget.error?.code !== NOT_SUPPORTED || told.current === src) return;
            told.current = src;
            onUnplayable?.();
          }}
          {...p.media}
          {...stylex.props(sound ? styles.unseen : styles.video)}
        >
          {!sound &&
            subtitles.map((t) => <track key={t.src} kind="subtitles" src={t.src} label={t.label} srcLang={t.lang} />)}
        </video>
        {sound && <span {...stylex.props(type.small)}>Sound only</span>}
        {p.looping && p.span && (
          <span {...stylex.props(type.small, sound ? styles.loopingBand : styles.looping)}>
            <Icon name="repeat" size="sm" />
            Loop · {clock(p.span.from)} – {clock(p.span.to)}
          </span>
        )}
      </span>
      <div {...stylex.props(styles.line)}>
        <VideoTimeline
          time={p.time}
          duration={p.duration}
          cited={p.cited}
          span={p.span}
          chapters={chapters}
          marks={marks}
          onSeek={p.go}
          onBounds={onRange ? p.bounds : undefined}
        />
        <VideoLegend time={p.time} duration={p.duration} cited={p.cited} margin={margin} />
      </div>
      <VideoControls
        size={size}
        playing={p.playing}
        onToggle={p.toggle}
        onSkip={p.skip}
        rate={rate}
        onRate={speed}
        loop={p.looping}
        onLoop={() => p.setLoop(!p.looping)}
        onBack={p.away ? p.back : undefined}
        subtitles={
          tracks ? { on: shown >= 0, track: tracks > 1 && shown >= 0 ? subtitles[shown]?.label : undefined } : undefined
        }
        onSubtitles={() => setShown((s) => (s + 1 >= tracks ? -1 : s + 1))}
        onFullScreen={sound ? undefined : fullScreen}
      />
    </div>
  );
}
