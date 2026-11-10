import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { refuseLeftOut } from "../claude/access.ts";
import { readPictures } from "../claude/media.ts";
import { EFFORT, MODEL, NOTE } from "../claude/schemas.ts";
import { claudeVersion } from "../claude/status.ts";
import { command, projectOf, UserError } from "../command.ts";
import { docDir, readDoc, readFigures, writeFigures } from "../lib/docs.ts";
import { afterConversion, convertSteps, inSlot, recheckCiting, runOf, withIndex } from "../lib/docs-pipeline.ts";
import { ffmpegOrFail } from "../lib/ffmpeg.ts";
import { copyMediaFiles, dropMediaFile, filesOf, imageAnchor, ordered, type Rejected } from "../lib/media.ts";
import { frameAnchor, readFixes, readVideo, transcriptLines, writeMediaMd, writeVideo } from "../lib/media-md.ts";
import { migrateMedia } from "../lib/media-migrate.ts";
import { convertMedia, MEDIA_STEPS } from "../lib/media-pipeline.ts";
import { docName } from "../lib/names.ts";
import { capMB, videosMB } from "../lib/video/disk.ts";
import { normalizeFrame } from "../lib/video/frames.ts";
import { videoIo } from "../lib/video/io.ts";
import { frameContext, videoSummary } from "../lib/video/pipeline.ts";
import { drawKeyFrames, keyMoments, syncFrameEntries } from "../lib/video/survey.ts";
import { secondsOf } from "../rag/anchors.ts";
import type { MediaFile } from "../types.ts";
import { applyChoices, doc, index, mediaDoc, momentIn, video, videoOf } from "./media-args.ts";
import { commands as measure } from "./media-measure.ts";
import { LINE, MEDIA_FILE, PICKED, REJECTED, SOURCE_TYPE, VIDEO_CHOICES, VIDEO_SUMMARY } from "./media-schemas.ts";
import { commands as speech } from "./media-speech.ts";

function noPicture(v: { sound?: boolean } | null, name: string): void {
  if (v?.sound)
    throw new UserError(
      `${name} is a recording of sound alone: it has no frame.`,
      "Cite what is said (t:mm:ss); media.transcript gives the lines.",
      "no-picture",
    );
}

const read = z
  .boolean()
  .optional()
  .describe(
    "Have Claude read the new pictures and survey the new videos (default: project.json rag.describeFigures, on)",
  );

const citedBy = z
  .array(
    z.object({
      id: z.string().describe("Test id"),
      key: z.string().optional().describe("Jira key, once the test is in Xray"),
      summary: z.string().describe("Test summary"),
      review: z.string().describe("Where the test is in the review"),
      steps: z.number().describe("Steps with a source that cites the document"),
    }),
  )
  .describe("Tests whose sources cite the document; their mechanical check was redone");

const jobOut = z.object({
  doc: z.string().describe("The document"),
  type: SOURCE_TYPE,
  added: z.array(z.number()).describe("Numbers of the files added"),
  removed: z.number().optional().describe("Number of the file removed"),
  rejected: REJECTED,
  files: z.array(MEDIA_FILE).describe("The document's files after the job"),
  warnings: z
    .array(z.string())
    .describe("What the conversion could not do (no ffmpeg, no speech model, a file unreadable)"),
  citedBy,
  index: z
    .object({
      chunks: z.number().optional().describe("Passages in the index after the run"),
      degraded: z.string().optional().describe("Why no vectors were built"),
      error: z.string().optional().describe("Why the index run failed; the files are kept"),
    })
    .optional()
    .describe("With index: what the index run that followed did"),
});

const outOf = (project: string, id: string, extra: Partial<z.input<typeof jobOut>>) => {
  const d = readDoc(project, id);
  return {
    doc: id,
    type: d.source.type ?? "images",
    added: [],
    rejected: [],
    files: filesOf(d),
    warnings: d.converted?.warnings ?? [],
    citedBy: [],
    ...extra,
  } as z.input<typeof jobOut>;
};

export const commands = [
  command({
    name: "media.add",
    summary:
      "Add images or videos to an images or video document: they are copied, numbered after the document's files (an image's anchor img:<n> never moves), prepared, read by Claude (20 pictures a run; a video is transcribed, surveyed and its key frames taken), and doc.md is written again; the index follows.",
    input: z.object({
      doc,
      files: PICKED,
      video: VIDEO_CHOICES.optional().describe("What to hear of the videos added: languages, sound track, part"),
      describeFigures: read,
      model: MODEL.optional().describe("Claude model that reads the pictures (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Claude effort for the pictures (default: low)"),
      note: NOTE,
      index,
    }),
    output: jobOut,
    mutates: true,
    job: "docs.convert",
    positional: ["doc"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      mediaDoc(project, input.doc);
      const steps = convertSteps([{ id: "copy", label: "Copy the files" }, ...MEDIA_STEPS], { ...input, study: true });
      ctx.steps?.(steps);
      let added: MediaFile[] = [];
      let rejected: Rejected[] = [];
      const r = await inSlot(ctx, project, steps, async () => {
        ctx.step?.("copy");
        ({ added, rejected } = copyMediaFiles(project, input.doc, input.files));
        if (input.video)
          for (const f of added.filter((x) => x.kind === "video")) applyChoices(project, input.doc, f.n, input.video);
        if (!added.length) ctx.log("warn", `No file was added: ${rejected[0]?.why ?? "nothing given"}`);
        ctx.step?.("convert");
        const d = await convertMedia(ctx, project, input.doc, {
          read: input.describeFigures ?? true,
          run: runOf(input),
        });
        return afterConversion(ctx, project, d, runOf(input), {
          describeFigures: false,
          study: true,
          index: input.index,
        });
      });
      return outOf(project, input.doc, {
        added: added.map((f) => f.n),
        rejected,
        citedBy: r.citedBy,
        ...(r.index ? { index: r.index } : {}),
      });
    },
  }),
  command({
    name: "media.remove",
    summary:
      "Remove one file from an images or video document: its copy, its picture, a video's transcript and key frames; doc.md is written again and the tests citing the document are checked again (a source on it then reports its anchor missing). The last file is not removed: remove the document instead.",
    input: z.object({ doc, n: z.coerce.number().int().describe("The file's number (media.show)"), index }),
    output: jobOut,
    mutates: true,
    job: "docs.convert",
    positional: ["doc", "n"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      mediaDoc(project, input.doc);
      ctx.steps?.([
        { id: "cited", label: "Re-check the tests citing it" },
        ...(input.index ? [{ id: "index", label: "Update the search index" }] : []),
      ]);
      dropMediaFile(project, input.doc, input.n);
      writeMediaMd(project, input.doc);
      ctx.step?.("cited");
      const cited = recheckCiting(ctx, project, readDoc(project, input.doc));
      const idx = input.index ? await withIndex(ctx, project, runOf({})) : undefined;
      return outOf(project, input.doc, { removed: input.n, citedBy: cited, ...(idx ? { index: idx } : {}) });
    },
  }),
  command({
    name: "media.disk",
    summary:
      "The room the project's videos take on disk (originals, lighter copies, sound, frames) and the cap the team set for them, if any.",
    input: z.object({}),
    output: z.object({
      usedMB: z.number().describe("Room the documents holding a video take today, MB"),
      capMB: z.number().optional().describe("The cap (project.json video.diskCapGB), MB; absent = none"),
    }),
    mutates: false,
    async run(ctx) {
      const project = projectOf(ctx);
      const cap = capMB(project);
      return { usedMB: videosMB(project), ...(cap !== null ? { capMB: cap } : {}) };
    },
  }),
  command({
    name: "media.show",
    summary:
      "Show an images or video document's files: each image with its anchor (img:<n>), picture and what Claude read in it; each video with its length, sound tracks, languages heard, chapters and key frames (frame:…, each with the description a source may quote). The transcript is media.transcript.",
    input: z.object({ doc }),
    output: z.object({
      doc: z.string().describe("The document"),
      type: SOURCE_TYPE,
      observed: z.boolean().describe("Shows what the real system does (true until the team marks it as the reference)"),
      images: z
        .array(
          MEDIA_FILE.extend({
            anchor: z.string().describe("Its anchor, img:<n>"),
            caption: z.string().describe("Its caption: file name and date — the image's quotable text"),
            description: z.string().describe("What Claude saw in it (never quotable); empty until read"),
            labels: z.array(z.string()).describe("Text visible in it, verbatim as Claude read it (never quotable)"),
          }),
        )
        .describe("The images, in the order they were taken"),
      videos: z.array(VIDEO_SUMMARY).describe("The videos, by number"),
    }),
    mutates: false,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      refuseLeftOut(ctx.llm, input.doc);
      const d = mediaDoc(project, input.doc);
      const figures = new Map(readFigures(project, d.id).map((f) => [f.anchor, f]));
      return {
        doc: d.id,
        type: d.source.type ?? "images",
        observed: !d.reference,
        images: ordered(filesOf(d).filter((f) => f.kind === "image")).map((f) => {
          const e = figures.get(imageAnchor(f.n));
          return {
            ...f,
            anchor: imageAnchor(f.n),
            caption: e?.caption ?? f.name,
            description: e?.description ?? "",
            labels: e?.labels ?? [],
          };
        }),
        videos: filesOf(d)
          .filter((f) => f.kind === "video")
          .sort((a, b) => a.n - b.n)
          .map((f) => videoSummary(project, d.id, f)),
      };
    },
  }),
  command({
    name: "media.transcript",
    summary:
      "What is said in a video, heard on this PC, whole or between two moments: each line with the second it starts at (t:mm:ss), its language, its translation when it was said in another language than the project's, and whether the engine doubted it. A source cites a moment (docId#t:04:30) or a range (docId#t:02:36..02:52) and quotes the words said there; what is seen without a word is cited from a key frame's description (docId#v:02:36..02:52).",
    input: z.object({
      doc,
      video,
      from: z.string().optional().describe("From this moment, mm:ss or h:mm:ss (or seconds)"),
      to: z.string().optional().describe("Up to this moment, mm:ss or h:mm:ss (or seconds)"),
    }),
    output: z.object({
      doc: z.string().describe("The document"),
      video: z.number().describe("The video's number"),
      duration: z.number().describe("The video's length, seconds"),
      transcribed: z.boolean().describe("Whether it was transcribed on this PC (no speech model: false, no lines)"),
      lines: z.array(LINE).describe("The lines, in time order"),
    }),
    mutates: false,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      refuseLeftOut(ctx.llm, input.doc);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      const at = (s?: string) => (s === undefined ? undefined : (secondsOf(s) ?? undefined));
      const from = at(input.from) ?? 0;
      const to = at(input.to) ?? Number.POSITIVE_INFINITY;
      return {
        doc: input.doc,
        video: f.n,
        duration: v?.duration ?? f.duration ?? 0,
        transcribed: !!v?.transcribed,
        lines: v
          ? transcriptLines(f.n, v, readFixes(project, input.doc, f.n)).filter((l) => l.end >= from && l.at <= to)
          : [],
      };
    },
  }),
  command({
    name: "media.frame",
    summary:
      "Draw one frame of a video at a moment, in full (≤ 2000 px), as a JPEG to Read; a key frame's picture when the moment is one. Needs ffmpeg for another moment.",
    input: z.object({
      doc,
      at: z.string().describe("The moment, mm:ss or h:mm:ss (or seconds)"),
      video,
    }),
    output: z.object({
      file: z.string().describe("Absolute path of the JPEG, to Read"),
      at: z.number().describe("The moment drawn, seconds"),
      anchor: z.string().optional().describe("Its anchor when it is a key frame (frame:mm:ss), citable"),
    }),
    // ponytail: .testimus/frames/ is a cache, like docs.page's pages — drawing a frame changes nothing the project
    // says, and every Claude run may look at a moment it read about in the transcript
    mutates: false,
    positional: ["doc", "at"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      refuseLeftOut(ctx.llm, input.doc);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      noPicture(v, f.name);
      const secs = momentIn(input.at, v?.duration ?? f.duration ?? 0, f.name);
      const key = v?.keyFrames.find((k) => Math.floor(k.at) === Math.floor(secs) && k.figure);
      if (key?.figure && existsSync(join(docDir(project, input.doc), key.figure)))
        return {
          file: join(docDir(project, input.doc), key.figure),
          at: key.at,
          anchor: frameAnchor(f.n, key.at),
        };
      const out = join(project, ".testimus", "frames", input.doc, `${f.n}-${Math.floor(secs)}.jpg`);
      if (!existsSync(out)) {
        ffmpegOrFail();
        const raw = `${out.slice(0, -4)}.raw.jpg`;
        try {
          await videoIo.frameAt(join(docDir(project, input.doc), f.file), secs, raw, { hdr: !!v?.hdr }, ctx.signal);
          await normalizeFrame(raw, out);
        } finally {
          rmSync(raw, { force: true });
        }
      }
      return { file: out, at: secs };
    },
  }),
  command({
    name: "media.keep",
    summary:
      "Make any second of a video a key frame: its picture is drawn in full and added to the document with its anchor frame:mm:ss, so a source may cite it (docId#frame:07:12, or a range v:07:10..07:15 that holds it) and a step may embed it. Its description is the one given, else Claude's (it reads the picture with what is said around it); without either it stays empty until the document is read again.",
    input: z.object({
      doc,
      at: z.string().describe("The moment, mm:ss or h:mm:ss (or seconds)"),
      video,
      description: z
        .string()
        .optional()
        .describe(
          "What the frame shows, in the project's language — give it when you looked at the frame yourself (media.frame)",
        ),
      model: MODEL.optional().describe("Claude model that reads the frame (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Claude effort for the frame (default: low)"),
    }),
    output: z.object({
      anchor: z.string().describe("The key frame's anchor, frame:mm:ss"),
      at: z.number().describe("Its moment, seconds"),
      figure: z.string().describe("Its picture, relative to the document folder"),
      description: z.string().describe("What it shows (empty when nobody read it yet)"),
      added: z.boolean().describe("False when that second was a key frame already"),
    }),
    mutates: true,
    job: "media.keep",
    positional: ["doc", "at"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      if (!v)
        throw new UserError(
          `${f.name} was not read yet.`,
          `Convert the document first: testimus docs convert ${input.doc}.`,
        );
      refuseLeftOut(ctx.llm, input.doc);
      noPicture(v, f.name);
      const at = momentIn(input.at, v.duration, f.name);
      const anchor = frameAnchor(f.n, at);
      const had = v.keyFrames.find((k) => Math.floor(k.at) === Math.floor(at) && k.figure);
      const fixes = readFixes(project, input.doc, f.n);
      if (!had) {
        ffmpegOrFail();
        const frames = keyMoments([...v.keyFrames, { at, why: "", asked: true }], v.duration);
        const drawn = await drawKeyFrames(ctx, project, input.doc, f, { ...v, keyFrames: frames }, fixes);
        writeVideo(project, input.doc, f.n, { ...(readVideo(project, input.doc, f.n) ?? v), keyFrames: drawn });
      }
      const given = input.description?.replace(/\s+/g, " ").trim();
      if (given) {
        const all = readFigures(project, input.doc);
        const e = all.find((x) => x.anchor === anchor);
        if (e && !e.description.trim()) {
          e.description = given;
          writeFigures(project, input.doc, all);
        }
      } else if (!ctx.llm && (await claudeVersion()).ok) {
        const e = readFigures(project, input.doc).find((x) => x.anchor === anchor);
        if (!e?.description.trim())
          await readPictures(project, input.doc, ctx, {
            model: input.model,
            effort: input.effort,
            anchors: [anchor],
            context: frameContext(project, input.doc),
          });
      }
      syncFrameEntries(project, input.doc, f.n, readVideo(project, input.doc, f.n)?.keyFrames ?? [], fixes);
      writeMediaMd(project, input.doc);
      recheckCiting(ctx, project, readDoc(project, input.doc));
      const e = readFigures(project, input.doc).find((x) => x.anchor === anchor);
      return {
        anchor,
        at: had?.at ?? at,
        figure: e?.file ?? "",
        description: e?.description ?? "",
        added: !had,
      };
    },
  }),
  command({
    name: "media.set",
    summary:
      "Choose what is heard of a video — the languages spoken in it, the sound track, the part to transcribe — kept on the video; it is heard that way the next time (media.retranscribe).",
    input: z.object({
      doc,
      video,
      ...VIDEO_CHOICES.shape,
      allTracks: z.boolean().optional().describe("Hear all the sound tracks again, mixed (drops track)"),
      whole: z.boolean().optional().describe("Transcribe the whole video again (drops from and to)"),
    }),
    output: MEDIA_FILE,
    mutates: true,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      applyChoices(project, input.doc, f.n, input);
      return videoOf(project, input.doc, f.n);
    },
  }),
  ...speech,
  ...measure,
  command({
    name: "media.migrate",
    summary:
      "Turn the batches of photos once attached to a document as annexes (doc.json media, before 2026-11-08) into images documents of their own, and rewrite the tests' sources that cite them; done by itself when a project opens. dryRun says what would change.",
    input: z.object({
      dryRun: z.boolean().default(false).describe("Say what would be migrated and rewritten, change nothing"),
    }),
    output: z.object({
      migrated: z
        .array(
          z.object({
            from: z.string().describe("The document the batch was attached to"),
            lot: z.string().describe("The batch's id"),
            doc: z.string().describe("The images document it becomes"),
            title: z.string().describe("Its title (the batch's)"),
            images: z.number().describe("Its images"),
          }),
        )
        .describe("Each batch and the document it becomes"),
      rewritten: z
        .array(
          z.object({
            test: z.string().describe("The test"),
            from: z.string().describe("The source as it was (docId#§lot-…)"),
            to: z.string().describe("The source as it is now (newDoc#img:<n>)"),
          }),
        )
        .describe("Each source line rewritten"),
      dryRun: z.boolean().describe("True when nothing changed"),
    }),
    mutates: true,
    async run(ctx, input) {
      return migrateMedia(projectOf(ctx), input.dryRun);
    },
  }),
];
