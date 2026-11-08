import type { CommandOutput } from "../../core/commands/index.ts";
import type { DocJson, SourceType } from "../../core/types.ts";
import { useRead } from "./data/query.ts";

export type MediaShown = CommandOutput<"media.show">;
export type VideoShown = MediaShown["videos"][number];

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv"];
export const DOC_EXTENSIONS = ["docx", "pdf", "txt", "md"];
const ext = (list: string[]) => list.map((e) => `.${e}`).join(",");
export const MEDIA_ACCEPT = ext([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
export const DOC_ACCEPT = ext([...DOC_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);
export const isImage = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);
export const isVideo = (name: string) => /\.(mp4|mov|m4v|mkv|webm|avi|wmv)$/i.test(name);

// ponytail: the page's copy of the core's sourceType (src/core/lib/media.ts): written in doc.json for a document of
// files, read from the copy's extension for a Word, PDF or text document
export function sourceType(doc: Pick<DocJson, "source">): SourceType {
  if (doc.source.type) return doc.source.type;
  const e = (doc.source.file || doc.source.name || "").toLowerCase();
  return e.endsWith(".pdf") ? "pdf" : e.endsWith(".txt") || e.endsWith(".md") ? "txt" : "docx";
}

export const isMediaDoc = (doc: Pick<DocJson, "source">) => ["images", "video", "mixed"].includes(sourceType(doc));
export const isObservedDoc = (doc: Pick<DocJson, "source" | "reference">) => isMediaDoc(doc) && !doc.reference;

// ponytail: a moment of a video as its anchors write it — mm:ss, h:mm:ss past an hour
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ponytail: the second a t: or frame: anchor names (t:04:30, frame:3/04:30, t:04:30-2), null for another anchor
export function momentOf(anchor: string): { n: number; at: number } | null {
  const m = /^(?:t|frame):(?:(\d+)\/)?(?:(\d+):)?(\d{1,2}):(\d{2})(?:-\d+)?$/.exec(anchor.trim());
  if (!m) return null;
  return { n: m[1] ? Number(m[1]) : 1, at: Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) };
}

export const isPictureAnchor = (anchor: string) => /^(fig|img|frame):/.test(anchor.trim());

// ponytail: what a document is, in the words of the list — Word · PDF · Text · Images · 46 · Video · 12:40; images
// and videos together say both
export function typeLabel(doc: Pick<DocJson, "source">): string {
  const t = sourceType(doc);
  const files = doc.source.files ?? [];
  const images = files.filter((f) => f.kind === "image").length;
  const videos = files.filter((f) => f.kind === "video");
  if (t === "pdf") return "PDF";
  if (t === "txt") return "Text";
  if (t === "images") return `Images · ${images}`;
  if (t === "video") return videos[0]?.duration ? `Video · ${clock(videos[0].duration)}` : "Video";
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
    return !!d && isObservedDoc(d);
  };
}
