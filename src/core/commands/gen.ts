import { z } from "zod";
import { genLabel, scopeIndex } from "../claude/gen-prompt.ts";
import { planView } from "../claude/gen-replan.ts";
import { inCategoryOrder } from "../claude/gen-reply.ts";
import { reviseGeneration } from "../claude/gen-revise.ts";
import { discardable, generateTests } from "../claude/generate.ts";
import { readLedger } from "../claude/ledger.ts";
import { CONTEXT_IDS, EFFORT, MODEL, NOTE, WITHOUT } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { generationName } from "../lib/names.ts";
import { testExists } from "../lib/store.ts";
import { GEN_RESULT, PLANNED_TEST, QUESTION, SETTLED, SKIPPED } from "./gen-schemas.ts";

export const commands = [
  command({
    name: "gen.tests",
    summary:
      "Generate draft tests from the documents with Claude (generate-tests skill): every expected result sourced, gaps reported. A request that takes more than one test is planned first (plan-tests skill), then written one run per test, several at a time (agents setting). Refused while a document in scope is not indexed (rag.index); one changed since its last index only warns.",
    input: z.object({
      request: z
        .string()
        .default("")
        .describe(
          "What to test, in words: a feature, a screen, an operator procedure (may be empty with documents or sections)",
        ),
      sections: z
        .array(z.string())
        .optional()
        .describe("Document sections in scope, docId#§x.y (e.g. SOSIE_211_D401-1_3#§5.6.6)"),
      docs: z
        .array(z.string())
        .optional()
        .describe(
          "Documents in scope as a whole, by id (docs.list); with sections, the documents not narrowed to sections",
        ),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids Claude reads first (default: project.json claude.contexts)",
      ),
      without: WITHOUT,
      note: NOTE,
      folder: z
        .string()
        .optional()
        .describe("Xray folder of the new tests (default: Claude picks one of project.json folders)"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)"),
      check: z
        .boolean()
        .default(true)
        .describe(
          "Check the new tests in the same job: mechanical + check-test skill, findings only (default true); false = mechanical only",
        ),
      discard: z
        .boolean()
        .default(false)
        .describe(
          "Delete first the generated tests not validated yet (the review queue, except tests already in Jira): the new generation replaces them; this cannot be reverted",
        ),
      review: z
        .boolean()
        .default(false)
        .describe(
          "Stop after the plan (plan-tests, whatever the size of the scope): the job ends with the plan in the ledger, its themes and the questions to settle; nothing is written until gen.write (gen.plan revises it, gen.planSet edits it)",
        ),
      resume: z
        .string()
        .optional()
        .describe(
          "Resume a planned generation that stopped (cancelled, or a failed run): its generation id; the planned tests not written yet are written with its request and scope, the other inputs but model and effort are ignored",
        ),
    }),
    output: GEN_RESULT,
    mutates: true,
    job: "generate",
    subject: (i) => {
      const s = i.request.trim() || [...(i.docs ?? []), ...(i.sections ?? [])].join(", ");
      return s.length > 80 ? `${s.slice(0, 77)}...` : s;
    },
    label: (i, project) => {
      const l = project && i.resume?.trim() ? readLedger(project, i.resume.trim()) : null;
      const left = l?.plan?.tests ? l.plan.tests.length - new Set(l.done ?? []).size : 0;
      return genLabel(l?.input ?? i, left > 0 ? left : undefined);
    },
    async run(ctx, input) {
      return await generateTests(projectOf(ctx), input, ctx);
    },
  }),
  command({
    name: "gen.preview",
    summary:
      "What gen.tests would do with this scope, before it runs: the tests it would replace with discard (Claude's tests still awaiting review, never one pushed to Jira), and the documents in scope that are not indexed (gen.tests refuses them) or changed since their last index (it warns).",
    input: z.object({
      docs: z.array(z.string()).optional().describe("Documents in scope as a whole, by id (as for gen.tests)"),
      sections: z.array(z.string()).optional().describe("Document sections in scope, docId#§x.y (as for gen.tests)"),
      without: WITHOUT,
    }),
    output: z.object({
      replaces: z
        .array(z.string())
        .describe("The tests discard: true would delete first — generated, not validated, not in Jira"),
      searched: z.array(z.string()).describe("The converted documents the generation would search"),
      unindexed: z
        .array(z.string())
        .describe("Documents in scope search cannot find: gen.tests refuses until reindexed"),
      stale: z.array(z.string()).describe("Documents in scope changed since their last index: gen.tests warns"),
    }),
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      return { replaces: discardable(project), ...scopeIndex(project, input) };
    },
  }),
  command({
    name: "gen.show",
    summary:
      "A generation as it stands: what it was asked, when, the tests it wrote that still exist, and what it left without a test (the reason, what was searched and read, what Testimus could not confirm, the second look).",
    input: z.object({
      generation: z.string().describe("The generation id (gen.tests' generation, generated_by of its tests)"),
    }),
    output: z.object({
      generation: z.string().describe("Its id"),
      name: z.string().describe("How a person knows it: its request, else its documents, and when"),
      request: z.string().describe("The request in words it was asked (may be empty)"),
      at: z.string().optional().describe("When it started"),
      tests: z.array(z.string()).describe("The tests it wrote (and the ones a revision added) that still exist"),
      skipped: z.array(SKIPPED).describe("What it left without a test"),
      suggestions: z
        .array(
          z.object({
            label: z.string().describe("The menu entry: a verb first, a few words"),
            prompt: z.string().describe("The request it writes in Ask for changes"),
            scope: z.literal("add").optional().describe("add = new tests under the generation; absent = a change"),
          }),
        )
        .describe(
          "What Claude proposed to ask next about this generation, written at the end of its last run (empty: none yet)",
        ),
      state: z
        .literal("planned")
        .optional()
        .describe("planned: its plan waits for the user's go (gen.write); nothing is written yet"),
      plan: z
        .object({
          tests: z.array(PLANNED_TEST).describe("The planned tests, in order"),
          questions: z.array(QUESTION).describe("The questions still open"),
        })
        .optional()
        .describe("Its plan, when it was planned"),
      settled: z.array(SETTLED).describe("The plan's questions the user answered"),
      overlaps: z
        .array(
          z.object({
            tests: z.tuple([z.number(), z.number()]).describe("The two planned tests, by index in plan.tests"),
            sections: z.array(z.string()).describe("The sections both read"),
          }),
        )
        .describe("Planned tests that read the same sections (or one inside the other): they may write the same steps"),
      cost: z
        .object({
          runs: z.number().describe("Claude runs the writing takes: one per ticked test"),
          seconds: z.number().describe("Estimated duration: about 3 min 20 per test, as many at a time as the agents"),
          agents: z.number().describe("Agents at a time (Settings › Claude Code)"),
        })
        .optional()
        .describe("What writing the plan costs"),
      stale: z.array(z.string()).describe("Documents in scope changed since their last index, while the plan waits"),
      reindexSeconds: z.number().describe("About how long reindexing them takes (0: nothing to reindex)"),
      mtime: z.number().describe("The ledger's mtime: gen.planSet's ifMtime"),
    }),
    mutates: false,
    positional: ["generation"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      const l = readLedger(project, input.generation);
      if (!l?.input)
        throw new UserError(
          `No generation ${input.generation} in this project.`,
          "Its id is the generation of a gen.tests result (generated_by of its tests).",
        );
      return {
        generation: input.generation,
        name: generationName(project, input.generation),
        request: l.input.request ?? "",
        ...(l.at ? { at: l.at } : {}),
        tests: (l.tests ?? []).filter((id) => testExists(project, id)),
        skipped: inCategoryOrder(l.skipped ?? []),
        suggestions: l.suggestions ?? [],
        ...planView(project, l),
      };
    },
  }),
  command({
    name: "gen.revise",
    summary:
      "Ask again after a generation: change its tests (mode change: the edit-test skill on all of them, or the ones given) or add tests to it (mode add: a generation under the same id, told which tests it already has). Snapshotted like any generation; the changed or new tests are checked in the same job, and a test with fixable findings gets a Claude action.",
    input: z.object({
      generation: z.string().describe("The generation to ask again (gen.tests' generation)"),
      request: z.string().min(1).max(20000).describe("What should change, or which tests to add, in words"),
      mode: z
        .enum(["change", "add"])
        .default("change")
        .describe("change = edit the generation's tests; add = write more tests under the same generation"),
      tests: z
        .array(z.string())
        .optional()
        .describe("With change: only these tests of the generation (default: all of them)"),
      contexts: CONTEXT_IDS.optional().describe(
        "Saved context ids Claude reads first (default: those the generation ran with — the project's default contexts for a generation older than that record)",
      ),
      without: WITHOUT,
      note: NOTE,
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)"),
    }),
    output: GEN_RESULT.extend({
      revised: z.array(z.string()).describe("With change: the tests of the generation the run changed"),
    }),
    mutates: true,
    job: "generate",
    subject: (i) => i.generation,
    label: (i, project) =>
      `${i.mode === "add" ? "More tests for" : "Changes to"} « ${generationName(project, i.generation)} »`,
    async run(ctx, input) {
      return await reviseGeneration(projectOf(ctx), input, ctx);
    },
  }),
];
