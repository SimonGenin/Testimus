export type AnchorKind = "§" | "fig" | "page" | "img" | "t" | "v" | "frame";
export type Anchor = { kind: AnchorKind; id: string };

export const MEDIA_KINDS: readonly AnchorKind[] = ["img", "t", "v", "frame"];
const KINDED = /^(fig|page|img|frame|t|v)(?:\s*:\s*|\s+)(\S.*)$/i;
const TIMED: readonly string[] = ["t", "v", "frame"];
const PART = /~\d+$/;
const REF = /^([^#]+)#(.+)$/;

// ponytail: the one reading of an anchor as people and Claude write it — « 5.6.6 », « § 5.6.6 », « fig 40 »,
// « FIG: 40 », « page 3 », « img:3 », « t:04:30 », « t:02:36..02:52 », « v:02:36..02:52 », « frame 04:30 », with or
// without its docId# in front and with a chunk part (~2) dropped. A t:, v: or frame: anchor is a moment of a video,
// written again in its one form (t:4:30 → t:04:30; the -2 a line of the same second once carried is dropped); what
// follows t or v and is no moment is a section's title
export function parseAnchor(raw: string): Anchor {
  const a = raw
    .trim()
    .replace(/^[^#\s]*#/, "")
    .replace(PART, "")
    .trim();
  const m = KINDED.exec(a);
  if (m) {
    const kind = m[1].toLowerCase() as AnchorKind;
    if (!TIMED.includes(kind)) return { kind, id: m[2].trim() };
    const at = momentOf(m[2]);
    if (at) return { kind, id: momentId(at.n, at.at, kind === "frame" ? undefined : at.to) };
    if (kind === "frame") return { kind, id: m[2].trim() };
  }
  return { kind: "§", id: a.replace(/^§\s*/, "") };
}

export function anchorText(a: Anchor): string {
  return a.kind === "§" ? `§${a.id}` : `${a.kind}:${a.id}`;
}

export function normalizeAnchor(raw: string): string {
  return anchorText(parseAnchor(raw));
}

// ponytail: an anchor of an images or video document — a picture (img:3), what is said at a moment or over a range
// (t:04:30, t:02:36..02:52), what is seen over a range (v:02:36..02:52), a key frame (frame:04:30)
export const isMediaAnchor = (raw: string) => MEDIA_KINDS.includes(parseAnchor(raw).kind);

export function splitRef(ref: string): { docId: string; anchor: string | null } {
  const m = REF.exec(ref.trim());
  return m ? { docId: m[1].trim(), anchor: m[2] } : { docId: ref.trim(), anchor: null };
}

export function normalizeRef(ref: string): string {
  const { docId, anchor } = splitRef(ref);
  return anchor === null ? docId : `${docId}#${normalizeAnchor(anchor)}`;
}

// ponytail: a moment of a video as its anchors write it — mm:ss, h:mm:ss past an hour; a video other than the
// document's file 1 prefixes its number (3/04:30), so adding a video never moves another's anchors; a range is its two
// moments (02:36..02:52)
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function momentId(n: number, seconds: number, to?: number): string {
  const end = to !== undefined && Math.floor(to) > Math.floor(seconds) ? `..${clock(to)}` : "";
  const at = `${clock(seconds)}${end}`;
  return n === 1 ? at : `${n}/${at}`;
}

export type Moment = { n: number; at: number; to?: number };

const MOMENT = /^(?:(\d+)\/)?(?:(\d+):)?(\d{1,2}):(\d{2})(?:-\d+)?(?:\s*\.\.\s*(?:(\d+):)?(\d{1,2}):(\d{2}))?$/;
const secs = (h: string | undefined, m: string, s: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);

// ponytail: the video and the second (or the range of seconds) a t:, v: or frame: anchor names. A moment is a second
// of the video, which exists for good — never a line's rank: the -2 that once told two lines of one second apart is
// read and dropped
export function momentOf(id: string): Moment | null {
  const m = MOMENT.exec(id.trim());
  if (!m) return null;
  const at = secs(m[2], m[3], m[4]);
  const to = m[6] !== undefined ? secs(m[5], m[6], m[7]) : undefined;
  return { n: m[1] ? Number(m[1]) : 1, at, ...(to !== undefined && to > at ? { to } : {}) };
}

// ponytail: a moment as a person or Claude gives it to a command — seconds (« 272.5 ») or a clock (« 04:32 »)
export function secondsOf(text: string): number | null {
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return momentOf(t)?.at ?? null;
}
