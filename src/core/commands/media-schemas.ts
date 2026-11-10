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

export const SPOKEN = z
  .array(z.string())
  .describe(
    "Languages spoken, as codes (fr, en, de…): one = every passage is heard in it; several = each passage is heard in the one detected among them; none = each passage in the language detected",
  );

export const RANGE = z.object({
  from: z.number().describe("Start of the part to transcribe, seconds"),
  to: z.number().describe("End of the part to transcribe, seconds"),
});

// ponytail: what the team chooses for a video before it is heard — given when it is added, changed with media.set
export const VIDEO_CHOICES = z.object({
  spoken: SPOKEN.optional(),
  track: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      "The sound track to hear, from 0 (default: all of them, mixed — a screen recording keeps the microphone and the PC apart)",
    ),
  from: z.string().optional().describe("Transcribe from this moment only, mm:ss or seconds (a very long video)"),
  to: z.string().optional().describe("Transcribe up to this moment only, mm:ss or seconds"),
});

export const MEDIA_FILE = z.object({
  n: z.number().describe("The file's number in the document, never given again: an image's anchor is img:<n>"),
  name: z.string().describe("The original file's name"),
  file: z.string().describe("The copy, relative to the document folder (files/…)"),
  kind: z
    .enum(["image", "video"])
    .describe("An image, or a video (a recording of sound alone is a video without picture)"),
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
  spoken: SPOKEN.optional(),
  track: z.number().optional().describe("A video's sound track heard (absent: all, mixed)"),
  range: RANGE.optional().describe("The part of a video that is transcribed (absent: all of it)"),
});

export const REJECTED = z
  .array(
    z.object({
      name: z.string().describe("The file's name"),
      why: z.string().describe("Why it was not added"),
      code: z
        .enum(["not-media", "later", "duplicate", "failed", "disk-cap"])

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
  transcribed: z.boolean().describe("Whether it was heard on this PC"),
  lines: z.number().describe("Lines of its transcript (media.transcript gives them)"),
  unsure: z.number().describe("Lines the engine doubted and nobody confirmed or corrected yet"),
  fixed: z.number().describe("Ranges a person corrected or confirmed: no transcription replaces them"),
  audio: z.boolean().describe("Whether the video has sound"),
  sound: z.boolean().describe("A recording of sound alone: heard and cited like a video, with no frame"),
  tracks: z
    .array(
      z.object({
        language: z.string().optional().describe("The track's language, as the file says it"),
        title: z.string().optional().describe("The track's title, as the file says it"),
      }),
    )
    .describe("Its sound tracks, in the file's order (track 0 first)"),
  track: z.number().optional().describe("The one track heard (absent: all, mixed)"),
  spoken: SPOKEN.optional(),
  range: RANGE.optional().describe("The part transcribed (absent: all of it)"),
  with: z.string().optional().describe("The model that heard it"),
  device: z.enum(["gpu", "cpu"]).optional().describe("Where it was heard: the graphics card or the processor"),
  pieces: z
    .object({ done: z.number().describe("Pieces heard"), total: z.number().describe("Pieces in all") })
    .optional()
    .describe("While it is being heard: how far it is, in pieces of about ten minutes"),
  languages: z.record(z.string(), z.number()).describe("Seconds of speech heard in each language"),
  light: z
    .string()
    .optional()
    .describe(
      "A lighter copy the page plays instead (H.264 720p, a key frame every 2 s), relative to the document folder",
    ),
  codec: z.string().optional().describe("The original's video codec (h264, hevc…)"),
  subtitles: z
    .object({
      said: z.string().optional().describe("What is said, as WebVTT, relative to the document folder"),
      translated: z.string().optional().describe("The same in the project's language, where lines were translated"),
      chapters: z.string().optional().describe("The chapters, as a WebVTT chapters track"),
    })
    .describe("The video's text tracks, derived from its transcript"),
  report: z.boolean().describe("A new transcription waits for its report to be applied (media.report)"),
  chapters: z
    .array(z.object({ at: z.number().describe("Start, seconds"), title: z.string().describe("Claude's title") }))
    .describe("The parts of the video, as Claude planned it (never quotable)"),
  keyFrames: z
    .array(
      z.object({
        at: z.number().describe("Moment, seconds"),
        anchor: z.string().describe("Its anchor, frame:mm:ss (frame:<n>/mm:ss for a video other than file 1)"),
        figure: z.string().describe("Its picture, relative to the document folder"),
        why: z.string().describe("Why Claude chose it (empty when taken from the signals, without Claude)"),
        description: z
          .string()
          .describe(
            "What it shows, as Claude read it or a person corrected it: quotable (v:from..to, frame:…); empty until read",
          ),
        fixed: z.boolean().describe("Its description was corrected by a person: Claude never rewrites it"),
      }),
    )
    .describe("The frames worth seeing whole, in time order"),
});

export const LINE = z.object({
  anchor: z.string().describe("The line's anchor: t:mm:ss (t:<n>/mm:ss for a video other than file 1), quotable"),
  at: z.number().describe("Start, seconds"),
  end: z.number().describe("End, seconds"),
  text: z.string().describe("What was said, as the engine heard it or a person corrected it"),
  lang: z.string().optional().describe("The language it was said in (fr, en, de…)"),
  p: z.number().optional().describe("How sure the engine was of its words, 0 to 1"),
  unsure: z.boolean().optional().describe("The engine doubted it: listen before trusting it"),
  translation: z.string().optional().describe("Claude's translation into the project's language (never quotable)"),
  by: z.literal("human").optional().describe("A person corrected or confirmed it"),
});

export const PROPOSAL = z.object({
  id: z.string().describe("The proposal's id"),
  from: z.number().describe("Start of the line, seconds"),
  to: z.number().describe("End of the line, seconds"),
  heard: z.string().describe("What the engine heard"),
  text: z.string().describe("What Claude proposes instead"),
  clue: z.enum(["glossary", "screen", "document"]).describe("What the proposal rests on"),
  why: z.string().describe("The clue, in a sentence"),
});

export const REPORT = z.object({
  doc: z.string().describe("The document"),
  video: z.number().describe("The video's number"),
  at: z.string().describe("When the report was made"),
  before: z.object({
    with: z.string().describe("The model of the transcript before"),
    at: z.string().describe("When the transcript before was made"),
  }),
  holds: z.number().describe("Sources that hold as they are"),
  moved: z.number().describe("Sources whose words are still said, a little earlier or later: rewritten when applied"),
  lost: z.number().describe("Sources whose words are no longer said: to hear again"),
  rows: z
    .array(
      z.object({
        test: z.string().describe("The test"),
        step: z.number().describe("The step, from 1"),
        from: z.string().describe("The source as it is"),
        quote: z.string().describe("Its quote"),
        state: z.enum(["holds", "moved", "lost"]).describe("What the new transcript does to it"),
        to: z.string().optional().describe("moved: the source as it will be"),
        nearest: z
          .object({ anchor: z.string().describe("Where"), text: z.string().describe("What is said there") })
          .optional()
          .describe("lost: the nearest words now said around that moment"),
      }),
    )
    .describe("Each source of the tests that cites what is said in the video"),
});
