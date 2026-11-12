import type { CommandOutput } from "../../core/commands/index.ts";
import type { DocJson, SourceType } from "../../core/types.ts";
import { useRead } from "./data/query.ts";

export type MediaShown = CommandOutput<"media.show">;
export type VideoShown = MediaShown["videos"][number];

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv"];
// ponytail: a recording of sound alone is a video document without a picture — heard and cited the same way
export const SOUND_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"];
export const DOC_EXTENSIONS = ["docx", "pdf", "txt", "md"];
const ext = (list: string[]) => list.map((e) => `.${e}`).join(",");
export const MEDIA_ACCEPT = ext([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...SOUND_EXTENSIONS]);
export const DOC_ACCEPT = ext([...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...SOUND_EXTENSIONS]);
export const isImage = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);
export const isSound = (name: string) => /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(name);
export const isVideo = (name: string) => /\.(mp4|mov|m4v|mkv|webm|avi|wmv)$/i.test(name) || isSound(name);

// ponytail: a document as the core describes it — docs.list and docs.show say its type and whether it is observed
export type Described = DocJson & { type: SourceType; observed: boolean };

export const isMedia = (type: SourceType) => type === "images" || type === "video" || type === "mixed";

// ponytail: a moment of a video as its anchors write it — mm:ss, h:mm:ss past an hour
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type Moment = { n: number; at: number; to?: number; kind: "t" | "v" | "frame" };

const secs = (h: string | undefined, m: string, s: string) => Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);

// ponytail: the moment of a video an anchor names — the second of a line said (t:04:30) or of a key frame
// (frame:3/04:30), or a range of seconds, said (t:02:36..02:52) or seen (v:02:36..02:52); null for another anchor.
// A moment is a second of the video, never a line's rank: the -2 a line once carried is read and dropped
export function momentOf(anchor: string): Moment | null {
  const m = /^(t|v|frame):(?:(\d+)\/)?(?:(\d+):)?(\d{1,2}):(\d{2})(?:-\d+)?(?:\.\.(?:(\d+):)?(\d{1,2}):(\d{2}))?$/.exec(
    anchor.trim(),
  );
  if (!m) return null;
  const at = secs(m[3], m[4], m[5]);
  const to = m[7] !== undefined && m[1] !== "frame" ? secs(m[6], m[7], m[8]) : undefined;
  return {
    kind: m[1] as Moment["kind"],
    n: m[2] ? Number(m[2]) : 1,
    at,
    ...(to !== undefined && to > at ? { to } : {}),
  };
}

// ponytail: a moment or a range as its anchor writes it (the video's number in front unless it is file 1)
export function momentAnchor(kind: "t" | "v", n: number, at: number, to?: number): string {
  const range = to !== undefined && Math.floor(to) > Math.floor(at) ? `${clock(at)}..${clock(to)}` : clock(at);
  return `${kind}:${n === 1 ? range : `${n}/${range}`}`;
}

export const isPictureAnchor = (anchor: string) => /^(fig|img|frame):/.test(anchor.trim());

// ponytail: what a document is, in the words of the list — Word · PDF · Text · Images · 46 · Video · 12:40 (Sound ·
// 12:40 for a recording of sound alone); images and videos together say both
export function typeLabel(doc: Pick<Described, "source" | "type"> & { pending?: { files: unknown[] } }): string {
  const t = doc.type;
  const files = doc.source.files ?? [];
  if (doc.pending && t === "images") return `Images · ${doc.pending.files.length}`;
  const images = files.filter((f) => f.kind === "image").length;
  const videos = files.filter((f) => f.kind === "video");
  if (t === "pdf") return "PDF";
  if (t === "txt") return "Text";
  if (t === "images") return `Images · ${images}`;
  if (t === "video") {
    const word = videos.length > 0 && videos.every((v) => isSound(v.name)) ? "Sound" : "Video";
    return videos[0]?.duration ? `${word} · ${clock(videos[0].duration)}` : word;
  }
  if (t === "mixed") return `Images · ${images} · ${videos.length === 1 ? "Video" : `${videos.length} videos`}`;
  return "Word";
}

// ponytail: whether a source's document shows the real system — an images or video document the team has not marked
// as the reference; the documents are the cached docs.list, a source names its document by id or by code
export function useObserved(): (docId: string) => boolean {
  const list = useRead("docs.list", {}, { optional: true }).data;
  const docs = Array.isArray(list) ? list : [];
  return (docId) => {
    const d = docs.find((x) => x.id === docId) ?? docs.find((x) => x.code === docId);
    return !!d?.observed;
  };
}
