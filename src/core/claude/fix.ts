import type { Ctx } from "../command.ts";
import { loadCorpus, mechanicalCheck, semanticOf } from "../lib/check.ts";
import { readProject } from "../lib/project.ts";
import { setReview } from "../lib/review.ts";
import { readCheck, readTest } from "../lib/store.ts";
import type { CheckFile, Diagnosis, Finding, Review } from "../types.ts";
import { checkOne, findingLine } from "./check.ts";
import { buildPrompt, effectiveContexts, readContexts } from "./prompt.ts";
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

function fixRequest(id: string, note: string, findings: Finding[], language: string): string {
  return [
    `Use the fix-test skill on the test ${id}.`,
    note ? `Reviewer's note (To fix): ${JSON.stringify(note)}` : "No reviewer's note: fix what the findings ask.",
    findings.length ? "Findings of the last check:" : "The last check has no finding.",
    ...findings.map(findingLine),
    `Write in the project language (${language}).`,
    "Do not change review, review_note, reviewed_by or reviewed_at in the frontmatter: Testimus sets them after its re-check.",
  ].join("\n");
}

export async function fixTest(
  ctx: Ctx,
  project: string,
  id: string,
  opts: { note?: string; semantic: boolean },
): Promise<FixResult> {
  const { test } = readTest(project, id);
  const note = (opts.note ?? test.reviewNote ?? "").trim();
  const findings = [...mechanicalCheck(project, id, loadCorpus(project)), ...semanticOf(readCheck(project, id))];
  const p = readProject(project);
  const scope = { kind: "test" as const, testId: id };
  ctx.progress({ message: `Claude fixes ${id}`, done: 0, total: 2 });
  const r = await runClaude({
    project,
    prompt: buildPrompt(
      scope,
      fixRequest(id, note, findings, p.language),
      readContexts(project, effectiveContexts(project, id)),
      project,
    ),
    model: p.claude.model,
    effort: p.claude.effort,
    scope,
    contexts: effectiveContexts(project, id),
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
  ctx.progress({ message: `Re-checking ${id}`, done: 1, total: 2 });
  const c = await checkOne(ctx, project, id, opts.semantic);
  // ponytail: a fixed test waits for the reviewer again, whatever its re-check found; the re-check only
  // says what is left
  const review = setReview(project, id, { review: "draft" }).review;
  markLeft(project, r.runId, [id]);
  if (c.ok && c.semantic && !ctx.signal.aborted) {
    ctx.progress({ message: `${id} fixed and re-checked`, done: 2, total: 2 });
    return { ...base, ok: true, review, check: c.check };
  }
  const message = c.semantic
    ? `Claude fixed ${id}, but the semantic re-check did not finish. Run check.run on it.`
    : `Claude fixed ${id}; only the mechanical check ran. Run check.run on it.`;
  ctx.log("warn", message);
  ctx.progress({ message, done: 2, total: 2 });
  return { ...base, ok: true, review, check: c.check, message };
}
