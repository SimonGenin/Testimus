import { z } from "zod";
import { checkTests, selectTests, semanticPlan } from "../claude/check.ts";
import { CHECK_FILE, FINDING_KINDS, REVIEW, SEVERITY, TEST_REF } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { isStale, recordSemantic } from "../lib/check.ts";
import { readCheck, testExists } from "../lib/store.ts";

const counts = z.object({
  errors: z.number().describe("Errors"),
  warnings: z.number().describe("Warnings"),
  infos: z.number().describe("Infos"),
});

const tally = (fs: { severity: string }[]) => ({
  errors: fs.filter((f) => f.severity === "error").length,
  warnings: fs.filter((f) => f.severity === "warning").length,
  infos: fs.filter((f) => f.severity === "info").length,
});

const subjectOf = (i: { ids?: string[]; folder?: string; all?: boolean }) =>
  i.all ? "all tests" : [...(i.ids ?? []), ...(i.folder !== undefined ? [i.folder] : [])].join(", ") || "tests";

export const commands = [
  command({
    name: "check.run",
    summary:
      "Check tests: the mechanical pass (sources resolve, quotes found, empty or duplicated steps), then the check-test skill on each (3 in parallel); writes check.json. The check never changes a test's review state.",
    input: z.object({
      ids: z.array(z.string()).optional().describe("Test ids to check"),
      folder: z.string().optional().describe("Check every test of this Xray folder and its subfolders"),
      all: z.boolean().optional().describe("Check every test of the project"),
      semantic: z
        .boolean()
        .optional()
        .describe(
          "Also run the check-test skill through Claude (default: when Claude Code is connected); false = mechanical pass only",
        ),
    }),
    output: z.object({
      tests: z
        .array(
          z.object({
            id: z.string().describe("Test id"),
            ok: z.boolean().describe("False when its semantic check did not finish"),
            review: REVIEW,
            errors: z.number().describe("Errors found"),
            warnings: z.number().describe("Warnings found"),
            infos: z.number().describe("Infos found"),
            summary: z.string().optional().describe("Claude's one-line answer for this test"),
            runId: z.string().optional().describe("The check-test run of this test"),
          }),
        )
        .describe("Each test checked"),
      totals: counts.describe("The findings of every test checked"),
      failed: z.array(z.string()).describe("Tests whose semantic check did not finish"),
      semantic: z
        .enum(["done", "skipped"])
        .describe("Whether the check-test skill ran (done) or only the mechanical pass did (skipped)"),
      why: z.string().optional().describe("Why the semantic pass was skipped"),
    }),
    mutates: true,
    job: "check",
    subject: subjectOf,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const ids = selectTests(project, input);
      const plan = await semanticPlan(input.semantic, ctx.signal);
      if (plan.why) ctx.log("info", plan.why);
      const results = await checkTests(ctx, project, ids, plan.semantic);
      const tests = results.map((r) => ({
        id: r.id,
        ok: r.ok,
        review: r.review,
        ...tally(r.check.findings),
        ...(r.summary !== undefined ? { summary: r.summary } : {}),
        ...(r.runId ? { runId: r.runId } : {}),
      }));
      return {
        tests,
        totals: tally(results.flatMap((r) => r.check.findings)),
        failed: results.filter((r) => !r.ok).map((r) => r.id),
        semantic: plan.semantic ? ("done" as const) : ("skipped" as const),
        ...(plan.why ? { why: plan.why } : {}),
      };
    },
  }),

  command({
    name: "check.record",
    summary:
      "Record the semantic findings of one test (what the check-test skill sends): replaces the previous semantic findings, keeps the mechanical ones, stamps the current testHash.",
    input: z.object({
      id: TEST_REF,
      findings: z
        .array(
          z.object({
            step: z.number().int().min(1).optional().describe("Step number (1-based); absent for the whole test"),
            kind: z.enum(FINDING_KINDS).describe("Finding kind"),
            severity: SEVERITY,
            message: z.string().min(1).describe("One sentence in the project language naming the exact discrepancy"),
            sources: z
              .array(z.string())
              .default([])
              .describe('The anchors that prove it: docId#anchor, e.g. "SOSIE_211_D401-1_3#§5.6.6"'),
          }),
        )
        .describe("Every semantic finding of this check ([] when there is none)"),
    }),
    output: CHECK_FILE,
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!testExists(project, input.id))
        throw new UserError(`No test ${input.id} in this project.`, "testimus tests list shows the tests.");
      return recordSemantic(project, input.id, input.findings);
    },
  }),

  command({
    name: "check.show",
    summary: "The last check of a test (check.json) and whether it is stale (the test changed since).",
    input: z.object({ id: TEST_REF }),
    output: z.object({
      id: z.string().describe("Test id"),
      check: CHECK_FILE.nullable().describe("Its last check, or null when it was never checked"),
      stale: z.boolean().describe("The test changed since that check"),
    }),
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      if (!testExists(project, input.id))
        throw new UserError(`No test ${input.id} in this project.`, "testimus tests list shows the tests.");
      const check = readCheck(project, input.id);
      return { id: input.id, check, stale: isStale(project, input.id, check) };
    },
  }),
];
