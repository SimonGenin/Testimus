import type { Ctx } from "../command.ts";
import { agentPool, loadLine } from "../lib/agents.ts";
import {
  type Corpus,
  loadCorpus,
  readTestReview,
  recordSemantic,
  runMechanical,
  semanticOf,
  setReview,
} from "../lib/check.ts";
import { readProject } from "../lib/project.ts";
import { readCheck } from "../lib/store.ts";
import type { CheckFile, Diagnosis, Finding, Review } from "../types.ts";
import { proposeLines } from "./actions.ts";
import { effectiveContexts } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";
import { revert } from "./snapshot.ts";
import { calledFor } from "./stream.ts";

export type TestCheck = {
  id: string;
  ok: boolean;
  semantic: boolean;
  review: Review;
  check: CheckFile;
  summary?: string;
  runId?: string;
  diagnosis?: Diagnosis;
};

export const findingLine = (f: Finding) =>
  `- ${f.step ? `step ${f.step}` : "test"} — ${f.kind} (${f.severity}): ${f.message}${f.sources.length ? ` [${f.sources.join(", ")}]` : ""}`;

export function checkPrompt(id: string, mechanical: Finding[], language: string, runId?: string): string {
  return [
    `Use the check-test skill on the test ${id}.`,
    `File: tests/${id}/test.md — read it (tests_show), never modify it or any other file.`,
    mechanical.length
      ? "Mechanical findings already recorded by Testimus (do not repeat them):"
      : "The mechanical check found nothing.",
    ...mechanical.map(findingLine),
    "",
    `Record your findings with check_record exactly once: { id: "${id}", findings: [...] } — findings: [] when there is none.`,
    `Write each message in the project language (${language}).`,
    ...(runId
      ? proposeLines(
          runId,
          `a finding you can correct from the documents — { kind: "step", testId: "${id}", step } or { kind: "test", testId: "${id}" }, problem: the finding's message`,
        )
      : []),
    "Then reply in one line with the count of findings by severity.",
    "",
  ].join("\n");
}

async function semanticPass(
  ctx: Ctx,
  project: string,
  id: string,
  mechanical: Finding[],
): Promise<{ ok: boolean; recorded: boolean; summary: string; runId: string; diagnosis?: Diagnosis }> {
  const p = readProject(project);
  const runId = newRunId();
  const r = await runClaude({
    project,
    runId,
    label: "check",
    title: `check ${id}`,
    prompt: checkPrompt(id, mechanical, p.language, runId),
    model: p.claude.model,
    effort: p.claude.effort,
    scope: { kind: "test", testId: id },
    contexts: effectiveContexts(project, id),
    kind: "check",
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  const own = r.changedTests.filter((t) => r.written.includes(t));
  const other = r.changedTests.filter((t) => !own.includes(t));
  if (own.length)
    try {
      revert(project, r.runId, { ids: own });
      ctx.log("warn", `${id}: the check run edited ${own.join(", ")}; the edit was put back.`);
    } catch {
      ctx.log("warn", `${id}: the check run edited ${own.join(", ")}, then the file changed again — kept as it is.`);
    }
  if (other.length)
    ctx.log(
      "warn",
      `${other.join(", ")} changed while ${id} was being checked (not by the check): kept; check it again.`,
    );
  const recorded = calledFor(r.calls, "check_record", id);
  return {
    ok: r.ok && recorded,
    recorded,
    summary:
      r.ok && !recorded ? `Claude did not record the findings of ${id} (check_record was not called).` : r.summary,
    runId: r.runId,
    ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}),
  };
}

export async function checkOne(
  ctx: Ctx,
  project: string,
  id: string,
  semantic: boolean,
  corpus: Corpus = loadCorpus(project),
): Promise<TestCheck> {
  const mech = runMechanical(project, id, corpus);
  if (!semantic) return { id, ok: true, semantic: false, review: readTestReview(project, id), check: mech };
  const r = await semanticPass(ctx, project, id, mech.findings);
  const found = semanticOf(readCheck(project, id));
  if (!r.ok)
    found.push({
      kind: "other",
      severity: "warning",
      message: `The semantic check did not finish (${r.summary.slice(0, 200) || "no answer"}): run the check again.`,
      sources: [],
      pass: "semantic",
    });
  const check = recordSemantic(project, id, found);
  return {
    id,
    ok: r.ok,
    semantic: true,
    review: readTestReview(project, id),
    check,
    summary: r.summary,
    runId: r.runId,
    ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}),
  };
}

// ponytail: draft → checked only after a semantic pass that finished and recorded its findings (SPEC §9)
export function promoteChecked(ctx: Ctx, project: string, r: TestCheck): Review {
  if (r.ok && r.semantic && r.review === "draft" && !ctx.signal.aborted)
    return setReview(project, r.id, { review: "checked" }).review;
  return r.review;
}

export async function checkTests(ctx: Ctx, project: string, ids: string[], semantic: boolean): Promise<TestCheck[]> {
  const corpus = loadCorpus(project);
  const pool = agentPool({
    onLimit: (n, load) => ctx.log("info", `Agents: ${n} at a time (${loadLine(load)}).`),
  });
  const total = ids.length;
  let done = 0;
  ctx.progress({ message: `Checking ${total} test${total > 1 ? "s" : ""}`, done, total });
  return await Promise.all(
    ids.map((id) =>
      pool.run(async () => {
        if (ctx.signal.aborted) {
          const check = readCheck(project, id) ?? runMechanical(project, id, corpus);
          return { id, ok: false, semantic, review: readTestReview(project, id), check, summary: "Cancelled" };
        }
        const r = await checkOne(ctx, project, id, semantic, corpus);
        const n = (s: string) => r.check.findings.filter((f) => f.severity === s).length;
        done++;
        ctx.progress({
          message: `${id}: ${n("error")} error(s), ${n("warning")} warning(s)${r.ok ? "" : " — semantic check failed"}`,
          done,
          total,
        });
        return r;
      }),
    ),
  );
}
