import { type Ctx, UserError } from "../command.ts";
import { type ColumnRole, readAnalysis, rolesOf, stampRun } from "../lib/analysis.ts";
import { stepColumns } from "../lib/columns.ts";
import { quoted, testName } from "../lib/names.ts";
import { readProject } from "../lib/project.ts";
import { readTest, testExists } from "../lib/store.ts";
import type { Diagnosis, Effort, StepColumn } from "../types.ts";
import { CONTEXT_SLOT, contextLines, effectiveContexts, type PromptTemplate, readContexts } from "./prompt.ts";
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
    "The step columns (columns_list says the same):",
    ...columns.map((c) => {
      const role = held.get(c.name.toLowerCase());
      const what = c.description ? `described « ${c.description} »` : "no description";
      const ref = c.referenceSource ? "; Reference source" : "";
      return `- ${c.name} — ${what}${ref}${role && HELD[role] ? `; ${HELD[role]}` : ""}`;
    }),
  ];
}

export function analyzePrompt(id: string, columns: string[], language: string, context: string[]): string {
  return [
    `${ANALYZE_MARKER} ${id}.`,
    `File: tests/${id}/test.md — read it (tests_show); never modify it or any other file: the team accepts or rejects each proposal.`,
    ...columns,
    "",
    "For every column that holds text, judge from its description and from what is written whether it is the team's (keep: every item stays word for word, you only add and link), open to changes (open) or meant to stay empty (leave). A Reference source column is always keep.",
    "Link what is already right to its passage before proposing anything else; report a requirement or value no document holds under unfound — it stays as it is.",
    `Record everything with analysis_record exactly once: { id: "${id}", summary, columns, unfound, proposals } — proposals: [] when the test matches the documents. A refused call lists what to fix: fix it and call again.`,
    `Write summary, titles and whys in the project language (${language}); the column names as columns_list gives them.`,
    ...context,
    "",
    "Then reply in one line: how many proposals of each kind.",
    "",
  ].join("\n");
}

export const prompts: PromptTemplate[] = [
  {
    id: "analyze",
    name: "Analyze a test against the documents",
    group: "Check and fix",
    usedBy: ["Tests: Analysis", "analysis.run"],
    text: () =>
      analyzePrompt(
        "{test}",
        [
          "",
          "The step columns (columns_list says the same):",
          "- {column} — {its description, or none}; {kept as written or left empty when Testimus holds it}",
        ],
        "{language}",
        CONTEXT_SLOT,
      ),
  },
];

export type AnalyzeResult = { ok: boolean; runId: string; summary: string; proposals: number; diagnosis?: Diagnosis };

export async function analyzeTest(
  ctx: Ctx,
  project: string,
  id: string,
  o: { model?: string; effort?: Effort; contexts?: string[]; note?: string },
): Promise<AnalyzeResult> {
  if (!testExists(project, id))
    throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.", "test-gone");
  const p = readProject(project);
  const model = o.model ?? p.claude.model;
  const effort = o.effort ?? p.claude.effort;
  const contexts = o.contexts ?? effectiveContexts(project, id);
  const name = quoted(testName(project, id));
  const runId = newRunId();
  ctx.progress({ message: `Claude reads ${name} against the documents` });
  const r = await runClaude({
    project,
    runId,
    label: "analyze",
    title: `analyze ${name}`,
    prompt: analyzePrompt(
      id,
      analysisColumns(stepColumns(project), rolesOf(project, readTest(project, id).test)),
      p.language,
      contextLines(project, readContexts(project, contexts), o.note ?? ""),
    ),
    model,
    effort,
    scope: { kind: "test", testId: id },
    contexts,
    kind: "analyze",
    signal: ctx.signal,
    onEvent: (e) => ctx.claude(e),
  });
  if (r.changedTests.includes(id) && r.written.includes(id))
    try {
      revert(project, r.runId, { ids: [id] });
      ctx.log("warn", `The analysis of ${name} edited the test; the edit was put back.`);
    } catch {
      ctx.log("warn", `The analysis of ${name} edited the test, then the file changed again — kept as it is.`);
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
          ? `Claude did not record its analysis of ${name} (analysis_record was not called).`
          : r.summary,
    };
  stampRun(project, id, { runId: r.runId, model, effort, ...(o.note?.trim() ? { note: o.note.trim() } : {}) });
  const proposals = readAnalysis(project, id)?.proposals.length ?? 0;
  ctx.progress({ message: `${name}: ${proposals} proposal${proposals === 1 ? "" : "s"}` });
  return { ...base, ok: true, proposals, summary: r.summary };
}
