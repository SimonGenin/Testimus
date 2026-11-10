import { z } from "zod";
import type { Ctx } from "../command.ts";
import { readDoc, readFigures, writeFigures } from "../lib/docs.ts";
import { filesOf, imageAnchor, ordered, updateFiles } from "../lib/media.ts";
import { readProject } from "../lib/project.ts";
import { spokenName } from "../lib/video/passages.ts";
import { rememberSeen } from "../lib/video/report.ts";
import { clock, momentOf } from "../rag/anchors.ts";
import type { DocJson, FigureEntry, FixProposal, SpokenLine } from "../types.ts";
import { type Described, described, FIGURES_BATCH, parseEntries } from "./figures.ts";
import { docGiven, GIVEN_SLOT } from "./given.ts";
import { languageName } from "./language.ts";
import { readBlock } from "./parts.ts";
import type { JobRun, PromptTemplate } from "./prompt.ts";
import { runClaude } from "./run.ts";

export const MEDIA_MARKER = "Testimus media run";
export const MEDIA_TAG = "media";
export const PLAN_MARKER = "Testimus video plan run";
export const SURVEY_MARKER = "Testimus video survey run";
export const SURVEY_TAG = "video";
export const CHAPTERS_TAG = "chapters";
export const TRANSLATE_MARKER = "Testimus video translation run";
export const TRANSLATE_TAG = "translation";
export const FIXES_MARKER = "Testimus transcript fixes run";
export const FIXES_TAG = "fixes";
export const FRAME_CALLS = 10;
const TRANSLATE_BATCH = 150;
const FIXES_LINES = 400;

export type PictureTodo = { anchor: string; file: string; name: string; takenAt?: string; context?: string[] };
export type ReadResult = { read: number; missing: string[]; runIds: string[]; costUsd: number };
export type Survey = { chapters: { at: number; title: string }[]; moments: { at: number; why: string }[] };
export type Mosaic = { file: string; tiles: { n: number; at: number }[] };
export type Crop = { n: number; at: number; file: string };
export type VideoRef = { name: string; duration: number; n: number };

const slash = (p: string) => p.replace(/\\/g, "/");
const named = (doc: Pick<DocJson, "id" | "code" | "title">) => `${doc.code || doc.id} ${doc.title}`.trim();

export function picturesPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  todo: PictureTodo[],
  language: string,
  extra: string[] = [],
): string {
  const frames = todo.some((p) => p.anchor.startsWith("frame:"));
  return [
    `${MEDIA_MARKER} for the document ${named(doc)}.`,
    "",
    "These pictures show the real system (screens of the simulator, a desk, a cabin): photos taken by the team, or",
    "frames of a video they filmed. They show what the system does and how a tester gets there — never what it is",
    "required to do: say what you see, never what should happen.",
    "",
    "Open the pictures below with Read — all of them in the same turn, one call each, sent together — look at each,",
    "and give:",
    `- description: two to four sentences in ${languageName(language)} for a tester: which screen or object it is,`,
    "  what state it shows, where things are and what the operator does or can do there.",
    "- labels: every text visible in the picture, copied verbatim (same spelling, accents, case, abbreviations; never",
    "  translated or corrected), one entry per title, button, menu item, field or message; [] when none is readable.",
    "- kind: one of screen, diagram, symbol, table-image, photo (screen = a software window, photo = anything else).",
    ...(frames
      ? [
          "A frame of a video comes with what is said around it and the part of the video it belongs to: use them to",
          "name what the operator is doing. The frames are in time order: from the second one on, start the",
          "description with what changed since the frame before it (« The disconnector S12 goes from closed to open,",
          "its indicator turns red »), in plain sentences a test step can quote. Never copy what is said into the",
          "description: describe the picture.",
        ]
      : []),
    "Do not edit any file.",
    ...extra,
    "",
    "Pictures:",
    ...todo.flatMap((p) => [
      `- ${p.anchor} — docs/${slash(doc.id)}/${slash(p.file)} — ${p.name}${p.takenAt ? ` — taken ${p.takenAt.replace("T", " ").slice(0, 16)}` : ""}`,
      ...(p.context ?? []).map((c) => `    ${c}`),
    ]),
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

const mosaicLines = (doc: Pick<DocJson, "id">, mosaics: Mosaic[]) =>
  mosaics.map(
    (m) => `- docs/${slash(doc.id)}/${slash(m.file)} — tiles ${m.tiles.map((t) => `${t.n} ${clock(t.at)}`).join(", ")}`,
  );

// ponytail: the first level — the whole video from far: all that is said (a file to Read, two hours of speech are
// some 35 000 tokens) and a few frames spread along it. It gives the chapters; the frames worth keeping are chosen
// chapter by chapter, where they can be looked at
export function planPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  video: VideoRef,
  o: { said?: string; text?: string; mosaics: Mosaic[] },
  language: string,
  extra: string[] = [],
): string {
  return [
    `${PLAN_MARKER} for the video « ${video.name} » (${clock(video.duration)}) of the document ${named(doc)}.`,
    "",
    "The video was filmed on the real system: it shows what the system does and how an operator works, never what it",
    "is required to do. Cut it into chapters: the parts a tester would look for, each with the moment it starts",
    `(mm:ss) and a short title in ${languageName(language)} saying what the operator does there. The first starts at`,
    "00:00; a five-minute video has three to six chapters, a long one a chapter every few minutes.",
    ...(o.text
      ? []
      : o.said
        ? [
            "",
            `What is said, timed, is in docs/${slash(doc.id)}/${slash(o.said)} — Read it whole (each line starts with`,
            "its moment; a line in another language is followed by its language in brackets).",
          ]
        : ["", "The video has no speech."]),
    ...(o.mosaics.length
      ? [
          "",
          "A few frames spread along the video, 3 × 3, each tile numbered with its moment — open them with Read, all",
          "in the same turn, to see where the screen changes:",
          ...mosaicLines(doc, o.mosaics),
        ]
      : []),
    "Do not edit any file.",
    ...extra,
    ...(o.text
      ? [
          "",
          "What is said (each line starts with its moment; a line in another language is followed by its language in",
          "brackets):",
          o.text,
        ]
      : []),
    "",
    "Reply with only this block:",
    "```" + SURVEY_TAG,
    '{"chapters": [{"at": "00:00", "title": "…"}]}',
    "```",
    "",
  ].join("\n");
}

export type SurveyPart = {
  title: string;
  from: number;
  to: number;
  budget: number;
  said: string;
  /** the part is the whole video, not cut into chapters yet: the run gives them too */
  chapters?: boolean;
  /** the last moments kept in the part before this one: a screen kept is not kept again */
  kept?: { at: number; why: string }[];
};

// ponytail: the second level — one part of the video up close: its candidate frames in mosaics (to see that something
// happens, and where: a red frame marks the place that changed), the place that changed at its real size (to read
// it), and the right to draw any moment whole with media.frame, a few times. A short video is one part, and the same
// run cuts it into chapters. Every picture is opened in the same turn: a turn each sends the whole conversation again
// (measured 2026-11-10 on a 2-minute video: 7 runs and 0.8 M input tokens, against 1 run)
export function surveyPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  video: VideoRef,
  part: SurveyPart,
  o: { mosaics: Mosaic[]; crops: Crop[] },
  language: string,
  extra: string[] = [],
): string {
  const here = part.chapters ? "the video" : "this part";
  return [
    `${SURVEY_MARKER} for the video « ${video.name} » (${clock(video.duration)}) of the document ${named(doc)}.`,
    "",
    part.chapters
      ? "To survey: the whole video."
      : `Part to survey: « ${part.title} », from ${clock(part.from)} to ${clock(part.to)}.`,
    "",
    "The video was filmed on the real system: it shows what the system does and how an operator works, never what it",
    "is required to do. Open the mosaics below with Read, all in the same turn (one call each, sent together): they",
    `show the candidate frames of ${here} in time order, 3 × 3, each tile numbered with its moment; a red frame marks`,
    "where the screen changed since the tile before. A mosaic shows that something happens, not what a screen says:",
    "to read it, open the changes you need (the place that changed, at the size it was filmed), again in one turn," +
      ` or draw a moment whole with the tool media_frame (doc ${doc.id}, video ${video.n}, at mm:ss) —`,
    `at most ${FRAME_CALLS} times, only where a mosaic and its change leave a doubt.`,
    "",
    `Give the moments of ${here} worth keeping whole as key frames — at most ${part.budget}, fewer when little`,
    "changes: a screen once it has settled after a change, a menu open, a message or an alarm, the state of a form",
    "just before it is validated. Each with its moment (mm:ss, a tile's or between two) and why in at most ten words",
    `of ${languageName(language)}. A screen already kept is not kept again: skip a frame that shows nothing new.`,
    ...(part.chapters
      ? [
          "Cut the video into chapters too: the parts a tester would look for, each with the moment it starts (mm:ss)",
          `and a short title in ${languageName(language)} saying what the operator does there. The first starts at`,
          "00:00; about one chapter a minute and never more than six for five minutes — a two-minute video has two or",
          "three.",
        ]
      : []),
    "Do not edit any file.",
    ...extra,
    ...(part.kept?.length
      ? ["", "Kept just before this part:", ...part.kept.map((k) => `- ${clock(k.at)} — ${k.why || "a key frame"}`)]
      : []),
    "",
    "Mosaics:",
    ...mosaicLines(doc, o.mosaics),
    ...(o.crops.length
      ? [
          "",
          // ponytail: one line, not one per tile — every tile shown whose place changed has its crop on disk, named
          // by the tile, and a line each was fifty-four lines of paths in a run measured for its tokens
          `Changes, at real size — the change of tile n is docs/${slash(doc.id)}/video/${video.n}/change-<n>.jpg, for tiles ${o.crops.map((c) => c.n).join(", ")}.`,
        ]
      : []),
    "",
    ...(part.said ? [`What is said in ${here} (timed):`, part.said, ""] : [`Nothing is said in ${here}.`, ""]),
    ...(part.chapters
      ? [
          "Reply with only these two blocks, the chapters then the moments:",
          "```" + CHAPTERS_TAG,
          '[{"at": "00:00", "title": "…"}]',
          "```",
        ]
      : ["Reply with only this block:"]),
    "```" + SURVEY_TAG,
    '{"moments": [{"at": "00:42", "why": "…"}]}',
    "```",
    "",
  ].join("\n");
}

export type ToTranslate = { key: string; lang: string; text: string; around?: string[] };

// ponytail: what was said in another language than the project's is translated by Claude, never by Whisper (whose
// translation only goes to English, and which turbo does not do). The original stays the quotable text; the
// translation is shown and searched beside it
export function translatePrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  video: Pick<VideoRef, "name">,
  lines: ToTranslate[],
  language: string,
  extra: string[] = [],
): string {
  return [
    `${TRANSLATE_MARKER} for the video « ${video.name} » of the document ${named(doc)}.`,
    "",
    `Translate each line below into ${languageName(language)}. They are what an operator or a trainer says in a`,
    "video of the real system, as a speech model heard it: translate what is said, plainly, keep every code, name of",
    "equipment, label of the screen and number as it is, and never add nor explain. A line that is only noise or",
    "makes no sense gets an empty string. Under a line is what was said just before and after it: never translate",
    "that — it tells what the speakers talk about, so a word the speech model misheard is translated as the word",
    "that was meant. Do not edit any file.",
    ...extra,
    "",
    "Lines (moment · language · what was said):",
    ...lines.flatMap((l) => [
      `- ${l.key} · ${spokenName(l.lang)} · ${l.text}`,
      ...(l.around ?? []).map((a) => `    ${a}`),
    ]),
    "",
    "Reply with only this block, one entry per line, keyed by its moment:",
    "```" + TRANSLATE_TAG,
    `{${lines
      .slice(0, 2)
      .map((l) => `"${l.key}": "…"`)
      .join(", ")}}`,
    "```",
    "",
  ].join("\n");
}

export type FixLine = { key: string; lang?: string; text: string; unsure: boolean; screen: string[] };

// ponytail: Claude may propose a correction of a line, never apply it — a person listens to the five seconds and
// accepts or refuses. Each proposal shows the clue it rests on: the glossary (« section heure » sounds like
// « sectionneur »), a text visible on the screen at that moment, or a document of the project
export function fixesPrompt(
  doc: Pick<DocJson, "id" | "code" | "title">,
  video: Pick<VideoRef, "name">,
  lines: FixLine[],
  glossary: string[],
  extra: string[] = [],
): string {
  return [
    `${FIXES_MARKER} for the video « ${video.name} » of the document ${named(doc)}.`,
    "",
    "Below is what a speech model heard in a video of the real system. It mishears the project's own words: codes,",
    "names of equipment, acronyms. Propose a correction only for a line where you have a clue that another word was",
    "said, and say which clue:",
    "- glossary: a term of the project's glossary sounds like what was written;",
    "- screen: a text visible on the screen at that moment (given under the line) is the word that was said;",
    "- document: another document of the project names the thing — find it with Grep in docs/*/doc.md before you",
    `  propose, and name it. Never docs/${slash(doc.id)}/ itself: its text comes from this video.`,

    "Never rewrite a line to make it nicer, never fix punctuation or case, never translate; keep every other word as",
    "it was heard. No clue, no proposal. A line marked « unsure » is one the model itself doubted. Do not edit any",
    "file.",
    ...extra,
    "",
    `Glossary: ${glossary.length ? glossary.join(", ") : "(none)"}`,
    "",
    "Lines (moment · what was heard):",
    ...lines.flatMap((l) => [
      `- ${l.key}${l.unsure ? " · unsure" : ""} · ${l.text}`,
      ...(l.screen.length ? [`    on screen: ${l.screen.join(" · ")}`] : []),
    ]),
    "",
    "Reply with only this block ([] when nothing is to correct):",
    "```" + FIXES_TAG,
    '[{"at": "00:42", "text": "the line as it should read", "clue": "glossary", "why": "…"}]',
    "```",
    "",
  ].join("\n");
}

const DOC = { id: "{docId}", code: "{document}", title: "{title}" };
const VIDEO = { name: "{video}", duration: 0, n: 1 };

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
        [
          {
            anchor: "frame:{moment}",
            file: "{picture file}",
            name: "{file name}",
            takenAt: "{date}",
            context: ["part: {chapter}", "said around it: {lines}", "the frame before it: {description}"],
          },
        ],
        "{language}",
        GIVEN_SLOT,
      ),
  },
  {
    id: "video-plan",
    name: "Plan a video: its chapters",
    group: "Documents",
    kind: "media",
    usedBy: ["Documents: add a video", "docs.convert", "media.add"],
    answers: "The chapters of the video, in the block that ends the reply",
    text: () =>
      planPrompt(
        DOC,
        VIDEO,
        { said: "{transcript file}", mosaics: [{ file: "{mosaic}", tiles: [{ n: 1, at: 0 }] }] },
        "{language}",
        GIVEN_SLOT,
      ),
  },
  {
    id: "video-survey",
    name: "Survey a part of a video: the moments to keep",
    group: "Documents",
    kind: "media",
    usedBy: ["Documents: add a video", "docs.convert", "media.add"],
    answers: "The moments of the part worth keeping as key frames, in the block that ends the reply",
    text: () =>
      surveyPrompt(
        DOC,
        VIDEO,
        { title: "{chapter}", from: 0, to: 0, budget: 8, said: "{lines}" },
        {
          mosaics: [{ file: "{mosaic}", tiles: [{ n: 1, at: 0 }] }],
          crops: [{ n: 1, at: 0, file: "{change}" }],
        },
        "{language}",
        GIVEN_SLOT,
      ),
  },
  {
    id: "video-translate",
    name: "Translate what is said in another language",
    group: "Documents",
    kind: "media",
    usedBy: ["Documents: add a video", "docs.convert", "media.translate"],
    answers: "The translation of each line, in the block that ends the reply",
    text: () =>
      translatePrompt(
        DOC,
        VIDEO,
        [{ key: "{moment}", lang: "{language said}", text: "{line}", around: ["before: {line}", "after: {line}"] }],

        "{language}",
        GIVEN_SLOT,
      ),
  },
  {
    id: "video-fixes",
    name: "Propose corrections of a transcript",
    group: "Documents",
    kind: "media",
    usedBy: ["Documents › Video: Propose corrections", "media.propose"],
    answers: "The corrections proposed, each with its clue, in the block that ends the reply",
    text: () =>
      fixesPrompt(
        DOC,
        VIDEO,
        [{ key: "{moment}", text: "{line}", unsure: true, screen: ["{text on screen}"] }],
        ["{term}"],
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

const MOMENT = z.union([z.string(), z.number()]);
const SURVEY = z.object({
  chapters: z.array(z.object({ at: MOMENT, title: z.string() }).passthrough()).optional(),
  moments: z.array(z.object({ at: MOMENT, why: z.string().optional() }).passthrough()).optional(),
});

export function parseSurvey(text: string, most = Number.POSITIVE_INFINITY): Survey | null {
  const b = readBlock(text, SURVEY_TAG, SURVEY);
  if (!b.value) return null;
  const chapters = (b.value.chapters ?? []).flatMap((c) => {
    const at = atOf(c.at);
    return at !== null && c.title.trim() ? [{ at, title: c.title.trim() }] : [];
  });
  const moments = (b.value.moments ?? []).flatMap((c) => {
    const at = atOf(c.at);
    return at !== null ? [{ at, why: (c.why ?? "").trim() }] : [];
  });
  if (!chapters.length && !moments.length) return null;
  return {
    chapters: chapters.sort((a, b2) => a.at - b2.at),
    moments: moments.sort((a, b2) => a.at - b2.at).slice(0, most),
  };
}

// ponytail: the chapters a survey of a whole video gives come in a block of their own — one object holding both lists
// was closed a brace too early by Opus (2026-11-10), and the whole answer was lost with it
export function parseChapters(text: string): Survey["chapters"] | null {
  const b = readBlock(text, CHAPTERS_TAG, z.array(z.object({ at: MOMENT, title: z.string() }).passthrough()));
  const chapters = (b.value ?? []).flatMap((c) => {
    const at = atOf(c.at);
    return at !== null && c.title.trim() ? [{ at, title: c.title.trim() }] : [];
  });
  return chapters.length ? chapters.sort((a, b2) => a.at - b2.at) : null;
}

// ponytail: Claude reads the pictures of a document 20 at a time — its images (img:<n>) and its videos' key frames
// (frame:…) not read yet, those asked for, or all with force; what it read is saved after every run, so a long reading
// cut short keeps it. A key frame is read with what is said around it, its chapter and the frame before it (context),
// and one a person corrected is never read again (kept)
export async function readPictures(
  project: string,
  docId: string,
  ctx: Ctx,
  opts: {
    anchors?: string[];
    force?: boolean;
    context?: (anchor: string, before: string | undefined) => string[];
    kept?: Set<string>;
  } & JobRun = {},
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
    if (opts.kept?.has(t.anchor)) return false;
    if (opts.anchors) return opts.anchors.includes(t.anchor);
    if (opts.force) return true;
    return !figures.find((f) => f.anchor === t.anchor)?.description.trim();
  });
  const res: ReadResult = { read: 0, missing: [], runIds: [], costUsd: 0 };
  if (!todo.length) return res;
  const p = readProject(project);
  const got = new Set<string>();
  const g = docGiven(project, "media", docId, opts);
  const order = figures.filter((f) => f.anchor.startsWith("frame:")).map((f) => f.anchor);
  rememberSeen(
    project,
    docId,
    todo.flatMap((t) => {
      const text = t.anchor.startsWith("frame:") ? figures.find((f) => f.anchor === t.anchor)?.description.trim() : "";
      return text ? [{ anchor: t.anchor, text }] : [];
    }),
  );
  // ponytail: a run each for the last one to five pictures would cost as much as a full one — up to five more ride
  // with the batches there are (21 pictures: one run, not two)
  const size = Math.ceil(todo.length / Math.max(1, Math.ceil((todo.length - 5) / FIGURES_BATCH)));
  for (let i = 0; i < todo.length; i += size) {
    if (ctx.signal.aborted) break;
    const now0 = new Map(readFigures(project, docId).map((f) => [f.anchor, f]));
    const batch = todo.slice(i, i + size).map((t) => {
      if (!opts.context || !t.anchor.startsWith("frame:")) return t;
      const prev = order[order.indexOf(t.anchor) - 1];
      const inBatch = prev && todo.slice(i, i + size).some((x) => x.anchor === prev);
      const before = prev && !inBatch ? now0.get(prev)?.description : undefined;
      return { ...t, context: opts.context(t.anchor, before) };
    });
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

type Ran = { runId: string; costUsd: number };

async function mediaRun(
  project: string,
  docId: string,
  ctx: Ctx,
  o: { prompt: (extra: string[], language: string) => string; label: string; says: string } & JobRun,
): Promise<Ran & { ok: boolean; reply: string }> {
  const p = readProject(project);
  ctx.progress({ message: o.says });
  const g = docGiven(project, "media", docId, o);
  const run = await runClaude({
    project,
    prompt: o.prompt(g.lines, p.language),
    given: g,
    model: o.model || p.claude.model,
    effort: o.effort || "low",
    kind: "media",
    label: o.label,
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  if (!run.ok) ctx.log("warn", `${o.label}: ${run.summary}`);
  return { ok: run.ok, reply: run.summary, runId: run.runId, costUsd: run.costUsd ?? 0 };
}

export async function planVideo(
  project: string,
  docId: string,
  ctx: Ctx,
  video: VideoRef,
  o: { said?: string; text?: string; mosaics: Mosaic[] },
  opts: JobRun = {},
): Promise<Ran & { chapters: Survey["chapters"] | null }> {
  const doc = readDoc(project, docId);
  const r = await mediaRun(project, docId, ctx, {
    ...opts,
    prompt: (extra, language) => planPrompt(doc, video, o, language, extra),
    label: `Plan of ${video.name}`,
    says: `Claude plans ${video.name}`,
  });
  const chapters = r.ok ? (parseSurvey(r.reply)?.chapters ?? null) : null;
  return { chapters: chapters?.length ? chapters : null, runId: r.runId, costUsd: r.costUsd };
}

export async function surveyVideo(
  project: string,
  docId: string,
  ctx: Ctx,
  video: VideoRef,
  part: SurveyPart,
  o: { mosaics: Mosaic[]; crops: Crop[] },
  opts: JobRun = {},
): Promise<Ran & { moments: Survey["moments"] | null; chapters: Survey["chapters"] | null }> {
  const doc = readDoc(project, docId);
  const of = part.chapters ? video.name : `${video.name} · ${part.title}`;
  const r = await mediaRun(project, docId, ctx, {
    ...opts,
    prompt: (extra, language) => surveyPrompt(doc, video, part, o, language, extra),
    label: `Survey of ${of}`,
    says: `Claude surveys ${of}`,
  });
  const s = r.ok ? parseSurvey(r.reply, part.budget) : null;
  return {
    moments: s ? s.moments.filter((m) => m.at >= part.from - 1 && m.at <= part.to + 1) : null,
    chapters: part.chapters && r.ok ? parseChapters(r.reply) : null,

    runId: r.runId,
    costUsd: r.costUsd,
  };
}

export async function translateLines(
  project: string,
  docId: string,
  ctx: Ctx,
  video: Pick<VideoRef, "name">,
  lines: SpokenLine[],
  opts: JobRun = {},
  all: SpokenLine[] = [],
): Promise<{ translated: Map<number, string>; costUsd: number }> {
  const mine = new Set(lines.map((l) => l.at));
  const near = (l: SpokenLine): string[] => {
    const i = all.findIndex((x) => x.at === l.at);
    if (i < 0) return [];
    const said = (x: SpokenLine | undefined, what: string) => (x && !mine.has(x.at) ? [`${what}: ${x.text}`] : []);
    return [...said(all[i - 1], "before"), ...said(all[i + 1], "after")];
  };
  const doc = readDoc(project, docId);
  const out = new Map<number, string>();
  let costUsd = 0;
  for (let i = 0; i < lines.length; i += TRANSLATE_BATCH) {
    if (ctx.signal.aborted) break;
    const batch = lines.slice(i, i + TRANSLATE_BATCH);
    const todo = batch.map((l) => {
      const around = near(l);
      return { key: clock(l.at), lang: l.lang ?? "", text: l.text, ...(around.length ? { around } : {}) };
    });
    const r = await mediaRun(project, docId, ctx, {
      ...opts,
      prompt: (extra, language) => translatePrompt(doc, video, todo, language, extra),
      label: `Translation of ${video.name}`,
      says: `Claude translates what is said in ${video.name}`,
    });
    costUsd += r.costUsd;
    if (!r.ok) continue;
    const b = readBlock(r.reply, TRANSLATE_TAG, z.record(z.string(), z.string()));
    for (const [k, text] of Object.entries(b.value ?? {})) {
      const at = momentOf(k)?.at;
      const line = at === undefined ? undefined : batch.find((l) => Math.floor(l.at) === at);
      const said = text.replace(/\s+/g, " ").trim();
      if (line && said && said.toLowerCase() !== line.text.trim().toLowerCase()) out.set(line.at, said);
    }
  }
  return { translated: out, costUsd };
}

const PROPOSALS = z.array(
  z
    .object({
      at: MOMENT,
      text: z.string(),
      clue: z.enum(["glossary", "screen", "document"]),
      why: z.string().optional(),
    })
    .passthrough(),
);

export async function proposeFixes(
  project: string,
  docId: string,
  ctx: Ctx,
  video: Pick<VideoRef, "name">,
  lines: (SpokenLine & { screen: string[] })[],
  glossary: string[],
  opts: JobRun = {},
): Promise<{ proposals: FixProposal[]; costUsd: number }> {
  const doc = readDoc(project, docId);
  const all = lines.filter((l) => l.by !== "human");
  const proposals: FixProposal[] = [];
  let costUsd = 0;
  // ponytail: a long transcript is read a batch a run, to its end — never its first lines only
  for (let i = 0; i < all.length; i += FIXES_LINES) {
    if (ctx.signal.aborted) break;
    const todo = all.slice(i, i + FIXES_LINES);
    const part = all.length > FIXES_LINES ? ` · ${clock(todo[0].at)} – ${clock(todo[todo.length - 1].at)}` : "";
    const r = await mediaRun(project, docId, ctx, {
      ...opts,
      effort: opts.effort || "medium",
      prompt: (extra) =>
        fixesPrompt(
          doc,
          video,
          todo.map((l) => ({ key: clock(l.at), lang: l.lang, text: l.text, unsure: !!l.unsure, screen: l.screen })),
          glossary,
          extra,
        ),
      label: `Corrections proposed for ${video.name}${part}`,
      says: `Claude reads the transcript of ${video.name}${part}`,
    });
    costUsd += r.costUsd;
    const b = r.ok ? readBlock(r.reply, FIXES_TAG, PROPOSALS) : null;
    for (const x of b?.value ?? []) {
      const at = atOf(x.at);
      const line = at === null ? undefined : todo.find((l) => Math.floor(l.at) === Math.floor(at));
      const text = x.text.replace(/\s+/g, " ").trim();
      if (!line || !text || text === line.text) continue;
      proposals.push({
        id: `${Math.floor(line.at)}`,
        from: line.at,
        to: line.end,
        heard: line.text,
        text,
        clue: x.clue,
        why: (x.why ?? "").trim(),
      });
    }
  }
  return { proposals, costUsd };
}
