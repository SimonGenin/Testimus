import { relative, resolve } from "node:path";
import { z } from "zod";
import { type Ctx, UserError } from "../command.ts";
import { quoted, testName } from "../lib/names.ts";
import { pictureFile } from "../lib/pictures.ts";
import { readProject } from "../lib/project.ts";
import { readTest, testExists } from "../lib/store.ts";
import { formatSource } from "../lib/testfile.ts";
import type { Diagnosis, Effort } from "../types.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { languageName } from "./language.ts";
import { askAgainLines, readBlock } from "./parts.ts";
import type { PromptTemplate } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";

// ponytail: a short run that looks for the pictures of one step — a document figure first, then a photo of the
// interface, then a key frame of a video — and proposes at most three, each with what it shows; nothing is added to
// the test: the person picks one (tests.addImage). Finding none is an answer like another

export const PICTURE_MARKER = "Testimus picture search";
export const PICTURES_TAG = "pictures";
const AT_MOST = 3;

const PICKS = z.object({
  pictures: z
    .preprocess(
      (v) => (v === null ? undefined : v),
      z
        .array(
          z.object({
            figure: z.string().trim().min(3).describe("docId#fig:<n>, docId#img:<n> or docId#frame:<mm:ss>"),
            field: z
              .preprocess((v) => (v === null ? undefined : v), z.enum(["Action", "Expected Result"]).default("Action"))
              .describe("Action when it shows where to act, Expected Result when it shows what to see"),
            why: z.string().trim().min(10).describe("What it shows of the step's screen"),
          }),
        )
        .max(AT_MOST)
        .default([]),
    )
    .describe("The pictures found, the best first; [] when none truly shows the screen"),
});

export type Picture = { figure: string; file: string; field: "Action" | "Expected Result"; why: string };

export function picturePrompt(
  id: string,
  n: number,
  step: { action: string; expected: string; sources: string[] },
  language: string,
  context: string[] = [],
): string {
  return [
    `${PICTURE_MARKER} for step ${n} of the test ${id} (tests/${id}/test.md).`,
    "",
    `Action: ${step.action.trim() || "(empty)"}`,
    `Expected Result: ${step.expected.trim() || "(empty)"}`,
    ...(step.sources.length ? ["Its sources:", ...step.sources.map((s) => `- ${s}`)] : ["It cites no source."]),
    "",
    `Find at most ${AT_MOST} pictures of the screen this step acts on or looks at, in this order: a figure of the documents (docId#fig:<n> — rag_passage on its sources lists their figures, rag_figure gives the file), then a photo of the interface (docId#img:<n> — rag_search the screen's name, media_show the images document), then a key frame of a video (docId#frame:<mm:ss> — media_show lists them, media_frame shows any moment, media_keep { doc, at } keeps the right one).`,
    "Read each picture before you propose it. Propose one only when it shows that very screen in the state the step is about: another screen, another state or another object is worse than none. Finding none is a valid answer and needs no excuse.",
    "Change nothing: no test, no file.",
    ...context,
    "",
    `End your reply with this block, valid JSON, nothing after it — why in ${languageName(language)}:`,
    "```" + PICTURES_TAG,
    '{"pictures": [{"figure": "<docId>#fig:<n> | <docId>#img:<n> | <docId>#frame:<mm:ss>", "field": "Action | Expected Result", "why": "<what it shows of the step>"}]}',
    "```",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "find-image",
    name: "Find a picture for a step",
    group: "Check and fix",
    kind: "picture",
    usedBy: ["Tests and Review: a step's Find a picture", "tests.findImage"],
    answers: "A pictures block: at most three pictures of the step's screen, each with what it shows; nothing is added",
    text: () =>
      picturePrompt(
        "{test}",
        1,
        { action: "{action}", expected: "{expected result}", sources: ["{source}"] },
        "{language}",
        GIVEN_SLOT,
      ),
  },
];

export type FindResult = {
  ok: boolean;
  runId: string;
  summary: string;
  pictures: Picture[];
  diagnosis?: Diagnosis;
};

export async function findPictures(
  ctx: Ctx,
  project: string,
  id: string,
  n: number,
  o: { model?: string; effort?: Effort; contexts?: string[]; without?: string[] },
): Promise<FindResult> {
  if (!testExists(project, id))
    throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.", "test-gone");
  const { test } = readTest(project, id);
  const s = test.steps[n - 1];
  if (!s || n < 1)
    throw new UserError(
      `Step ${n} does not exist — the test has ${test.steps.length} step(s).`,
      `Give a step from 1 to ${test.steps.length}.`,
    );
  const p = readProject(project);
  const who = { model: o.model || "sonnet", effort: o.effort || ("low" as Effort) };
  const g = given(project, "picture", { kind: "test", testId: id }, o);
  const runId = newRunId();
  const name = quoted(testName(project, id));
  ctx.progress({ message: `Claude looks for a picture of step ${n} of ${name}` });
  const r = await runClaude({
    project,
    runId,
    label: "find a picture",
    title: `pictures of step ${n} of ${name}`,
    prompt: picturePrompt(
      id,
      n,
      {
        action: s.fields.Action ?? "",
        expected: s.fields["Expected Result"] ?? "",
        sources: s.sources.map(formatSource),
      },
      p.language,
      g.lines,
    ),
    ...who,
    kind: "picture",
    given: g,
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  const base = { runId, ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}) };
  if (!r.ok || ctx.signal.aborted) return { ...base, ok: false, summary: r.summary, pictures: [] };
  let b = readBlock(r.summary, PICTURES_TAG, PICKS);
  if (!b.value && r.sessionId) {
    ctx.log("warn", `The ${PICTURES_TAG} block of the picture search was not readable: Claude is asked again.`);
    const again = await runClaude({
      project,
      label: "find a picture: answer",
      prompt: askAgainLines(PICTURES_TAG, b.errors),
      ...who,
      kind: "picture",
      resume: r.sessionId,
      signal: ctx.signal,
      onEvent: (e) => ctx.claude(e),
    });
    if (again.ok) b = readBlock(again.summary, PICTURES_TAG, PICKS);
  }
  if (!b.value)
    return { ...base, ok: false, summary: `Claude's answer could not be read: ${b.errors.join("; ")}`, pictures: [] };
  // ponytail: a picture is proposed only when Testimus finds its file — a figure without a picture, an anchor that is
  // not there, is said in the log and left out
  const pictures: Picture[] = [];
  for (const x of b.value.pictures) {
    try {
      const f = pictureFile(project, x.figure);
      if (pictures.some((q) => q.figure === f.figure)) continue;
      pictures.push({
        figure: f.figure,
        file: relative(resolve(project), resolve(f.path)).replace(/\\/g, "/"),
        field: x.field,
        why: x.why,
      });
    } catch (e) {
      ctx.log("warn", `Left out ${x.figure}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  ctx.progress({
    message: pictures.length
      ? `${pictures.length} picture${pictures.length === 1 ? "" : "s"} for step ${n}`
      : `No picture for step ${n}`,
  });
  return { ...base, ok: true, summary: r.summary, pictures };
}
