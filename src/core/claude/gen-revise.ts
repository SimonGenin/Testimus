import type { Ctx } from "../command.ts";
import { UserError } from "../command.ts";
import { readProject } from "../lib/project.ts";
import { testExists } from "../lib/store.ts";
import type { Effort } from "../types.ts";
import { checkTests } from "./check.ts";
import { genBoard } from "./gen-board.ts";
import { proposeNext } from "./gen-next.ts";
import { inCategoryOrder } from "./gen-reply.ts";
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

// ponytail: the prompts a revision sends are built by the modules it calls — generateTests with what the generation
// has (generate-add), runOnScope on several tests (ask-tests); tests/unit/core/claude/catalog.test.ts holds it to them
export const promptsUsed = ["generate-add", "ask-tests", "gen-next"];

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
  const contexts = input.contexts ?? ledger.input.contexts;
  if (input.mode === "add") {
    const r = await generateTests(
      project,
      {
        ...ledger.input,
        request: input.request.trim(),
        note: input.note?.trim() || undefined,
        model: input.model,
        effort: input.effort,
        contexts,
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
    { id: "next", label: "Propose what is next" },
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
      ...(contexts ? { contexts } : {}),
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
  const skipped = inCategoryOrder(ledger.skipped ?? []);
  await proposeNext(ctx, project, input.generation, {
    tests: revised,
    skipped: [],
    by: { runId: r.runId, model: input.model || p.claude.model, effort: input.effort || p.claude.effort },
    ask: r.ok,
    revised: true,
  });
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
