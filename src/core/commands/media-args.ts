import { z } from "zod";
import { UserError } from "../command.ts";
import { readDoc } from "../lib/docs.ts";
import { filesOf, isMediaDoc, updateFile } from "../lib/media.ts";
import { clock, secondsOf } from "../rag/anchors.ts";
import type { DocJson, MediaFile } from "../types.ts";
import type { VIDEO_CHOICES } from "./media-schemas.ts";

export const doc = z.string().describe("Document id (the folder name under docs/) of an images or video document");
export const video = z.coerce
  .number()
  .int()
  .optional()
  .describe("The video's number in the document (media.show); default: its first video");
export const index = z
  .boolean()
  .default(true)
  .describe(
    "Then update the search index in the same job, once the conversions running in this project are done (a failed index run keeps the files)",
  );

export function mediaDoc(project: string, id: string): DocJson {
  const d = readDoc(project, id);
  if (!isMediaDoc(d))
    throw new UserError(
      `${id} is not an images or video document.`,
      "Images and videos are documents of their own: add them with docs.addFiles, or to an images document with media.add.",
    );
  if (d.pending)
    throw new UserError(
      `${id} is waiting to start: none of its files is copied yet.`,
      `Start it first: testimus docs start ${id}`,
      "pending",
    );
  return d;
}

export function videoOf(project: string, id: string, n?: number): MediaFile {
  const videos = filesOf(mediaDoc(project, id)).filter((f) => f.kind === "video");
  const f = n === undefined ? videos[0] : videos.find((x) => x.n === n);
  if (!f)
    throw new UserError(
      n === undefined ? `${id} has no video.` : `${id} has no video ${n}.`,
      `testimus media show ${id} lists its files.`,
    );
  return f;
}

export function momentIn(text: string, length: number, name: string): number {
  const at = secondsOf(text);
  if (at === null || at < 0 || (length && at > length))
    throw new UserError(
      `No moment ${text} in ${name}${length ? ` (${clock(length)})` : ""}.`,
      "Give a moment as mm:ss within the video.",
    );
  return at;
}

// ponytail: what the team chose for a video is kept on its file in doc.json; an empty list of languages goes back to
// the project's, a range that covers nothing is refused
export function applyChoices(
  project: string,
  docId: string,
  n: number,
  c: z.infer<typeof VIDEO_CHOICES> & { allTracks?: boolean; whole?: boolean },
): void {
  const from = c.from !== undefined ? secondsOf(c.from) : null;
  const to = c.to !== undefined ? secondsOf(c.to) : null;
  if ((c.from !== undefined && from === null) || (c.to !== undefined && to === null))
    throw new UserError(
      "The part to transcribe is not a moment.",
      "Give it as mm:ss or seconds: --from 05:00 --to 20:00.",
    );
  if (from !== null && to !== null && to <= from)
    throw new UserError("The part to transcribe ends before it starts.", "Give --to after --from.");
  updateFile(project, docId, n, (f) => {
    if (c.spoken) {
      const spoken = [...new Set(c.spoken.map((l) => l.trim().toLowerCase()).filter(Boolean))];
      if (spoken.length) f.spoken = spoken;
      else delete f.spoken;
    }
    if (c.track !== undefined) f.track = c.track;
    if (c.allTracks) delete f.track;
    if (from !== null || to !== null)
      f.range = { from: from ?? f.range?.from ?? 0, to: to ?? f.range?.to ?? f.duration ?? Number.MAX_SAFE_INTEGER };
    if (c.whole) delete f.range;
  });
}
