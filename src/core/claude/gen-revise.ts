import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { testName } from "../lib/names.ts";
import { readProject } from "../lib/project.ts";
import { testExists } from "../lib/store.ts";
import type { Effort } from "../types.ts";
import { checkTests } from "./check.ts";
import { proposeGenActions } from "./gen-actions.ts";
import { genBoard } from "./gen-board.ts";
import { type GenCheck, type GenResult, generateTests, toolStep } from "./generate.ts";
import { readLedger } from "./ledger.ts";
import { runOnScope } from "./scoped.ts";

export type ReviseInput = {
  generation: string;
  request: string;
  mode: "change" | "add";
  tests?: string[];
  model?: string;
  effort?: Effort;
  contexts?: string[];
  note?: string;
};

export type ReviseResult = GenResult & { revised: string[] };

// ponytail: a generation asked again — « change » runs edit-test on its tests (all, or the ones picked), « add » runs
// a generation under the same id with what the user asks for and the tests it already has; either way the result is the
// generation's, its new findings and skipped items leave Claude actions, and the run is snapshotted like any other
export async function reviseGeneration(project: string, input: ReviseInput, ctx: Ctx): Promise<ReviseResult> {
  const ledger = readLedger(project, input.generation);
  if (!ledger?.input)
    throw new UserError(
      `No generation ${input.generation} in this project.`,
      "Its id is the generation of a gen.tests result (generated_by of its tests).",
    );
  const theirs = (ledger.tests ?? []).filter((id) => testExists(project, id));
  if (!input.request.trim())
    throw new UserError("Say what should change, or what to add.", "Write the request in a few words.");
  if (input.mode === "add") {
    const r = await generateTests(
      project,
      {
        ...ledger.input,
        request: input.request.trim(),
        note: [addNote(project, ledger.input.request, theirs), input.note?.trim()].filter(Boolean).join("\n\n"),
        model: input.model,
        effort: input.effort,
        contexts: input.contexts ?? ledger.input.contexts,
        discard: false,
        resume: undefined,
        check: true,
      },
      ctx,
      input.generation,
    );
    return { ...r, revised: [] };
  }
  const ids = input.tests?.length ? input.tests.filter((id) => theirs.includes(id)) : theirs;
  if (!ids.length)
    throw new UserError(
      "No test of this generation is left to change.",
      "Its tests were deleted or pushed elsewhere: generate again, or ask for added tests.",
    );
  ctx.steps?.([
    { id: "write", label: "Change the tests" },
    { id: "check", label: "Check the changed tests" },
  ]);
  ctx.step?.("write");
  const p = readProject(project);
  const board = genBoard((gen) => ctx.progress({ message: "Claude changes the tests", gen }));
  const lane = board.run();
  const r = await runOnScope(
    {
      ...ctx,
      claude: (e) => {
        ctx.claude(e);
        const s = toolStep(e);
        if (s?.kind === "write" && ids.includes(s.testId) && lane.wrote(s.testId))
          ctx.progress({ message: "Claude changes the tests", gen: board.tests() });
      },
    },
    project,
    {
      scope: { kind: "tests", testIds: ids },
      prompt: input.request.trim(),
      model: input.model,
      effort: input.effort,
      ...(input.contexts ? { contexts: input.contexts } : {}),
      ...(input.note ? { note: input.note } : {}),
    },
  );
  lane.end();
  const revised = r.changedTests.filter((id) => ids.includes(id));
  const checks: GenCheck[] = [];
  if (revised.length && !ctx.signal.aborted) {
    ctx.step?.("check");
    ctx.progress({ message: `Checking ${revised.length} changed test(s)` });
    for (const c of await checkTests(ctx, project, revised, true)) {
      const n = (s: string) => c.check.findings.filter((f) => f.severity === s).length;
      checks.push({ id: c.id, ok: c.ok, review: c.review, errors: n("error"), warnings: n("warning") });
    }
  }
  if (!r.ok) ctx.log("error", r.summary);
  const skipped = ledger.skipped ?? [];
  proposeGenActions(
    project,
    input.generation,
    {
      tests: revised,
      skipped: [],
      by: { runId: r.runId, model: input.model || p.claude.model, effort: input.effort || p.claude.effort },
    },
    ctx.log,
  );
  return {
    runId: r.runId,
    ok: r.ok,
    summary: r.summary,
    tests: [],
    checks,
    changed: r.changedTests.filter((id) => !ids.includes(id)),
    discarded: [],
    skipped,
    reportFound: true,
    consulted: 0,
    planned: 0,
    generation: input.generation,
    remaining: 0,
    ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}),
    ...(r.tokens ? { tokens: r.tokens } : {}),
    durationMs: r.durationMs,
    ...(r.diagnosis ? { diagnosis: r.diagnosis } : {}),
    revised,
  };
}

function addNote(project: string, request: string, tests: string[]): string {
  const names = tests.map((id) => `- ${testName(project, id)}`);
  return [
    `This adds tests to an earlier generation${request.trim() ? ` for: ${request.trim()}` : ""}.`,
    ...(names.length ? ["It already has these tests — never write them again:", ...names] : []),
  ].join("\n");
}
