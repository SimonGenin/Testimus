import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { shouldDescribeFigures } from "../claude/figures.ts";
import { draftGlossary } from "../claude/glossary.ts";
import { proposeFixes } from "../claude/media.ts";
import { EFFORT, MODEL, NOTE } from "../claude/schemas.ts";
import { claudeVersion } from "../claude/status.ts";
import { command, projectOf, UserError } from "../command.ts";
import { env } from "../env.ts";
import { WEIGHT_MB } from "../lib/agents.ts";
import { docDir, listDocs, readDoc, readFigures, writeFigures } from "../lib/docs.ts";
import { afterConversion, convertSteps, inSlot, recheckCiting, runOf, withIndex } from "../lib/docs-pipeline.ts";
import { machineProfile } from "../lib/machine/profile.ts";
import { filesOf, isMediaDoc } from "../lib/media.ts";
import { frameAnchor, readFixes, readVideo, transcriptLines, writeFixes, writeMediaMd } from "../lib/media-md.ts";
import { convertMedia, MEDIA_STEPS } from "../lib/media-pipeline.ts";
import { docName } from "../lib/names.ts";
import { readJson, readProject, writeJson, writeProject } from "../lib/project.ts";
import { osUser } from "../lib/review.ts";
import { capMB, videosMB } from "../lib/video/disk.ts";
import { estimateOf } from "../lib/video/estimate.ts";
import { speechGlossary } from "../lib/video/glossary.ts";
import { videoIo } from "../lib/video/io.ts";
import { SPOKEN_LANGUAGES } from "../lib/video/passages.ts";
import { lighten } from "../lib/video/pipeline.ts";
import { applyReport, buildReport, readReport, undoTranscription } from "../lib/video/report.ts";
import { clock } from "../rag/anchors.ts";
import type { FixProposal, LineFix } from "../types.ts";
import { doc, index, mediaDoc, momentIn, video, videoOf } from "./media-args.ts";
import { LINE, PROPOSAL, REPORT } from "./media-schemas.ts";

// ponytail: the Claude run proposing corrections is built by claude/media.ts (tests/unit/core/claude/catalog.test.ts)
export const promptsUsed = ["video-fixes"];

const proposalsFile = (project: string, docId: string, n: number) =>
  join(docDir(project, docId), "video", `${n}.proposals.json`);
const readProposals = (project: string, docId: string, n: number) =>
  readJson<FixProposal[]>(proposalsFile(project, docId, n), []);

const at = z.string().describe("The moment the line starts at, mm:ss or h:mm:ss (or seconds)");
const fixed = z.object({
  doc: z.string().describe("The document"),
  video: z.number().describe("The video's number"),
  line: LINE.optional().describe("The line as it now reads (absent when it was removed)"),
  cited: z.number().describe("Tests citing the document, checked again"),
});

// ponytail: a change of what a video says is a change of its doc.md — the document's text is written again, the tests
// citing it are checked again, and the index is asked for (it joins the run under way)
async function afterText(
  ctx: Parameters<typeof recheckCiting>[0],
  project: string,
  docId: string,
  withIndexRun: boolean,
) {
  writeMediaMd(project, docId);
  const cited = recheckCiting(ctx, project, readDoc(project, docId));
  if (withIndexRun) await withIndex(ctx, project, runOf({}));
  return cited.length;
}

export const commands = [
  command({
    name: "media.fix",
    summary:
      "Correct a line of a video's transcript, or confirm it as heard (no text): the range of time of that line becomes a person's — no later transcription replaces it, and it is no longer « unsure ». doc.md is written again and the tests citing the document are checked again.",
    input: z.object({
      doc,
      at,
      text: z.string().optional().describe("What was really said; leave out to confirm the line as it is"),
      video,
      index,
    }),
    output: fixed,
    mutates: true,
    positional: ["doc", "at"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      if (!v)
        throw new UserError(
          `${f.name} has no transcript yet.`,
          `Convert the document: testimus docs convert ${input.doc}.`,
        );
      const fixes = readFixes(project, input.doc, f.n);
      const second = Math.floor(momentIn(input.at, v.duration, f.name));
      const line = transcriptLines(f.n, v, fixes).find((l) => Math.floor(l.at) === second);
      if (!line)
        throw new UserError(
          `No line starts at ${clock(second)} in ${f.name}.`,
          `testimus media transcript ${input.doc} lists the lines and their moments.`,
        );
      const was = fixes.lines.find((x) => Math.floor(x.from) === second);
      const machine = v.transcript.find((l) => Math.floor(l.at) === second);
      const fix: LineFix = {
        from: line.at,
        to: Math.max(line.end, line.at + 0.5),
        heard: was?.heard ?? machine?.text ?? line.text,
        text: (input.text ?? line.text).replace(/\s+/g, " ").trim(),
        by: osUser(),
        at: env.now().toISOString(),
      };
      if (!fix.text)
        throw new UserError(
          "A correction cannot be empty.",
          "Give the words said, or leave --text out to confirm the line.",
        );
      writeFixes(project, input.doc, f.n, {
        ...fixes,
        lines: [...fixes.lines.filter((x) => Math.floor(x.from) !== second), fix],
      });
      writeJson(
        proposalsFile(project, input.doc, f.n),
        readProposals(project, input.doc, f.n).filter((p) => Math.floor(p.from) !== second),
      );
      const cited = await afterText(ctx, project, input.doc, input.index);
      const now = transcriptLines(f.n, v, readFixes(project, input.doc, f.n)).find((l) => Math.floor(l.at) === second);
      return { doc: input.doc, video: f.n, ...(now ? { line: now } : {}), cited };
    },
  }),
  command({
    name: "media.unfix",
    summary:
      "Take back a correction or a confirmation of a line: what the engine heard at that moment stands again (unsure when it doubted it).",
    input: z.object({ doc, at, video, index }),
    output: fixed,
    mutates: true,
    positional: ["doc", "at"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      const fixes = readFixes(project, input.doc, f.n);
      const second = Math.floor(momentIn(input.at, v?.duration ?? 0, f.name));
      if (!fixes.lines.some((x) => Math.floor(x.from) === second))
        throw new UserError(
          `No correction starts at ${clock(second)} in ${f.name}.`,
          `testimus media transcript ${input.doc} marks the corrected lines.`,
        );
      writeFixes(project, input.doc, f.n, {
        ...fixes,
        lines: fixes.lines.filter((x) => Math.floor(x.from) !== second),
      });
      const cited = await afterText(ctx, project, input.doc, input.index);
      const now = v
        ? transcriptLines(f.n, v, readFixes(project, input.doc, f.n)).find((l) => Math.floor(l.at) === second)
        : undefined;
      return { doc: input.doc, video: f.n, ...(now ? { line: now } : {}), cited };
    },
  }),
  command({
    name: "media.describe",
    summary:
      "Correct what a key frame of a video is said to show: the description becomes a person's — Claude never rewrites it, even when the pictures are read again — and stays what a source quotes (frame:…, v:from..to). An empty text gives the description back to Claude's next reading.",
    input: z.object({
      doc,
      at: z.string().describe("The key frame's moment, mm:ss or h:mm:ss (or seconds)"),
      text: z.string().describe("What the frame shows; empty to drop the correction"),
      video,
      index,
    }),
    output: z.object({
      anchor: z.string().describe("The key frame's anchor"),
      description: z.string().describe("Its description now"),
      fixed: z.boolean().describe("Whether it is a person's"),
      cited: z.number().describe("Tests citing the document, checked again"),
    }),
    mutates: true,
    positional: ["doc", "at"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      const second = Math.floor(momentIn(input.at, v?.duration ?? 0, f.name));
      const key = v?.keyFrames.find((k) => Math.floor(k.at) === second && k.figure);
      if (!key)
        throw new UserError(
          `${f.name} has no key frame at ${clock(second)}.`,
          `Keep that moment as a key frame first: testimus media keep ${input.doc} ${clock(second)}.`,
        );
      const anchor = frameAnchor(f.n, key.at);
      const fixes = readFixes(project, input.doc, f.n);
      const figures = readFigures(project, input.doc);
      const entry = figures.find((e) => e.anchor === anchor);
      const text = input.text.replace(/\s+/g, " ").trim();
      const was = fixes.frames.find((x) => x.second === second);
      const frames = fixes.frames.filter((x) => x.second !== second);
      if (text)
        frames.push({
          second,
          was: was?.was ?? entry?.description ?? "",
          text,
          by: osUser(),
          at: env.now().toISOString(),
        });
      writeFixes(project, input.doc, f.n, { ...fixes, frames });
      if (entry) {
        entry.description = text || was?.was || entry.description;
        writeFigures(project, input.doc, figures);
      }
      const cited = await afterText(ctx, project, input.doc, input.index);
      return { anchor, description: entry?.description ?? text, fixed: !!text, cited };
    },
  }),
  command({
    name: "media.propose",
    summary:
      "Have Claude propose corrections of a video's transcript — never apply them: each proposal names its clue (the project's glossary, a text visible on the screen at that moment, a document) and waits for a person to accept or refuse it (media.decide).",
    input: z.object({
      doc,
      video,
      model: MODEL.optional().describe("Claude model (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Claude effort (default: medium)"),
      note: NOTE,
    }),
    output: z.object({
      doc: z.string().describe("The document"),
      video: z.number().describe("The video's number"),
      proposals: z.array(PROPOSAL).describe("The corrections proposed, waiting for a decision"),
    }),
    mutates: true,
    job: "media.propose",
    positional: ["doc"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      if (!v?.transcript.length)
        throw new UserError(
          `${f.name} has no transcript.`,
          `Convert the document first: testimus docs convert ${input.doc}.`,
        );
      if (!(await claudeVersion()).ok)
        throw new UserError(
          "Claude is not available on this PC.",
          "Sign in to Claude Code (Settings › Claude Code), then ask again.",
        );
      const figures = new Map(readFigures(project, input.doc).map((e) => [e.anchor, e]));
      const shown = v.keyFrames.map((k) => ({ at: k.at, labels: figures.get(frameAnchor(f.n, k.at))?.labels ?? [] }));
      const lines = transcriptLines(f.n, v, readFixes(project, input.doc, f.n)).map((l) => ({
        ...l,
        screen: [...new Set(shown.filter((s) => Math.abs(s.at - l.at) <= 15).flatMap((s) => s.labels))].slice(0, 12),
      }));
      const r = await proposeFixes(
        project,
        input.doc,
        ctx,
        { name: f.name },
        lines,
        speechGlossary(project).terms,
        runOf(input),
      );
      writeJson(proposalsFile(project, input.doc, f.n), r.proposals);
      return { doc: input.doc, video: f.n, proposals: r.proposals };
    },
  }),
  command({
    name: "media.proposals",
    summary: "The corrections Claude proposed for a video's transcript and nobody decided yet.",
    input: z.object({ doc, video }),
    output: z.object({
      doc: z.string().describe("The document"),
      video: z.number().describe("The video's number"),
      proposals: z.array(PROPOSAL).describe("The corrections waiting for a decision"),
    }),
    mutates: false,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      return { doc: input.doc, video: f.n, proposals: readProposals(project, input.doc, f.n) };
    },
  }),
  command({
    name: "media.decide",
    summary:
      "Accept or refuse a correction Claude proposed: accepted, it becomes a person's correction of that line (media.fix); refused, it goes.",
    input: z.object({
      doc,
      id: z.string().describe("The proposal's id (media.proposals)"),
      accept: z.boolean().describe("true: apply it as a correction; false: drop it"),
      video,
      index,
    }),
    output: fixed,
    mutates: true,
    positional: ["doc", "id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const all = readProposals(project, input.doc, f.n);
      const p = all.find((x) => x.id === input.id);
      if (!p)
        throw new UserError(
          `No proposal ${input.id} for ${f.name}.`,
          `testimus media proposals ${input.doc} lists them.`,
        );
      writeJson(
        proposalsFile(project, input.doc, f.n),
        all.filter((x) => x.id !== input.id),
      );
      if (!input.accept) return { doc: input.doc, video: f.n, cited: 0 };
      if (!ctx.invoke)
        throw new UserError(
          "A proposal is accepted through the app's commands.",
          "Run media.decide from the app or the CLI.",
        );
      return (await ctx.invoke("media.fix", {
        doc: input.doc,
        video: f.n,
        at: String(p.from),
        text: p.text,
        index: input.index,
      })) as z.infer<typeof fixed>;
    },
  }),
  command({
    name: "media.retranscribe",
    summary:
      "Hear a video again with the model, the languages and the glossary of now: only the pieces they change are redone, what people corrected stays theirs, and a report says what it does to the tests citing the video (media.report) — the transcript before is kept until that report is applied.",
    input: z.object({
      doc,
      video,
      all: z.boolean().default(false).describe("Hear every piece again, even those nothing changed for"),
      model: MODEL.optional().describe(
        "Claude model for what follows (translation; default: project.json claude.model)",
      ),
      effort: EFFORT.optional().describe("Claude effort for what follows (default: low)"),
      index,
    }),
    output: z.object({
      doc: z.string().describe("The document"),
      video: z.number().describe("The video's number"),
      lines: z.number().describe("Lines of the new transcript"),
      with: z.string().describe("The model that heard it"),
      report: REPORT.optional().describe("What it does to the tests citing the video; absent when nothing changed"),
      warnings: z.array(z.string()).describe("What could not be done"),
    }),
    mutates: true,
    job: "docs.convert",
    positional: ["doc"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const steps = convertSteps(MEDIA_STEPS, { study: true, index: input.index });
      ctx.steps?.(steps);
      if (input.all)
        rmSync(join(docDir(project, input.doc), "video", String(f.n), "transcript"), { recursive: true, force: true });
      const d = await inSlot(
        ctx,
        project,
        steps,
        async () => {
          ctx.step?.("convert");
          const converted = await convertMedia(ctx, project, input.doc, {
            read: shouldDescribeFigures(project),
            again: true,
            video: f.n,
            run: runOf(input),
          });
          return afterConversion(ctx, project, converted, runOf(input), {
            describeFigures: false,
            study: true,
            index: input.index,
          });
        },
        WEIGHT_MB.video,
      );
      const v = readVideo(project, input.doc, f.n);
      const report = readReport(project, input.doc, f.n);
      return {
        doc: input.doc,
        video: f.n,
        lines: v?.transcript.length ?? 0,
        with: v?.transcribed?.with ?? "",
        ...(report ? { report } : {}),
        warnings: d.converted?.warnings ?? [],
      };
    },
  }),
  command({
    name: "media.report",
    summary:
      "What a new transcription of a video does to the tests that cite it, source by source: holds (same moment, same words), moved (the words are said a little earlier or later: the source follows them when the report is applied) or lost (the words are no longer said: the nearest ones and their moment are given, to hear again).",
    input: z.object({ doc, video }),
    output: z.object({ report: REPORT.nullable().describe("The report, or null when no new transcription waits") }),
    mutates: false,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const v = readVideo(project, input.doc, f.n);
      return { report: v?.before || v?.seenBefore ? buildReport(project, input.doc, f.n) : null };
    },
  }),
  command({
    name: "media.applyReport",
    summary:
      "Apply the report of a new transcription: the sources that moved are rewritten in their tests, the citing tests are checked again (a lost source then shows on its step) and the transcript before is let go. With undo, the transcript before is put back instead.",
    input: z.object({
      doc,
      video,
      undo: z.boolean().default(false).describe("Put the transcript before back instead of keeping the new one"),
      index,
    }),
    output: z.object({
      rewritten: z
        .array(
          z.object({
            test: z.string().describe("The test"),
            from: z.string().describe("The source as it was"),
            to: z.string().describe("The source as it is now"),
          }),
        )
        .describe("Each source rewritten"),
      lost: z.number().describe("Sources whose words are no longer said"),
      undone: z.boolean().describe("True when the transcript before was put back"),
    }),
    mutates: true,
    positional: ["doc"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      const waits = readVideo(project, input.doc, f.n);
      if (!waits?.before && !waits?.seenBefore)
        throw new UserError(
          `No new transcription of ${f.name} waits for its report.`,
          `testimus media retranscribe ${input.doc} makes one.`,
        );
      if (input.undo) {
        undoTranscription(project, input.doc, f.n);
        await afterText(ctx, project, input.doc, input.index);
        return { rewritten: [], lost: 0, undone: true };
      }
      const r = applyReport(project, input.doc, f.n);
      if (input.index) await withIndex(ctx, project, runOf({}));
      return { rewritten: r.rewritten, lost: r.lost, undone: false };
    },
  }),
  command({
    name: "media.glossary",
    summary:
      "The terms given to the transcription so it writes the project's own words right (codes, acronyms, names of equipment): the team's when it wrote them (project.json video.glossary), else taken from the documents; with the sentence the engine really gets, its size against the engine's limit, and the languages heard in the project's videos.",
    input: z.object({}),
    output: z.object({
      terms: z.array(z.string()).describe("Every term given to the engine, most important first"),
      auto: z.boolean().describe("True when they come from the documents (the team wrote none)"),
      prompt: z.string().describe("The sentence given to the engine with every passage"),
      tokens: z.number().describe("Its size, in tokens (estimated)"),
      budget: z.number().describe("The size it may take"),
      heard: z
        .array(
          z.object({
            language: z.string().describe("Language code"),
            seconds: z.number().describe("Seconds of speech heard in it, over the project's videos"),
          }),
        )
        .describe(
          "The languages heard in the videos converted so far, most heard first — what to expect of the next ones",
        ),
      languages: z
        .array(
          z.object({
            code: z.string().describe("Language code"),
            name: z.string().describe("Its name"),
            quality: z.enum(["best", "good"]).describe("How well the engine hears it"),
          }),
        )
        .describe("The languages offered"),
    }),
    mutates: false,
    async run(ctx) {
      const project = projectOf(ctx);
      const g = speechGlossary(project);
      const heard = new Map<string, number>();
      for (const d of listDocs(project).filter(isMediaDoc))
        for (const f of filesOf(d).filter((x) => x.kind === "video"))
          for (const [l, s] of Object.entries(readVideo(project, d.id, f.n)?.transcribed?.languages ?? {}))
            heard.set(l, (heard.get(l) ?? 0) + s);
      return {
        terms: g.terms,
        auto: g.auto,
        prompt: g.prompt,
        tokens: g.tokens,
        budget: g.budget,
        heard: [...heard.entries()]
          .map(([language, seconds]) => ({ language, seconds }))
          .sort((a, b) => b.seconds - a.seconds),
        languages: SPOKEN_LANGUAGES,
      };
    },
  }),
  command({
    name: "media.suggestGlossary",
    summary:
      "Have Claude write the glossary of the transcription from the project's documents (the words the engine cannot guess, most important first, as many as the engine reads) and save it as the team's list (project.json video.glossary); project set --video.glossary=null goes back to the terms counted in the documents.",
    input: z.object({
      ask: z.string().default("").describe("What the team wants of the glossary, in words; empty = the best one"),
      model: MODEL.optional().describe("Claude model (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Claude effort (default: medium)"),
      note: NOTE,
    }),
    output: z.object({
      ok: z.boolean().describe("false when the run failed or gave no term: nothing was saved"),
      terms: z.array(z.string()).describe("The glossary saved, every term sent to the engine"),
      summary: z.string().describe("Claude's reply"),
      costUsd: z.number().optional().describe("What the Claude run cost"),
    }),
    mutates: true,
    job: "media.glossary",
    positional: ["ask"],
    subject: (i) => i.ask.slice(0, 60) || "The glossary of the transcription",
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!(await claudeVersion()).ok)
        throw new UserError(
          "Claude is not available on this PC.",
          "Sign in to Claude Code (Settings › Claude Code), then ask again.",
        );
      const r = await draftGlossary(project, ctx, input.ask, runOf(input));
      if (r.ok) {
        const p = readProject(project);
        writeProject(project, { ...p, video: { ...p.video, glossary: r.terms } });
      } else ctx.log("warn", `Claude gave no glossary: ${r.summary.slice(0, 200)}`);
      return r;
    },
  }),
  command({
    name: "media.estimate",
    summary:
      "What a video will cost before it is imported, or before it is converted: its length and weight, how long this PC takes to hear it and to look through it (from what its last transcriptions measured here), Claude's share (runs, pictures) and the room it takes.",
    input: z.object({
      file: z.string().optional().describe("A video file on this PC, not imported yet"),
      doc: z.string().optional().describe("Or a video document of the project"),
      video,
    }),
    output: z.object({
      duration: z.number().describe("Length, seconds"),
      bytes: z.number().describe("Weight, bytes"),
      audio: z.boolean().describe("Whether it has sound"),
      tracks: z.number().describe("Sound tracks"),
      model: z.string().optional().describe("The model that will hear it"),
      missing: z
        .enum(["engine", "model"])
        .optional()
        .describe("What is not on this PC: without it there is no transcript"),
      device: z.enum(["gpu", "cpu"]).describe("Where it will be heard"),
      speechSeconds: z.number().describe("Time to hear it on this PC, seconds"),
      measured: z
        .boolean()
        .describe("True when that time comes from transcriptions made on this PC, false when it is a guess"),
      withCardSeconds: z
        .number()
        .optional()
        .describe("Time to hear it with this PC's NVIDIA card, once the engine's card build is installed"),
      framesSeconds: z.number().describe("Time to look through its pictures, seconds"),
      seconds: z.number().describe("Time of the whole conversion on this PC, Claude's runs apart"),
      claude: z
        .object({
          runs: z.number().describe("Claude runs, about"),
          images: z.number().describe("Pictures Claude reads, about"),
        })
        .describe("Claude's share"),
      long: z.boolean().describe("Longer than two hours: a part can be transcribed instead (media.set from, to)"),
      disk: z
        .object({
          needMB: z.number().describe("Room the video and what is drawn from it take, MB"),
          freeMB: z.number().nullable().describe("Room free on the project's drive, MB"),
          usedMB: z.number().describe("Room the project's videos take today, MB"),
          capMB: z.number().optional().describe("The cap the team set for them (project.json video.diskCapGB), MB"),
          over: z.boolean().describe("True when this video would pass the cap: it would be refused"),
        })
        .describe("Disk space"),
    }),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const machine = await machineProfile().catch(() => null);
      const p = readProject(project);
      const claude = (await claudeVersion()).ok && p.rag.describeFigures !== false;
      const used = { usedMB: videosMB(project), capMB: capMB(project), here: !!input.doc };
      const o = { density: p.video?.density, claude, folder: join(project, "docs"), used };
      if (input.doc) {
        const f = videoOf(project, input.doc, input.video);
        const v = readVideo(project, input.doc, f.n);
        const src = join(docDir(project, input.doc), f.file);
        const probe = v
          ? {
              duration: v.duration,
              bytes: v.bytes ?? 0,
              audio: v.audio,
              tracks: v.tracks?.length ?? (v.audio ? 1 : 0),
              picture: !v.sound,
            }
          : await videoIo.probe(src, ctx.signal).then((x) => ({ ...x, tracks: x.tracks.length }));
        const part = f.range ? Math.max(0, Math.min(probe.duration, f.range.to) - f.range.from) : probe.duration;
        const e = estimateOf({ ...probe, duration: probe.duration }, machine, o);
        const ratio = probe.duration ? part / probe.duration : 1;
        return {
          ...e,
          speechSeconds: Math.round(e.speechSeconds * ratio),
          seconds: Math.round(e.speechSeconds * ratio) + e.framesSeconds,
        };
      }
      if (!input.file || !existsSync(input.file))
        throw new UserError(
          "Give a video file of this PC, or a video document.",
          "testimus media estimate --file <path>, or --doc <id>.",
        );
      const probe = await videoIo.probe(input.file, ctx.signal);
      return estimateOf({ ...probe, tracks: probe.tracks.length }, machine, o);
    },
  }),
  command({
    name: "media.lighten",
    summary:
      "Make a lighter copy of a video for the page (H.264 720p, a key frame every 2 s): for an original the page cannot play (an iPhone's HEVC on a PC whose card does not decode it) or moves badly in. The original stays the source of every frame.",
    input: z.object({
      doc,
      video,
      why: z.string().default("the page could not play the original").describe("Why it is made, kept with it"),
    }),
    output: z.object({ file: z.string().describe("The copy, relative to the document folder") }),
    mutates: true,
    job: "media.lighten",
    positional: ["doc"],
    subject: (i) => i.doc,
    label: (i, project) => docName(project, i.doc),
    async run(ctx, input) {
      const project = projectOf(ctx);
      const f = videoOf(project, input.doc, input.video);
      mediaDoc(project, input.doc);
      return { file: await lighten(ctx, project, input.doc, f, input.why) };
    },
  }),
];
