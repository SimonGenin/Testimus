import type { SpokenLine, VideoDensity } from "../../types.ts";
import { SCAN_FPS } from "./io.ts";

const STILL_S = 0.5;
const LONG_STILL_S = 10;
const HOLD_S = 1;
const SHAKY = 0.6;
export const MAX_CANDIDATES = 600;

export type Candidate = { at: number; why: "screen" | "before" | "said" | "regular" };

const rank = (at: number) => Math.round(at * SCAN_FPS);
export const rankOf = rank;

// ponytail: a video nobody holds still (a cabin, a desk filmed by hand) never settles — most of its frames differ
// from the one before
export function isShaky(changes: number[], duration: number): boolean {
  return duration > 0 && changes.length / (duration * SCAN_FPS) > SHAKY;
}

// ponytail: words that say a thing is about to be done or seen, in the languages the team films in
const CUES =
  /\b(on clique|je clique|cliquez|vous voyez|on voit|regardez|alarme|valid(?:e|er|ez)|on appuie|appuyez|s[ée]lectionne[zr]?|on ouvre|click|you (?:can )?see|look at|alarm|confirm|press|select|open|klick(?:en|t)?|sehen sie|schauen|alarm|best[äa]tig(?:en|t)|dr[üu]ck(?:en|t)|w[äa]hl(?:en|t))\b/i;

// ponytail: the floor of regular frames — every 5 s for a short video, further apart for a long one
const stepOf = (duration: number) => (duration <= 600 ? 5 : Math.min(30, Math.round(duration / 120)));

// ponytail: the moments worth a frame, from cheap signals over the whole video. A screen recording is a run of
// settled screens between changes: a frame is taken once a change is over (nothing moved for half a second — a menu
// is caught open, not opening; a cursor on its way is skipped without being recognised), and again just before the
// next change when the screen stayed long (the form as it was when « Validate » was clicked). To these are added the
// moments the speech points at and a regular floor. Past 600 the weakest go first — the floor, then the speech's,
// never an even thinning that would lose a short event.
// A video filmed by hand changes at every frame, so when its picture changes says nothing: there the changes of scene
// are taken instead (`cuts`: the moments the picture changed much more than the shake did — the camera cut, or swung
// from the desk to a screen), each a second later, once the new scene holds: on a real cabin video the swing lasts
// three frames of the pass, and the sharpest of the frames around half a second after it was still the blur of the
// move. They cannot be told from `changes`, a list of moments with no size; the same light pass measures them (io.ts),
// so there is no second reading
export function candidatesOf(o: {
  changes: number[];
  cuts?: number[];
  duration: number;
  said: Pick<SpokenLine, "at" | "text">[];
  cap?: number;
}): Candidate[] {
  const shaky = isShaky(o.changes, o.duration);
  const byRank = new Map<number, Candidate>();
  const strength = { screen: 4, before: 3, said: 2, regular: 1 };
  const add = (at: number, why: Candidate["why"]) => {
    if (at < 0 || (o.duration && at > o.duration)) return;
    const r = rank(at);
    const had = byRank.get(r);
    if (!had || strength[why] > strength[had.why]) byRank.set(r, { at: r / SCAN_FPS, why });
  };
  if (!shaky)
    o.changes.forEach((t, i) => {
      const next = o.changes[i + 1] ?? o.duration;
      if (next - t < STILL_S) return;
      add(t, "screen");
      if (next - t >= LONG_STILL_S && i + 1 < o.changes.length) add(next - 1 / SCAN_FPS, "before");
    });
  else for (const t of o.cuts ?? []) add(t + HOLD_S, "screen");
  for (const l of o.said) {
    add(l.at, "said");
    if (CUES.test(l.text)) add(l.at + 2, "said");
  }
  const step = stepOf(o.duration);
  for (let t = 0; t < o.duration; t += step) add(t, "regular");
  let out = [...byRank.values()].sort((a, b) => a.at - b.at);
  const cap = o.cap ?? MAX_CANDIDATES;
  for (const weakest of ["regular", "said", "before"] as const) {
    if (out.length <= cap) break;
    const over = out.length - cap;
    const weak = out.filter((c) => c.why === weakest);
    const drop = new Set(weak.filter((_, i) => i % Math.max(1, Math.floor(weak.length / over)) === 0).slice(0, over));
    out = out.filter((c) => !drop.has(c));
  }
  if (out.length > cap) {
    const slice = o.duration / cap;
    const seen = new Set<number>();
    out = out.filter((c) => {
      const k = Math.floor(c.at / slice);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}

const DENSITY: Record<VideoDensity, number> = { sober: 0.5, normal: 1, detailed: 1.6 };
export const MAX_KEY_FRAMES = 150;

// ponytail: how many key frames a video is worth — about 40 a half-hour (twenty before, whatever the length, lost most
// of a long video), fewer or more with the project's density, never more than 150 nor than there are candidates
export function keyFrameBudget(
  duration: number,
  density: VideoDensity = "normal",
  candidates = MAX_KEY_FRAMES,
): number {
  const wanted = Math.round((40 * duration * DENSITY[density]) / 1800);
  return Math.max(1, Math.min(MAX_KEY_FRAMES, candidates, Math.max(Math.round(8 * DENSITY[density]), wanted)));
}
