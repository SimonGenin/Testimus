import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describeFigures } from "../claude/figures.ts";
import { scopeIndex } from "../claude/gen-prompt.ts";
import { discardable, generateTests } from "../claude/generate.ts";
import { CONTEXT_IDS, DIAGNOSIS, EFFORT, MODEL, NOTE, TOKENS } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";

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
          "Check the new tests in the same job: mechanical + check-test skill; a draft that passes becomes checked (default true); false = mechanical only",
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
    output: z.object({
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
        .array(z.object({ item: z.string().describe("What was asked"), why: z.string().describe("Why no test") }))
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
        .describe(
          "The generation id: generated_by of its tests, its ledger .testimus/gen/<id>.json, what resume takes",
        ),
      remaining: z
        .number()
        .describe("Planned tests not written (cancelled, or a failed run), also listed in skipped: resume writes them"),
      costUsd: z.number().optional().describe("What the runs cost"),
      tokens: TOKENS.optional(),
      durationMs: z.number().describe("How long the generation took"),
      diagnosis: DIAGNOSIS.optional(),
    }),
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
    name: "docs.describeFigures",
    summary:
      "Have Claude describe the figures of a document (or of every document) in figures.json, for search and review.",
    input: z.object({
      docId: z.string().optional().describe("Document id (folder under docs/); default: every document"),
      force: z.boolean().default(false).describe("Describe again the figures that already have a description"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Effort level (default: low)"),
    }),
    output: z.object({
      docs: z
        .array(
          z.object({
            docId: z.string().describe("The document"),
            figures: z.number().describe("Its figures"),
            described: z.number().describe("Figures with a description now"),
            missing: z.array(z.string()).describe("Figure anchors Claude gave no description for"),
            runIds: z.array(z.string()).describe("The Claude runs"),
            costUsd: z.number().describe("What they cost"),
          }),
        )
        .describe("Each document looked at"),
    }),
    mutates: true,
    job: "describe-figures",
    subject: (i) => i.docId ?? "all documents",
    async run(ctx, input) {
      const project = projectOf(ctx);
      const root = join(project, "docs");
      const ids = input.docId
        ? [input.docId]
        : existsSync(root)
          ? readdirSync(root).filter((d) => existsSync(join(root, d, "doc.md")))
          : [];
      const docs = [];
      for (const id of ids) {
        if (ctx.signal.aborted) break;
        docs.push(
          await describeFigures(project, id, ctx, { force: input.force, model: input.model, effort: input.effort }),
        );
      }
      return { docs };
    },
  }),
];
