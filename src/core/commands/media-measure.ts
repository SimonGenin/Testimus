import { z } from "zod";
import { command, projectOf } from "../command.ts";
import { docName } from "../lib/names.ts";
import { measureSpeech, projectMeasures, readReference, writeReference } from "../lib/video/measure.ts";
import { doc, video, videoOf } from "./media-args.ts";

const ROW = z.object({
  model: z.string().describe("Catalog id"),
  label: z.string().describe("Its name"),
  device: z.enum(["gpu", "cpu"]).describe("Where it ran"),
  denoised: z
    .boolean()
    .optional()
    .describe("True when it heard the reference through the denoiser (absent: the sound as it is)"),
  jargon: z
    .number()
    .nullable()
    .describe("Share of the glossary's terms said that it wrote right, 0 to 1 (null: none was said)"),
  terms: z.number().describe("Glossary terms said in the reference"),
  wer: z
    .number()
    .describe(
      "Word error rate, 0 is perfect — counted without case nor punctuation and with numbers in one form (« 203 » is « two hundred and three », « S12 » is « S 12 »), in French, English and German",
    ),
  timing: z.number().nullable().describe("Median gap between a sentence's start and its line's anchor, seconds"),
  speed: z.number().describe("Seconds of video heard in a second"),
  seconds: z
    .number()
    .optional()
    .describe("Seconds it took to hear the part measured, the sound drawn and the model loaded included"),
  memoryMB: z
    .number()
    .optional()
    .describe(
      "Peak memory of the engine's process while it heard the reference, MB — the processor's memory (working set), not what a graphics card holds; absent when it could not be read",
    ),
  at: z.string().optional().describe("When this row was measured (ISO date)"),
});

const VERDICT = z.object({
  about: z.enum(["denoising", "quantisation"]).describe("What the sentence settles"),
  model: z.string().optional().describe("Catalog id of the model it is about (the lighter one, for a quantisation)"),
  against: z.string().optional().describe("Catalog id of the heavier model it is held against (quantisation)"),
  pays: z.boolean().nullable().describe("Whether it is worth its cost on this reference (null: not measured)"),
  text: z.string().describe("One plain sentence, with the figures side by side"),
});

export const commands = [
  command({
    name: "media.reference",
    summary:
      "Keep or read the reference transcript of a video: a few minutes typed by hand as a person hears them, a sentence a line, each starting with its moment ([02:36] …). The transcription models are measured against it (media.measure). An empty text removes it.",
    input: z.object({
      doc,
      video,
      text: z.string().optional().describe("The reference, to keep; leave out to read the one kept"),
    }),
    output: z.object({
      lines: z
        .array(z.object({ at: z.number().describe("Moment, seconds"), text: z.string().describe("What is said") }))
        .describe("The reference's lines"),
    }),
    mutates: true,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      if (input.text !== undefined) writeReference(project, input.doc, f.n, input.text);
      return { lines: readReference(project, input.doc, f.n) };
    },
  }),
  command({
    name: "media.measure",
    summary:
      "Measure the transcription models installed on this PC against a video's reference transcript: the glossary's terms written right (where a mistake costs: a step quotes them), the word error rate (numbers in one form), how far the anchors are from where the sentences start, how fast it went and the memory the engine took. With denoise, each model hears the reference twice — as it is, and through ffmpeg's denoiser. The report says in a sentence each whether denoising and whether the lighter quantisation of a model (5-bit against 8-bit) pay on this reference. Nothing of the document changes; the report is kept (eval/speech/) and read back by media.measures.",
    input: z.object({
      doc,
      video,
      models: z
        .array(z.string())
        .optional()
        .describe(
          "Catalog ids of the models to measure (default: every one installed); a model left out keeps the row of its last measure while the reference is the same",
        ),
      denoise: z
        .boolean()
        .default(false)
        .describe("Hear the reference a second time through ffmpeg's denoiser (afftdn), and report both"),
    }),
    output: z.object({
      doc: z.string().describe("The document"),
      video: z.number().describe("The video's number"),
      at: z.string().describe("When it was measured"),
      from: z.number().describe("Start of the part measured, seconds"),
      to: z.number().describe("End of the part measured, seconds"),
      words: z.number().describe("Words of the reference"),
      language: z.string().optional().describe("The language the reference is in, as a code (fr, en, de…)"),
      rows: z.array(ROW).describe("One row a model (two with denoise), the best first"),
      verdicts: z
        .array(VERDICT)
        .describe(
          "Whether denoising, and whether the lighter quantisation of a model, pay on this reference: a sentence each",
        ),
    }),
    mutates: true,
    job: "media.measure",
    positional: ["doc"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const r = await measureSpeech(ctx, project, input.doc, f, { models: input.models, denoise: input.denoise });
      return { ...r, verdicts: r.verdicts ?? [] };
    },
  }),
  command({
    name: "media.measures",
    summary:
      "The project's reference set for transcription: every video that has a reference transcript, with what each model made of it the last time it was measured (media.measure), and by language and model the figures over its videos — saying when a language has fewer than 3 reference videos, under which a model is not to be chosen on them.",
    input: z.object({}),
    output: z.object({
      videos: z
        .array(
          z.object({
            doc: z.string().describe("The document"),
            video: z.number().describe("The video's number in it"),
            name: z.string().describe("The video's file name"),
            language: z
              .string()
              .optional()
              .describe("The language its reference is in, as a code (absent: not known yet)"),
            words: z.number().describe("Words of its reference"),
            stale: z.boolean().describe("True when the reference changed since its measures: measure it again"),
            measures: z
              .array(
                z.object({
                  model: z.string().describe("Catalog id"),
                  label: z.string().describe("Its name"),
                  at: z.string().describe("When it was measured (ISO date)"),
                  device: z.enum(["gpu", "cpu"]).describe("Where it ran"),
                  denoised: z.boolean().optional().describe("True when it heard the reference through the denoiser"),
                  wer: z.number().describe("Word error rate, 0 is perfect (numbers in one form)"),
                  jargon: z
                    .number()
                    .optional()
                    .describe("Share of the glossary's terms said that it wrote right, 0 to 1 (absent: none was said)"),
                  terms: z.number().describe("Glossary terms said in the reference"),
                  timing: z
                    .number()
                    .optional()
                    .describe("Median gap between a sentence's start and its line's anchor, seconds"),
                  speed: z.number().describe("Seconds of video heard in a second"),
                  seconds: z.number().optional().describe("Seconds it took to hear the part measured"),
                  memoryMB: z
                    .number()
                    .optional()
                    .describe("Peak memory of the engine's process, MB (absent when it could not be read)"),
                }),
              )
              .describe("Its saved measures, one a model (and one more when heard denoised), the best first"),
          }),
        )
        .describe("The videos that have a reference transcript"),
      byLanguage: z
        .array(
          z.object({
            language: z.string().describe("Language code (« unknown » when a video's language is not known)"),
            model: z.string().describe("Catalog id"),
            label: z.string().describe("The model's name"),
            videos: z.number().describe("Reference videos of the language this model was measured on"),
            references: z.number().describe("Reference videos of the language"),
            enough: z.boolean().describe("False under 3 reference videos: too few to choose a model on these figures"),
            words: z.number().describe("Words of the references it was measured on"),
            wer: z.number().describe("Word error rate over those videos, each weighing its reference's words"),
            jargon: z
              .number()
              .optional()
              .describe("Share of the glossary's terms said in those videos that it wrote right (absent: none said)"),
            terms: z.number().describe("Glossary terms said in those videos"),
          }),
        )
        .describe("By language and model, the figures over the language's videos (the sound as it is)"),
      notes: z.array(z.string()).describe("A sentence for each language that has fewer than 3 reference videos"),
    }),
    mutates: false,
    async run(ctx) {
      const r = projectMeasures(projectOf(ctx));
      return {
        ...r,
        videos: r.videos.map((x) => ({
          ...x,
          measures: x.measures.map(({ jargon, timing, ...m }) => ({
            ...m,
            ...(jargon !== null ? { jargon } : {}),
            ...(timing !== null ? { timing } : {}),
          })),
        })),
      };
    },
  }),
];
