import { readPictures } from "../claude/media.ts";
import type { JobRun } from "../claude/prompt.ts";
import { claudeVersion } from "../claude/status.ts";
import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { anchorsOf } from "../rag/convert.ts";
import type { DocJson } from "../types.ts";
import { readDoc, readDocMd, readFigures, writeDoc } from "./docs.ts";
import { whileConverting } from "./docs-index.ts";
import { filesOf, prepareImage, syncImageEntries, updateFile, updateFiles } from "./media.ts";
import { writeMediaMd } from "./media-md.ts";
import { processVideo } from "./media-video.ts";

export const MEDIA_CONVERTER = "media 1";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ponytail: the steps a media document's conversion shows; those that do not apply are skipped as it goes
export const MEDIA_STEPS = [
  { id: "convert", label: "Prepare the images and videos" },
  { id: "read", label: "Claude reads the pictures" },
];

// ponytail: an images or video document is converted from its files — each image not prepared yet becomes its picture
// (jpg ≤ 2000 px, EXIF orientation and date), each video goes through ffprobe, Whisper and its frames, Claude reads
// the pictures 20 a run (read: the conversion's describeFigures), and doc.md is written again. A file that cannot be
// read is marked failed with its reason and the others go on; without Claude the pictures stay, unread
export function convertMedia(
  ctx: Ctx,
  project: string,
  id: string,
  o: { read: boolean; force?: boolean; run: JobRun },
): Promise<DocJson> {
  return whileConverting(project, async () => {
    const warnings: string[] = [];
    if (o.force)
      updateFiles(project, id, (files) => {
        for (const f of files) f.state = "new";
      });
    const claude = o.read ? (await claudeVersion()).ok : false;
    if (o.read && !claude) ctx.log("info", "Claude is not available here: the pictures are kept, not read yet.");
    const todo = filesOf(readDoc(project, id)).filter((f) => f.kind === "image" && (f.state === "new" || !f.figure));
    for (const [n, f] of todo.entries()) {
      if (ctx.signal.aborted) break;
      ctx.progress({ message: `Preparing ${f.name}`, done: n, total: todo.length });
      try {
        const got = await prepareImage(project, id, f);
        updateFile(project, id, f.n, (x) => {
          Object.assign(x, got, { state: x.state === "analysed" && !o.force ? "analysed" : "ready" });
          delete x.error;
        });
      } catch (e) {
        warnings.push(`${f.name} could not be read as a picture: ${message(e)}`);
        updateFile(project, id, f.n, (x) => {
          x.state = "failed";
          x.error = `Not a picture Testimus can read: ${message(e)}`;
        });
      }
    }
    syncImageEntries(project, id);
    for (const f of filesOf(readDoc(project, id)).filter((x) => x.kind === "video")) {
      if (ctx.signal.aborted) break;
      const r = await processVideo(ctx, project, id, f, { claude, force: o.force, run: o.run });
      warnings.push(...r.warnings);
    }
    writeMediaMd(project, id);
    if (claude && !ctx.signal.aborted) {
      ctx.step?.("read");
      try {
        await readPictures(project, id, ctx, { ...o.run, force: o.force });
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        warnings.push(`Claude did not read the pictures: ${message(e)}`);
      }
    }
    for (const f of filesOf(readDoc(project, id)))
      if (f.state === "failed" && f.error && !warnings.some((w) => w.startsWith(f.name)))
        warnings.push(`${f.name}: ${f.error}`);
    const md = readDocMd(project, id);
    const doc = readDoc(project, id);
    const next: DocJson = {
      ...doc,
      converted: {
        with: MEDIA_CONVERTER,
        at: env.now().toISOString(),
        warnings,
        stats: {
          sections: anchorsOf(md).sections.length,
          figures: readFigures(project, id).filter((f) => f.file).length,
          chars: md.length,
        },
      },
    };
    writeDoc(project, next);
    return next;
  });
}
