import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describeFigures } from "../claude/figures.ts";
import { generateTests } from "../claude/generate.ts";
import { claudeHeaders } from "../claude/headers.ts";
import { type Command, command, projectOf } from "../command.ts";
import { hooks } from "../rag/chunk.ts";
import { CONTEXT_IDS, EFFORT, MODEL, NOTE } from "./claude.ts";

// ponytail: installed once for every face; it does nothing unless the project turned rag.claudeHeaders on
hooks.describeChunks = claudeHeaders;

const DIAGNOSIS = z.object({
  kind: z.enum(["connect", "login", "credit", "limit", "network", "other"]),
  title: z.string(),
  detail: z.string(),
});

export const commands: Command[] = [
  command({
    name: "gen.tests",
    summary:
      "Generate draft tests from the documents with Claude (generate-tests skill): every expected result sourced, gaps reported. A scope too large for one run is planned first (plan-tests skill), then written one run per test.",
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
    }),
    output: z.object({
      runId: z.string().describe("Claude run id — claude.revert removes the tests it wrote"),
      ok: z.boolean(),
      summary: z.string().describe("Claude's final reply"),
      tests: z.array(z.string()).describe("Ids of the new tests (review: draft, generated_by: this job)"),
      checks: z
        .array(
          z.object({
            id: z.string(),
            ok: z.boolean(),
            review: z.string(),
            errors: z.number(),
            warnings: z.number(),
          }),
        )
        .describe("The check of each new test (empty with check: false)"),
      changed: z.array(z.string()).describe("Existing tests the run changed although it should not have"),
      discarded: z.array(z.string()).describe("Tests deleted before the run (discard: true)"),
      skipped: z
        .array(z.object({ item: z.string(), why: z.string() }))
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
          "Tests written from a plan (plan-tests skill), one Claude run each, when the scope was too large for one run; 0 otherwise",
        ),
      costUsd: z.number().optional(),
      tokens: z
        .object({ input: z.number(), output: z.number() })
        .optional()
        .describe("Tokens the run used (input incl. cache)"),
      durationMs: z.number(),
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
      docs: z.array(
        z.object({
          docId: z.string(),
          figures: z.number(),
          described: z.number(),
          missing: z.array(z.string()).describe("Figure anchors Claude gave no description for"),
          runIds: z.array(z.string()),
          costUsd: z.number(),
        }),
      ),
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
