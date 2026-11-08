import * as stylex from "@stylexjs/stylex";
import { type Ref, useImperativeHandle, useRef } from "react";
import { border, color, focus, radius } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  frame: {
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: radius.r3,
    overflow: "hidden",
    backgroundColor: color.surfaceInverse,
  },
  video: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    outline: { default: "none", ":focus-visible": `${border.widthStrong} solid ${color.focusRing}` },
    outlineOffset: `calc(-1 * ${focus.offset})`,
  },
});

export type VideoHandle = {
  /** go to this moment (seconds) and show it */
  seek: (seconds: number) => void;
};

export type VideoProps = {
  /** the file to play (a project file through /files: it answers byte ranges, so the player seeks) */
  src: string;
  /** what the video is, read out (« Video manoeuvre.mp4 ») */
  label: string;
  /** a picture shown before it plays */
  poster?: string;
  /** where it starts, seconds (a link to a moment: t:04:30) */
  start?: number;
  /** told as it plays, seconds — the transcript beside it marks the line being said */
  onTime?: (seconds: number) => void;
  /** seek from outside: a transcript line, a chapter, a key frame */
  ref?: Ref<VideoHandle>;
};

// ponytail: the browser's own player (controls, keyboard, full screen) in the design's frame — the one place a video is
// drawn; what plays it from outside (a transcript line, a chapter) goes through seek
export function Video({ src, label, poster, start, onTime, ref }: VideoProps) {
  const el = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => ({
    seek: (seconds) => {
      const v = el.current;
      if (!v) return;
      v.currentTime = Math.max(0, seconds);
      onTime?.(v.currentTime);
    },
  }));
  return (
    <span {...stylex.props(styles.frame)}>
      <video
        ref={el}
        src={start ? `${src}#t=${Math.floor(start)}` : src}
        poster={poster}
        aria-label={label}
        controls
        preload="metadata"
        onTimeUpdate={(e) => onTime?.(e.currentTarget.currentTime)}
        {...stylex.props(styles.video)}
      />
    </span>
  );
}
