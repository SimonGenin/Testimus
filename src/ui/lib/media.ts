import type { CommandOutput } from "../../core/commands/index.ts";
import type { Job } from "../../core/types.ts";
import { plural } from "./format.ts";

export type Batch = CommandOutput<"media.list">[number];
export type BatchShown = CommandOutput<"media.show">;

// ponytail: an annex's anchors all start with lot- (the body of a document never has one) — a source from an annex is
// an observation of the real system, marked « Observed » wherever a source is shown
export const isObserved = (anchor: string) => /^(?:§\s*|fig:)lot-/.test(anchor.trim());

export const PHOTO_ACCEPT = ".jpg,.jpeg,.png,.webp";
export const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
export const isPhoto = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);

// ponytail: what a batch holds and where Claude is with it, in one line (« 14 photos · 2 not read yet »)
export function batchLine(b: Pick<Batch, "photos" | "videos" | "analysed" | "failed">): string {
  const parts = [plural(b.photos, "photo"), ...(b.videos ? [plural(b.videos, "video")] : [])];
  const unread = b.photos - b.analysed - b.failed;
  if (b.failed) parts.push(`${b.failed} unreadable`);
  if (unread > 0) parts.push(`${unread} not read yet`);
  return parts.join(" · ");
}

// ponytail: the batch job running on a document — a new batch is the document's (its id comes when it ends), another
// names the batch after the document
export function batchJob(jobs: Job[], doc: string, lot?: string): Job | undefined {
  return jobs.find(
    (j) =>
      j.kind === "media" &&
      j.status === "running" &&
      (lot
        ? j.subject === `${doc} · ${lot}` || j.subject.startsWith(`${doc} · ${lot} · `)
        : j.subject === doc || j.subject.startsWith(`${doc} · `)),
  );
}

export const jobPercent = (j: Job | undefined) =>
  j?.progress?.total ? Math.round(((j.progress.done ?? 0) / j.progress.total) * 100) : null;
