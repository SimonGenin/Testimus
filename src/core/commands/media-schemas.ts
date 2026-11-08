import { z } from "zod";

export const PICKED = z
  .array(
    z.object({
      path: z.string().optional().describe("Path of the file on this PC (the desktop app, the CLI); it is copied"),
      name: z.string().optional().describe("File name, with dataBase64 (a file sent from the page)"),
      dataBase64: z.string().optional().describe("Content of a file sent from the page, base64"),
    }),
  )
  .min(1)
  .describe("The files, each by path or by name and content; they are copied into the project");

export const SOURCE_TYPE = z
  .enum(["docx", "pdf", "txt", "images", "video", "mixed"])
  .describe(
    "What the document is made of: a Word or PDF file, a text file, one or several images, a video, or images and videos together",
  );

export const MEDIA_FILE = z.object({
  n: z.number().describe("The file's number in the document, never given again: an image's anchor is img:<n>"),
  name: z.string().describe("The original file's name"),
  file: z.string().describe("The copy, relative to the document folder (files/…)"),
  kind: z.enum(["image", "video"]).describe("An image or a video"),
  sha256: z.string().describe("sha256 of the copy"),
  figure: z.string().optional().describe("An image's picture, relative to the document folder (figures/img-<n>.jpg)"),
  takenAt: z.string().optional().describe("When the image was taken (EXIF), local time"),
  width: z.number().optional().describe("Width of the picture or the video, px"),
  height: z.number().optional().describe("Height of the picture or the video, px"),
  duration: z.number().optional().describe("A video's length, seconds"),
  state: z
    .enum(["new", "ready", "analysed", "failed"])
    .describe("new: copied, not prepared; ready: prepared, Claude has not read it; analysed: read; failed: unreadable"),
  error: z.string().optional().describe("Why it failed"),
});

export const REJECTED = z
  .array(
    z.object({
      name: z.string().describe("The file's name"),
      why: z.string().describe("Why it was not added"),
      code: z
        .enum(["not-media", "later", "duplicate", "failed"])
        .describe(
          "not-media: neither an image nor a video; later: HEIC or sound (a later version); duplicate: already in the document; failed: unreadable",
        ),
    }),
  )
  .describe("The files not added, and why");

export const VIDEO_SUMMARY = z.object({
  n: z.number().describe("The video's number in the document"),
  name: z.string().describe("The original file's name"),
  file: z.string().describe("The copy, relative to the document folder: the page plays it through /files"),
  duration: z.number().describe("Length, seconds (0 until ffprobe read it)"),
  transcribed: z.boolean().describe("Whether Whisper heard it on this PC"),
  lines: z.number().describe("Lines of its transcript (media.transcript gives them)"),
  chapters: z
    .array(z.object({ at: z.number().describe("Start, seconds"), title: z.string().describe("Claude's title") }))
    .describe("The parts of the video, as Claude surveyed it from its mosaics (never quotable)"),
  keyFrames: z
    .array(
      z.object({
        at: z.number().describe("Moment, seconds"),
        anchor: z.string().describe("Its anchor, frame:mm:ss (frame:<n>/mm:ss for a video other than file 1)"),
        figure: z.string().describe("Its picture, relative to the document folder"),
        why: z.string().describe("Why Claude chose it (empty when taken evenly, without Claude)"),
        description: z.string().describe("What Claude saw in it (never quotable); empty until read"),
      }),
    )
    .describe("The frames worth seeing whole, in time order"),
});

export const LINE = z.object({
  anchor: z.string().describe("The line's anchor: t:mm:ss (t:<n>/mm:ss for a video other than file 1), quotable"),
  at: z.number().describe("Start, seconds"),
  end: z.number().describe("End, seconds"),
  text: z.string().describe("What was said, verbatim as Whisper heard it"),
});
