import { type RefObject, type SyntheticEvent, useEffect, useRef, useState } from "react";
import type { VideoRange } from "../Video.tsx";

export type VideoSpan = { from: number; to: number };

// ponytail: what is played around a range — the range and its margin on each side, shorter at the video's two ends
export const spanOf = (range: VideoRange, margin: number, duration: number): VideoSpan => ({
  from: Math.max(0, range.from - margin),
  to: duration > 0 ? Math.min(duration, range.to + margin) : range.to + margin,
});

const same = (a: VideoRange | undefined, b: VideoRange | undefined) => a?.from === b?.from && a?.to === b?.to;

type Options = {
  opens: number;
  range: VideoRange | undefined;
  margin: number;
  duration: number | undefined;
  onTime: ((seconds: number) => void) | undefined;
  onRange: ((range: VideoRange) => void) | undefined;
  autoPlay: boolean;
};

// ponytail: the player's state, read from the <video> element's own events — where it is, how long it is, whether it
// plays — and the loop: the cited range (the prop, until a bound is dragged), another range asked from outside (a
// transcript line to listen to), on or off. The loop is checked on every frame shown (requestVideoFrameCallback), since
// timeupdate comes four times a second and would overrun the end by a quarter of a second; timeupdate checks it where
// the browser has no frame callback (and for a recording of sound alone, which shows no frame). With autoPlay another
// range cited plays at once; a play the browser refuses (no gesture yet) is left paused, without a word
export function useVideoLoop(
  el: RefObject<HTMLVideoElement | null>,
  { opens, range, margin, duration, onTime, onRange, autoPlay }: Options,
) {
  const [time, setTime] = useState(opens);
  const [own, setOwn] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cited, setCited] = useState(range);
  const [other, setOther] = useState<VideoRange>();
  const length = own || duration || 0;
  const looped = other ?? cited;
  const span = looped ? spanOf(looped, margin, length) : { from: 0, to: length || Number.POSITIVE_INFINITY };
  const [on, setOn] = useState(() => !!range && opens >= Math.floor(span.from) && opens <= span.to);
  const live = useRef({ on, span, ranged: !!looped, length, onTime });
  live.current = { on, span, ranged: !!looped, length, onTime };

  const show = (seconds: number) => {
    setTime(seconds);
    live.current.onTime?.(seconds);
  };
  const play = () => {
    void el.current?.play()?.catch(() => {});
  };
  const pause = () => el.current?.pause();
  const put = (seconds: number) => {
    const v = el.current;
    if (!v) return;
    v.currentTime = seconds;
    show(v.currentTime);
  };
  const turn = (next: boolean) => {
    live.current.on = next;
    setOn(next);
  };
  // ponytail: a moment asked outside the looped span is the user looking elsewhere: the loop stops at once (before the
  // next frame would send the playhead back), the cited range stays drawn
  const go = (seconds: number) => {
    const now = live.current;
    const to = Math.min(Math.max(0, seconds), now.length || Number.POSITIVE_INFINITY);
    if (now.on && now.ranged && (to < now.span.from || to > now.span.to)) turn(false);
    put(to);
  };
  const check = () => {
    const v = el.current;
    const now = live.current;
    if (!v || !now.on || (v.currentTime < now.span.to && !v.ended)) return;
    const ended = v.ended;
    put(now.span.from);
    if (ended) play();
  };
  const measure = (e: SyntheticEvent<HTMLVideoElement>) =>
    setOwn(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
  const start = (r: VideoRange | undefined, next: VideoRange | undefined) => {
    setOther(next);
    const to = next ?? r;
    const s = to ? spanOf(to, margin, live.current.length) : { from: 0, to: live.current.span.to };
    live.current = { ...live.current, span: s, ranged: !!to };
    turn(true);
    put(s.from);
  };

  const key = range ? `${range.from}:${range.to}` : "";
  const seen = useRef(key);
  // biome-ignore lint/correctness/useExhaustiveDependencies: another range cited (by value) restarts the loop; the range a dragged bound gave coming back is not another one
  useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    if (same(range, cited)) return;
    setCited(range);
    if (range) {
      start(range, undefined);
      if (autoPlay) play();
    } else {
      setOther(undefined);
      turn(false);
    }
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: check reads the loop as it is now through a ref
  useEffect(() => {
    const v = el.current;
    if (!playing || !v || !("requestVideoFrameCallback" in v)) return;
    let id = v.requestVideoFrameCallback(function frame() {
      check();
      id = v.requestVideoFrameCallback(frame);
    });
    return () => v.cancelVideoFrameCallback(id);
  }, [playing]);

  return {
    time,
    duration: length,
    playing,
    cited,
    span: looped ? span : undefined,
    looping: on,
    away: !!cited && (!on || !!other || time < span.from || time > span.to),
    play,
    pause,
    go,
    skip: (seconds: number) => go((el.current?.currentTime ?? 0) + seconds),
    toggle: () => (el.current?.paused === false ? pause() : play()),
    setLoop: turn,
    loop: (r: VideoRange) => {
      start(cited, r);
      play();
    },
    back: () => {
      start(cited, undefined);
      play();
    },
    bounds: (r: VideoRange, done: boolean) => {
      setCited(r);
      if (done) onRange?.(r);
    },
    media: {
      onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => {
        show(e.currentTarget.currentTime);
        check();
      },
      onEnded: check,
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onLoadedMetadata: measure,
      onDurationChange: measure,
      onEmptied: () => {
        setOwn(0);
        setPlaying(false);
        setTime(opens);
      },
    },
  };
}
