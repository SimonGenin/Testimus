export type AnchorKind = "§" | "fig" | "page" | "img" | "t" | "frame";
export type Anchor = { kind: AnchorKind; id: string };

export const MEDIA_KINDS: readonly AnchorKind[] = ["img", "t", "frame"];
const KINDED = /^(fig|page|img|frame|t)(?:\s*:\s*|\s+)(\S.*)$/i;
const PART = /~\d+$/;
const REF = /^([^#]+)#(.+)$/;

// ponytail: the one reading of an anchor as people and Claude write it — « 5.6.6 », « § 5.6.6 », « fig 40 »,
// « FIG: 40 », « page 3 », « img:3 », « t:04:30 », « frame 04:30 », with or without its docId# in front and with a
// chunk part (~2) dropped
export function parseAnchor(raw: string): Anchor {
  const a = raw
    .trim()
    .replace(/^[^#\s]*#/, "")
    .replace(PART, "")
    .trim();
  const m = KINDED.exec(a);
  if (m) return { kind: m[1].toLowerCase() as AnchorKind, id: m[2].trim() };
  return { kind: "§", id: a.replace(/^§\s*/, "") };
}

export function anchorText(a: Anchor): string {
  return a.kind === "§" ? `§${a.id}` : `${a.kind}:${a.id}`;
}

export function normalizeAnchor(raw: string): string {
  return anchorText(parseAnchor(raw));
}

// ponytail: an anchor of an images or video document — a picture (img:3), a transcript line (t:04:30), a key frame
// (frame:04:30)
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
// document's file 1 prefixes its number (3/04:30), so adding a video never moves another's anchors
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function momentId(n: number, seconds: number): string {
  return n === 1 ? clock(seconds) : `${n}/${clock(seconds)}`;
}

// ponytail: the video and the second a t: or frame: anchor names (a suffix -2 told two lines of one second apart)
export function momentOf(id: string): { n: number; at: number } | null {
  const m = /^(?:(\d+)\/)?(?:(\d+):)?(\d{1,2}):(\d{2})(?:-\d+)?$/.exec(id.trim());
  if (!m) return null;
  return { n: m[1] ? Number(m[1]) : 1, at: Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) };
}
