import type { Ctx } from "../command.ts";
import { readDoc, readFigures, writeFigures } from "../lib/docs.ts";
import { filesOf, imageAnchor, ordered, updateFiles } from "../lib/media.ts";
import { readProject } from "../lib/project.ts";
import { clock, momentOf } from "../rag/anchors.ts";
import type { DocJson, FigureEntry } from "../types.ts";
import { type Described, described, FIGURES_BATCH, parseEntries } from "./figures.ts";
import { docGiven, GIVEN_SLOT } from "./given.ts";
import { languageName } from "./language.ts";
import type { JobRun, PromptTemplate } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const MEDIA_MARKER = "Testimus media run";
export const MEDIA_TAG = "media";
export const SURVEY_MARKER = "Testimus video survey run";
export const SURVEY_TAG = "video";
export const MAX_MOMENTS = 40;
const TRANSCRIPT_CHARS = 6000;

export type PictureTodo = { anchor: string; file: string; name: string; takenAt?: string };
export type ReadResult = { read: number; missing: string[]; runIds: string[]; costUsd: number };
export type Survey = { chapters: { at: number; title: string }[]; moments: { at: number; why: string }[] };

const slash = (p: string) => p.replace(/\\/g, "/");
const named = (doc: Pick<DocJson, "id" | "code" | "title">) => `${doc.code || doc.id} ${doc.title}`.trim();

export function picturesPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  todo: PictureTodo[],
  language: string,
  extra: string[] = [],
): string {
  return [
    `${MEDIA_MARKER} for the document ${named(doc)}.`,
    "",
    "These pictures show the real system (screens of the simulator, a desk, a cabin): photos taken by the team, or",
    "frames of a video they filmed. They show what the system does and how a tester gets there — never what it is",
    "required to do: say what you see, never what should happen.",
    "",
    "Open each picture below with Read, look at it, and give:",
    `- description: two to four sentences in ${languageName(language)} for a tester: which screen or object it is,`,
    "  what state it shows, where things are and what the operator does or can do there.",
    "- labels: every text visible in the picture, copied verbatim (same spelling, accents, case, abbreviations; never",
    "  translated or corrected), one entry per title, button, menu item, field or message; [] when none is readable.",
    "- kind: one of screen, diagram, symbol, table-image, photo (screen = a software window, photo = anything else).",
    "Do not edit any file.",
    ...extra,
    "",
    "Pictures:",
    ...todo.map(
      (p) =>
        `- ${p.anchor} — docs/${slash(doc.id)}/${slash(p.file)} — ${p.name}${p.takenAt ? ` — taken ${p.takenAt.replace("T", " ").slice(0, 16)}` : ""}`,
    ),
    "",
    "Reply with only this block, one entry per picture, keyed by its anchor:",
    "```" + MEDIA_TAG,
    `{${todo
      .slice(0, 2)
      .map((p) => `"${p.anchor}": {"description": "…", "labels": ["…"], "kind": "screen"}`)
      .join(", ")}}`,
    "```",
    "",
  ].join("\n");
}

export function surveyPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  video: { name: string; duration: number },
  mosaics: { file: string; tiles: { n: number; at: number }[] }[],
  transcript: string,
  language: string,
  extra: string[] = [],
): string {
  return [
    `${SURVEY_MARKER} for the video « ${video.name} » (${clock(video.duration)}) of the document ${named(doc)}.`,
    "",
    "The video was filmed on the real system: it shows what the system does and how an operator works, never what it",
    "is required to do. Open each mosaic below with Read: it shows the video's frames in time order, 4 × 4, each tile",
    "numbered with its moment. Then give, in " + languageName(language) + ":",
    "- chapters: the parts of the video, each with the moment it starts (mm:ss) and a short title saying what the",
    "  operator does there; the first starts at 00:00.",
    `- moments: at most ${MAX_MOMENTS} moments worth seeing whole (a screen that changes, a menu, a message, an alarm),`,
    "  each with its moment (mm:ss, one of the tiles' or between them) and why in a few words.",
    "Do not edit any file.",
    ...extra,
    "",
    "Mosaics:",
    ...mosaics.map(
      (m) =>
        `- docs/${slash(doc.id)}/${slash(m.file)} — tiles ${m.tiles.map((t) => `${t.n} ${clock(t.at)}`).join(", ")}`,
    ),
    "",
    ...(transcript
      ? ["What is said (Whisper's transcript, timed):", transcript, ""]
      : ["The video has no speech.", ""]),
    "Reply with only this block:",
    "```" + SURVEY_TAG,
    '{"chapters": [{"at": "00:00", "title": "…"}], "moments": [{"at": "00:42", "why": "…"}]}',
    "```",
    "",
  ].join("\n");
}

const DOC = { id: "{docId}", code: "{document}", title: "{title}" };

export const prompts: PromptTemplate[] = [
  {
    id: "media",
    name: "Read the pictures of an images or video document",
    group: "Documents",
    kind: "media",
    usedBy: ["Documents: add images or a video", "Documents › Images: Add images…", "docs.convert", "media.add"],
    answers: "A description, the visible labels and a kind for each picture, in the block that ends the reply",
    text: () =>
      picturesPrompt(
        DOC,
        [{ anchor: "{anchor}", file: "{picture file}", name: "{file name}", takenAt: "{date}" }],
        "{language}",
        GIVEN_SLOT,
      ),
  },
  {
    id: "video-survey",
    name: "Survey a video: chapters and moments to see",
    group: "Documents",
    kind: "media",
    usedBy: ["Documents: add a video", "docs.convert", "media.add"],
    answers: "The chapters of the video and the moments worth seeing, in the block that ends the reply",
    text: () =>
      surveyPrompt(
        DOC,
        { name: "{video}", duration: 0 },
        [{ file: "{mosaic}", tiles: [{ n: 1, at: 0 }] }],
        "{transcript}",
        "{language}",
        GIVEN_SLOT,
      ),
  },
];

const pictureKey = (k: string) =>
  k.trim().replace(/^(img|frame)\s*:?\s*/i, (_m, kind: string) => `${kind.toLowerCase()}:`);

export function parsePictures(text: string): Record<string, Described> {
  return parseEntries(text, MEDIA_TAG, pictureKey, described);
}

const atOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v !== "string") return null;
  return momentOf(v.trim())?.at ?? null;
};

export function parseSurvey(text: string): Survey | null {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const bodies = [...blocks.filter((b) => b[1] === SURVEY_TAG), ...blocks.filter((b) => b[1] !== SURVEY_TAG)].map(
    (b) => b[2],
  );
  const bare = text.match(/\{[\s\S]*\}/)?.[0];
  if (bare) bodies.push(bare);
  for (const body of bodies)
    try {
      const o = JSON.parse(body) as { chapters?: unknown[]; moments?: unknown[] };
      const chapters = (o.chapters ?? []).flatMap((c) => {
        const x = c as { at?: unknown; title?: unknown };
        const at = atOf(x.at);
        return at !== null && typeof x.title === "string" && x.title.trim() ? [{ at, title: x.title.trim() }] : [];
      });
      const moments = (o.moments ?? []).flatMap((c) => {
        const x = c as { at?: unknown; why?: unknown };
        const at = atOf(x.at);
        return at !== null ? [{ at, why: typeof x.why === "string" ? x.why.trim() : "" }] : [];
      });
      if (chapters.length || moments.length)
        return {
          chapters: chapters.sort((a, b) => a.at - b.at),
          moments: moments.sort((a, b) => a.at - b.at).slice(0, MAX_MOMENTS),
        };
    } catch {}
  return null;
}

// ponytail: Claude reads the pictures of a document 20 at a time — its images (img:<n>) and its videos' key frames
// (frame:…) not read yet, those asked for, or all with force; what it read is saved after every run, so a long reading
// cut short keeps it
export async function readPictures(
  project: string,
  docId: string,
  ctx: Ctx,
  opts: { anchors?: string[]; force?: boolean } & JobRun = {},
): Promise<ReadResult> {
  const doc = readDoc(project, docId);
  const figures = readFigures(project, docId);
  const byFile = new Map(filesOf(doc).map((f) => [imageAnchor(f.n), f]));
  const todo: PictureTodo[] = [
    ...ordered(filesOf(doc).filter((f) => f.kind === "image" && f.figure && f.state !== "failed")).map((f) => ({
      anchor: imageAnchor(f.n),
      file: f.figure as string,
      name: f.name,
      ...(f.takenAt ? { takenAt: f.takenAt } : {}),
    })),
    ...figures
      .filter((f) => f.anchor.startsWith("frame:") && f.file)
      .map((f) => ({ anchor: f.anchor, file: f.file, name: f.caption })),
  ].filter((t) => {
    if (opts.anchors) return opts.anchors.includes(t.anchor);
    if (opts.force) return true;
    return !figures.find((f) => f.anchor === t.anchor)?.description.trim();
  });
  const res: ReadResult = { read: 0, missing: [], runIds: [], costUsd: 0 };
  if (!todo.length) return res;
  const p = readProject(project);
  const got = new Set<string>();
  const g = docGiven(project, "media", docId, opts);
  for (let i = 0; i < todo.length; i += FIGURES_BATCH) {
    if (ctx.signal.aborted) break;
    const batch = todo.slice(i, i + FIGURES_BATCH);
    ctx.progress({ message: `Claude reads the pictures of ${doc.title || doc.id}`, done: i, total: todo.length });
    const run = await runClaude({
      project,
      prompt: picturesPrompt(doc, batch, p.language, g.lines),
      given: g,
      model: opts.model || p.claude.model,
      effort: opts.effort || "low",
      kind: "media",
      label: `Pictures of ${doc.title || doc.id}`,
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    res.runIds.push(run.runId);
    res.costUsd += run.costUsd ?? 0;
    if (!run.ok) {
      ctx.log("warn", `Pictures of ${doc.title || doc.id}: ${run.summary}`);
      continue;
    }
    const parsed = parsePictures(run.summary);
    const here = batch.filter((t) => parsed[t.anchor]);
    if (!here.length) continue;
    const now: FigureEntry[] = readFigures(project, docId);
    for (const t of here) {
      got.add(t.anchor);
      const r = parsed[t.anchor];
      const at = now.findIndex((f) => f.anchor === t.anchor);
      if (at < 0) continue;
      now[at] = {
        ...now[at],
        description: r.description,
        ...(r.labels ? { labels: r.labels } : {}),
        ...(r.kind ? { kind: r.kind } : {}),
      };
    }
    writeFigures(project, docId, now);
    updateFiles(project, docId, (files) => {
      for (const f of files) if (got.has(imageAnchor(f.n)) && byFile.has(imageAnchor(f.n))) f.state = "analysed";
    });
  }
  res.missing = todo.filter((t) => !got.has(t.anchor)).map((t) => t.anchor);
  res.read = todo.length - res.missing.length;
  if (res.missing.length) ctx.log("warn", `${doc.title || doc.id}: Claude read nothing for ${res.missing.join(", ")}.`);
  return res;
}

// ponytail: one run surveys a video from its mosaics (and what is said) — chapters and the moments worth seeing whole
export async function surveyVideo(
  project: string,
  docId: string,
  ctx: Ctx,
  video: { name: string; duration: number },
  mosaics: { file: string; tiles: { n: number; at: number }[] }[],
  transcript: string,
  opts: JobRun = {},
): Promise<{ survey: Survey | null; runId: string; costUsd: number }> {
  const doc = readDoc(project, docId);
  const p = readProject(project);
  ctx.progress({ message: `Claude surveys ${video.name}` });
  const text = transcript.length > TRANSCRIPT_CHARS ? `${transcript.slice(0, TRANSCRIPT_CHARS)}\n…` : transcript;
  const g = docGiven(project, "media", docId, opts);
  const run = await runClaude({
    project,
    prompt: surveyPrompt(doc, video, mosaics, text, p.language, g.lines),
    given: g,
    model: opts.model || p.claude.model,
    effort: opts.effort || "low",
    kind: "media",
    label: `Survey of ${video.name}`,
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  if (!run.ok) ctx.log("warn", `Survey of ${video.name}: ${run.summary}`);
  return { survey: run.ok ? parseSurvey(run.summary) : null, runId: run.runId, costUsd: run.costUsd ?? 0 };
}
