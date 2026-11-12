import { type Ctx, UserError } from "../command.ts";
import {
  type AnalysisFile,
  type ColumnRole,
  type Earlier,
  locate,
  type Proposal,
  readAnalysis,
  rolesOf,
  settle,
  stampRun,
} from "../lib/analysis.ts";
import { stepColumns } from "../lib/columns.ts";
import { quoted, testName } from "../lib/names.ts";
import { readProject } from "../lib/project.ts";
import { readTest, testExists } from "../lib/store.ts";
import type { Diagnosis, Effort, StepColumn, Test } from "../types.ts";
import { GIVEN_SLOT, given } from "./given.ts";
import { languageName } from "./language.ts";
import type { PromptTemplate } from "./prompt.ts";
import { newRunId, runClaude } from "./run.ts";
import { revert } from "./snapshot.ts";
import { calledFor } from "./stream.ts";

export const ANALYZE_MARKER = "Use the analyze-test skill on the test";

const HELD: Record<ColumnRole, string> = {
  keep: "kept as written (Testimus holds it: its items stay word for word; link them, add to them)",
  leave: "left empty (Testimus holds it: never write it)",
  open: "",
};

// ponytail: the columns as an analysis needs them — not the generation's « write each », but what each one is for and
// which the core holds whatever Claude decides (a Reference source column, a column nothing describes that the test
// fills), so a requirement typed by hand is never taken for a column to leave empty
export function analysisColumns(
  columns: Pick<StepColumn, "name" | "description" | "referenceSource">[],
  held: Map<string, ColumnRole>,
): string[] {
  return [
    "",
    "The step columns:",
    ...columns.map((c) => {
      const role = held.get(c.name.toLowerCase());
      const what = c.description ? `described « ${c.description} »` : "no description";
      const ref = c.referenceSource ? "; Reference source" : "";
      return `- ${c.name} — ${what}${ref}${role && HELD[role] ? `; ${HELD[role]}` : ""}`;
    }),
  ];
}

const short = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
};

// ponytail: a proposal as the next run reads it — where it is in the test as it is now, what it said, what it wrote
function told(test: Test, a: AnalysisFile, p: Earlier & Partial<Proposal>): string {
  let where = "";
  if (p.kind === "step" && p.after !== undefined) {
    const i = p.after ? locate(test, a.steps, p.after) : -1;
    where = !p.after ? ", before step 1" : i < 0 ? "" : `, after step ${i + 1}`;
  } else if (p.step) {
    const i = locate(test, a.steps, p.step);
    where = i < 0 ? ", a step no longer in the test" : `, step ${i + 1}`;
  }
  const what =
    p.kind === "change" && p.column
      ? ` — ${p.column}: « ${short(p.value ?? "")} »`
      : p.kind === "step"
        ? ` — ${short(p.fields?.Action ?? "")}`
        : p.kind === "source"
          ? ` — ${p.sources.map(short).join(" · ")}`
          : p.kind === "describe" && p.field
            ? ` — ${p.field}: « ${short(p.value ?? "")} »`
            : "";
  return `- ${p.kind}${where}: ${p.title}${what}`;
}

// ponytail: an analysis again — the next run is told what the team decided on the last one (the test as it is now
// says what was accepted; an accepted edit undone since is open again), so it never proposes a rejection twice
export function earlierAnalysis(test: Test, prev: AnalysisFile | null): string[] {
  if (!prev) return [];
  const a = settle(test, prev);
  const by = (s: string) => a.proposals.filter((p) => p.state === s).map((p) => told(test, a, p));
  const accepted = by("accepted");
  const rejected = [...(a.earlier ?? []).map((e) => told(test, a, e)), ...by("rejected")];
  const open = by("open");
  if (!accepted.length && !rejected.length && !open.length) return [];
  return [
    "",
    `This test was analysed before (${a.at.slice(0, 10)}); what the team decided stands, the step numbers are the test's now:`,
    ...(accepted.length ? ["Accepted — in the test now, never propose to undo them:", ...accepted] : []),
    ...(rejected.length ? ["Rejected — never propose them again, in any wording:", ...rejected] : []),
    ...(open.length
      ? ["Not decided yet — propose again those that still hold against the documents, the others not:", ...open]
      : []),
  ];
}

export function analyzePrompt(
  id: string,
  columns: string[],
  language: string,
  context: string[],
  earlier: string[] = [],
): string {
  return [
    `${ANALYZE_MARKER} ${id}.`,
    "Read it with tests_show; never modify it or any other file: the team accepts or rejects each proposal.",
    ...columns,
    ...earlier,
    "",
    `Record everything with analysis_record, once: { id: "${id}", summary, columns, unfound, proposals } — proposals: [] when the test matches the documents. A refused call lists what to fix: fix it and call again.`,
    `Summary, titles and whys in ${languageName(language)}; the column names as listed above.`,
    ...context,
    "",
    "Then reply in one line: the proposals counted by kind.",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "analyze",
    name: "Cross-check a test against the documents",
    group: "Check and fix",
    kind: "analyze",
    usedBy: ["Tests: Cross-check", "analysis.run"],
    answers: "analysis_record, once: the sources of what is right and the proposals the team accepts or rejects",
    text: () =>
      analyzePrompt(
        "{test}",
        [
          "",
          "The step columns:",
          "- {column} — {its description, or none}; {kept as written or left empty when Testimus holds it}",
        ],
        "{language}",
        GIVEN_SLOT,
        ["", "{when the test was analysed before: the proposals the team accepted, rejected and left open}"],
      ),
  },
];

export type AnalyzeResult = { ok: boolean; runId: string; summary: string; proposals: number; diagnosis?: Diagnosis };

export async function analyzeTest(
  ctx: Ctx,
  project: string,
  id: string,
  o: { model?: string; effort?: Effort; contexts?: string[]; without?: string[]; note?: string },
): Promise<AnalyzeResult> {
  if (!testExists(project, id))
    throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.", "test-gone");
  const p = readProject(project);
  const model = o.model ?? p.claude.model;
  const effort = o.effort ?? p.claude.effort;
  const g = given(project, "analyze", { kind: "test", testId: id }, o);
  const name = quoted(testName(project, id));
  const runId = newRunId();
  const { test } = readTest(project, id);
  ctx.progress({ message: `Claude reads ${name} against the documents` });
  const r = await runClaude({
    project,
    runId,
    label: "analyze",
    title: `analyze ${name}`,
    prompt: analyzePrompt(
      id,
      analysisColumns(stepColumns(project), rolesOf(project, test)),
      p.language,
      g.lines,
      earlierAnalysis(test, readAnalysis(project, id)),
    ),
    model,
    effort,
    scope: { kind: "test", testId: id },
    given: g,
    kind: "analyze",
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  if (r.changedTests.includes(id) && r.written.includes(id))
    try {
      revert(project, r.runId, { ids: [id] });
      ctx.log("warn", `The cross-check of ${name} edited the test; the edit was put back.`);
    } catch {
      ctx.log("warn", `The cross-check of ${name} edited the test, then the file changed again — kept as it is.`);
    }
  const recorded = calledFor(r.calls, "analysis_record", id) && !!readAnalysis(project, id);
  const base = { runId: r.runId, ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}) };
  if (!r.ok || !recorded || ctx.signal.aborted)
    return {
      ...base,
      ok: false,
      proposals: 0,
      summary:
        r.ok && !recorded && !ctx.signal.aborted
          ? `Claude did not record its cross-check of ${name} (analysis_record was not called).`
          : r.summary,
    };
  stampRun(project, id, { runId: r.runId, model, effort, ...(o.note?.trim() ? { note: o.note.trim() } : {}) });
  const proposals = readAnalysis(project, id)?.proposals.length ?? 0;
  ctx.progress({ message: `${name}: ${proposals} proposal${proposals === 1 ? "" : "s"}` });
  return { ...base, ok: true, proposals, summary: r.summary };
}
