import { clock, momentId, momentOf, parseAnchor } from "../../rag/anchors.ts";
import { spoken } from "./lines.ts";

export type SaidLine = { n: number; at: number; text: string; unsure: boolean };
export type SeenFrame = { n: number; at: number; text: string };
export type VideoText = { lines: SaidLine[]; frames: SeenFrame[]; durations: Map<number, number> };

const BEFORE_S = 5;
const AFTER_S = 30;
const RANGE_SLACK_S = 2;
export const REPORT_WINDOW_S = 15;

const HEAD = /^##\s.*?(?:·\s*((?:\d+:)?\d{1,2}:\d{2}))?\s*<!--\s*§\s*video-(\d+)\s*-->/;
const LINE = /^\[[^\]]*\]\s*(.*?)\s*<!--\s*t\s+(\S+?)\s*-->(.*)$/;
const FRAME = /<!--\s*frame\s+(\S+?)\s*-->/;
const plain = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ponytail: what a video of a document says and shows, read from doc.md alone (the one text a quote is held
// against): each line with its second, each key frame with the description written under it, each video's length
export function videoText(md: string): VideoText {
  const out: VideoText = { lines: [], frames: [], durations: new Map() };
  const ls = md.split(/\r?\n/);
  ls.forEach((l, i) => {
    const h = HEAD.exec(l);
    if (h) {
      const length = h[1] ? momentOf(h[1])?.at : undefined;
      if (length !== undefined) out.durations.set(Number(h[2]), length);
      return;
    }
    const said = LINE.exec(l);
    if (said) {
      const m = momentOf(said[2]);
      if (m) out.lines.push({ n: m.n, at: m.at, text: plain(said[1]), unsure: /<!--\s*unsure\s*-->/.test(said[3]) });
      return;
    }
    const f = FRAME.exec(l);
    const m = f ? momentOf(f[1]) : null;
    if (!m) return;
    const para: string[] = [];
    for (let k = i + 1; k < ls.length && ls[k].trim() !== ""; k++) para.push(ls[k]);
    out.frames.push({ n: m.n, at: m.at, text: plain(para.join(" ")) });
  });
  return out;
}

export type Timed =
  | { ok: true; canonical: string; unsure: boolean }
  | {
      ok: false;
      why: "no-video" | "no-moment" | "not-said" | "no-frame" | "not-seen";
      length?: number;
      nearest?: { anchor: string; text: string };
      elsewhere?: string;
    };

const words = (s: string) => spoken(s).split(" ").filter(Boolean);

function closest(lines: SaidLine[], quote: string): SaidLine | undefined {
  const q = new Set(words(quote));
  let best: SaidLine | undefined;
  let score = 0;
  for (const l of lines) {
    const s = words(l.text).filter((w) => q.has(w)).length;
    if (s > score) {
      score = s;
      best = l;
    }
  }
  return best;
}

// ponytail: where a quote of speech starts and ends among lines — compared on the words alone (lines.ts spoken), over
// the lines joined, so a quote may run across two or three of them
function located(lines: SaidLine[], quote: string): { first: number; last: number } | null {
  const q = spoken(quote);
  if (!q) return null;
  const parts = lines.map((l) => spoken(l.text));
  const joined = parts.join(" ");
  let from = 0;
  for (;;) {
    const at = joined.indexOf(q, from);
    if (at < 0) return null;
    const starts = at === 0 || joined[at - 1] === " ";
    const ends = at + q.length === joined.length || joined[at + q.length] === " ";
    if (starts && ends) {
      let pos = 0;
      let first = -1;
      let last = -1;
      parts.forEach((p, i) => {
        if (p.length && pos <= at) first = i;
        if (p.length && pos < at + q.length) last = i;
        pos += p.length + 1;
      });
      if (first >= 0 && last >= first) return { first, last };
    }
    from = at + 1;
  }
}

// ponytail: a source in a video is held against time. t:04:30 is second 270 of the video, which exists for good; the
// quote is looked for in what is being said then — from a few seconds before to the end of the passage — and over the
// range for t:02:36..02:52; the source is canonical when it starts at the second of the line its quote starts in. A
// line cut otherwise by another model no longer kills a source: same moment, same words, it holds; only a source whose
// words changed breaks, the very one a person must hear again. v:02:36..02:52 quotes what is seen: the description of
// a key frame whose moment falls in the range
export function resolveTimed(vt: VideoText, anchor: string, quote: string): Timed {
  const a = parseAnchor(anchor);
  const m = momentOf(a.id);
  if (!m || (a.kind !== "t" && a.kind !== "v")) return { ok: false, why: "no-moment" };
  const length = vt.durations.get(m.n);
  const mine = vt.lines.filter((l) => l.n === m.n).sort((x, y) => x.at - y.at);
  const frames = vt.frames.filter((f) => f.n === m.n);
  if (length === undefined && !mine.length && !frames.length) return { ok: false, why: "no-video" };
  const end = m.to ?? m.at;
  if (length !== undefined && (m.at > length + 1 || end > length + 1)) return { ok: false, why: "no-moment", length };
  if (a.kind === "v") {
    const seen = frames.filter((f) => f.at >= m.at - 0.5 && f.at <= end + 0.5);
    if (!seen.length) return { ok: false, why: "no-frame" };
    const q = plain(quote);
    if (!q || seen.some((f) => f.text.includes(q))) return { ok: true, canonical: `v:${a.id}`, unsure: false };
    const other = frames.find((f) => f.text.includes(q));
    return {
      ok: false,
      why: "not-seen",
      ...(other ? { elsewhere: `frame:${momentId(m.n, other.at)}` } : {}),
    };
  }
  const being = mine.findLast((l) => l.at <= m.at + 0.999)?.at ?? m.at;
  const from = Math.min(being, m.at) - BEFORE_S;
  const to = end + (m.to === undefined ? AFTER_S : RANGE_SLACK_S);
  const near = mine.filter((l) => l.at >= from && l.at <= to);
  if (!quote.trim()) return { ok: true, canonical: `t:${a.id}`, unsure: false };
  // ponytail: a range that starts right and stops before its quote ends is opened to hold it, never refused
  const wide = m.to === undefined ? near : mine.filter((l) => l.at >= from && l.at <= end + AFTER_S);
  const inRange = located(near, quote);
  const hit = inRange ?? located(wide, quote);
  if (hit) {
    const among = inRange ? near : wide;
    const first = among[hit.first];
    const last = among[hit.last];
    const next = mine.find((l) => l.at > last.at)?.at;
    const until =
      m.to === undefined ? undefined : m.to > last.at ? m.to : (next ?? Math.max(last.at + 1, length ?? last.at + 1));
    return {
      ok: true,
      canonical: `t:${momentId(m.n, first.at, until)}`,
      unsure: among.slice(hit.first, hit.last + 1).some((l) => l.unsure),
    };
  }
  const all = located(mine, quote);
  if (all) return { ok: false, why: "not-said", elsewhere: `t:${momentId(m.n, mine[all.first].at)}` };
  const best = closest(near.length ? near : mine, quote);
  return {
    ok: false,
    why: "not-said",
    ...(best ? { nearest: { anchor: `t:${momentId(m.n, best.at)}`, text: best.text } } : {}),
  };
}

export const isTimed = (anchor: string): boolean => /^(t|v):/.test(anchor);

// ponytail: where a quote of speech is in a video, looked for around a moment it was once at (± 15 s) — what the
// report of a new transcription does for each source: found there, the source follows it; not found, the nearest
// words and their moment are given to be heard again
export function relocate(
  vt: VideoText,
  anchor: string,
  quote: string,
): { anchor: string } | { nearest?: { anchor: string; text: string } } {
  const a = parseAnchor(anchor);
  const m = momentOf(a.id);
  if (!m || a.kind !== "t") return {};
  const mine = vt.lines.filter((l) => l.n === m.n).sort((x, y) => x.at - y.at);
  const near = mine.filter((l) => l.at >= m.at - REPORT_WINDOW_S && l.at <= (m.to ?? m.at) + REPORT_WINDOW_S);
  const hit = located(near, quote);
  if (hit) {
    const first = near[hit.first];
    const last = near[hit.last];
    const span = m.to === undefined ? undefined : (mine.find((l) => l.at > last.at)?.at ?? last.at + (m.to - m.at));
    return { anchor: `t:${momentId(m.n, first.at, span)}` };
  }
  const best = closest(near, quote);
  return best ? { nearest: { anchor: `t:${momentId(m.n, best.at)}`, text: best.text } } : {};
}

export const momentText = (anchor: string): string => {
  const m = momentOf(parseAnchor(anchor).id);
  return m ? (m.to === undefined ? clock(m.at) : `${clock(m.at)} to ${clock(m.to)}`) : anchor;
};
