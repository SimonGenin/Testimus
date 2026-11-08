import { z } from "zod";
import { scopeIndex } from "../claude/gen-prompt.ts";
import { reviseGeneration } from "../claude/gen-revise.ts";
import { discardable, generateTests } from "../claude/generate.ts";
import { readLedger } from "../claude/ledger.ts";
import { CONTEXT_IDS, DIAGNOSIS, EFFORT, MODEL, NOTE, TOKENS } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { generationName } from "../lib/names.ts";
import { testExists } from "../lib/store.ts";

const GEN_RESULT = z.object({
  runId: z.string().describe("Claude run id — claude.revert removes the tests it wrote"),
  ok: z.boolean().describe("Whether the generation finished"),
  summary: z.string().describe("Claude's final reply"),
  tests: z.array(z.string()).describe("Ids of the new tests (review: draft, generated_by: this job)"),
  checks: z
    .array(
      z.object({
        id: z.string().describe("Test id"),
        ok: z.boolean().describe("False when its semantic check did not finish"),
        review: z.string().describe("Its review state after the check"),
        errors: z.number().describe("Errors found"),
        warnings: z.number().describe("Warnings found"),
      }),
    )
    .describe("The check of each new test (empty with check: false)"),
  changed: z.array(z.string()).describe("Existing tests the run changed although it should not have"),
  discarded: z.array(z.string()).describe("Tests deleted before the run (discard: true)"),
  skipped: z
    .array(
      z.object({
        item: z.string().describe("What was asked"),
        category: z
          .string()
          .describe(
            "Why no test, in a few words Claude chose for this generation (no fixed list; the same words for items of the same nature; « Other » when the report gave none) — the page groups by it",
          ),
        why: z
          .string()
          .describe("Why no test for this item, concretely: which source is missing, what the documents say"),
        sources: z
          .array(z.string())
          .optional()
          .describe('The passages that ask for it, docId#anchor "quote" as a step source'),
      }),
    )
    .describe("What the request asked for that no test could be written for, and why"),
  reportFound: z.boolean().describe("Whether Claude's reply carried the gen-report block"),
  consulted: z
    .number()
    .describe(
      "How many passages (docId#anchor) the run actually opened, read from its tool calls; the list is in .testimus/gen/<job>.json",
    ),
  planned: z
    .number()
    .describe(
      "Tests written from a plan (plan-tests skill), one Claude run each, several at a time, when the request took more than one test; 0 otherwise",
    ),
  generation: z
    .string()
    .describe("The generation id: generated_by of its tests, its ledger .testimus/gen/<id>.json, what resume takes"),
  remaining: z
    .number()
    .describe("Planned tests not written (cancelled, or a failed run), also listed in skipped: resume writes them"),
  costUsd: z.number().optional().describe("What the runs cost"),
  tokens: TOKENS.optional(),
  durationMs: z.number().describe("How long the generation took"),
  diagnosis: DIAGNOSIS.optional(),
});

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
      "A generation as it stands: what it was asked, when, the tests it wrote that still exist, and what it could not write (with Claude's category and why).",
    input: z.object({
      generation: z.string().describe("The generation id (gen.tests' generation, generated_by of its tests)"),
    }),
    output: z.object({
      generation: z.string().describe("Its id"),
      name: z.string().describe("How a person knows it: its request, else its documents, and when"),
      request: z.string().describe("The request in words it was asked (may be empty)"),
      at: z.string().optional().describe("When it started"),
      tests: z.array(z.string()).describe("The tests it wrote (and the ones a revision added) that still exist"),
      skipped: z
        .array(
          z.object({
            item: z.string().describe("What was asked"),
            category: z.string().describe("Why no test, in Claude's few words"),
            why: z.string().describe("Why no test for this item, concretely"),
          }),
        )
        .describe("What it could not write a test for"),
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
        skipped: (l.skipped ?? []).map(({ item, category, why }) => ({ item, category, why })),
      };
    },
  }),
  command({
    name: "gen.revise",
    summary:
      "Ask again after a generation: change its tests (mode change: the edit-test skill on all of them, or the ones given) or add tests to it (mode add: a generation under the same id, told which tests it already has). Snapshotted like any generation; the changed or new tests are checked, and their findings and what could not be written become Claude actions.",
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
      contexts: CONTEXT_IDS.optional().describe("Saved context ids Claude reads first (default: as the generation)"),
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
