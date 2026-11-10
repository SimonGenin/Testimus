import type { Ctx } from "../command.ts";
import { loadCorpus, mechanicalCheck, semanticOf } from "../lib/check.ts";
import { quoted, testName } from "../lib/names.ts";
import { readProject } from "../lib/project.ts";
import { setReview } from "../lib/review.ts";
import { readCheck, readTest } from "../lib/store.ts";
import type { CheckFile, Diagnosis, Review } from "../types.ts";
import { checkOne, FINDING_SLOT, findingLine } from "./check.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { languageName } from "./language.ts";
import { type PromptTemplate, scopedPrompt } from "./prompt.ts";
import { runClaude } from "./run.ts";
import { markLeft } from "./snapshot.ts";

export type FixResult = {
  ok: boolean;
  runId: string;
  summary: string;
  changedSteps: number[];
  review: Review;
  check: CheckFile | null;
  message?: string;
  diagnosis?: Diagnosis;
};

function fixRequest(id: string, note: string, findings: string[], language: string): string {
  return [
    `Use the fix-test skill on the test ${id}.`,
    note ? `Reviewer's note (To fix): ${JSON.stringify(note)}` : "No reviewer's note: fix what the findings ask.",
    findings.length ? "Findings of the last check:" : "The last check has no finding.",
    ...findings,
    `Write in ${languageName(language)}.`,
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "fix",
    name: "Fix a test from its To fix note",
    group: "Check and fix",
    kind: "fix",
    usedBy: ["Review: To fix, Ask Claude to fix it", "review.fix"],
    answers: "The test corrected (snapshotted), then checked again by Testimus; a few lines saying what changed",
    text: () =>
      scopedPrompt(
        { kind: "test", testId: "{test}" },
        fixRequest("{test}", "{reviewer's note}", [FINDING_SLOT], "{language}"),
        GIVEN_SLOT,
      ),
  },
];

export async function fixTest(
  ctx: Ctx,
  project: string,
  id: string,
  opts: { note?: string; semantic: boolean; contexts?: string[]; without?: string[] },
): Promise<FixResult> {
  const { test } = readTest(project, id);
  const note = (opts.note ?? test.reviewNote ?? "").trim();
  const findings = [...mechanicalCheck(project, id, loadCorpus(project)), ...semanticOf(readCheck(project, id))];
  const p = readProject(project);
  const scope = { kind: "test" as const, testId: id };
  const name = quoted(testName(project, id));
  ctx.progress({ message: `Claude fixes ${name}`, done: 0, total: 2 });
  const g = given(project, "fix", { kind: "test", testId: id }, { contexts: opts.contexts, without: opts.without });
  const r = await runClaude({
    project,
    prompt: scopedPrompt(scope, fixRequest(id, note, findings.map(findingLine), p.language), g.lines),
    model: p.claude.model,
    effort: p.claude.effort,
    scope,
    given: g,
    kind: "fix",
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  const base = {
    runId: r.runId,
    summary: r.summary,
    changedSteps: r.changedSteps[id] ?? [],
    changedTests: r.changedTests,
    ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}),
  };
  if (!r.ok || ctx.signal.aborted)
    return { ...base, ok: false, review: readTest(project, id).test.review, check: readCheck(project, id) };
  ctx.progress({ message: `Re-checking ${quoted(testName(project, id))}`, done: 1, total: 2 });
  const c = await checkOne(ctx, project, id, opts.semantic);
  // ponytail: a fixed test waits for the reviewer again, whatever its re-check found; the re-check only
  // says what is left
  const review = setReview(project, id, { review: "draft" }).review;
  markLeft(project, r.runId, [id]);
  if (c.ok && c.semantic && !ctx.signal.aborted) {
    ctx.progress({ message: `${quoted(testName(project, id))} fixed and re-checked`, done: 2, total: 2 });
    return { ...base, ok: true, review, check: c.check };
  }
  const message = c.semantic
    ? `Claude fixed ${quoted(testName(project, id))}, but the semantic re-check did not finish. Run check.run on it.`
    : `Claude fixed ${quoted(testName(project, id))}; only the mechanical check ran. Run check.run on it.`;
  ctx.log("warn", message);
  ctx.progress({ message, done: 2, total: 2 });
  return { ...base, ok: true, review, check: c.check, message };
}
