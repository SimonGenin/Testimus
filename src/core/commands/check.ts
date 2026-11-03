import { z } from "zod";
import { checkTests, promoteChecked, selectTests } from "../claude/check.ts";
import { CHECK_FILE, FINDING_KINDS, SEVERITY, TEST_REF } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { isStale, recordSemantic } from "../lib/check.ts";
import { readCheck, testExists } from "../lib/store.ts";

const counts = z.object({ errors: z.number(), warnings: z.number(), infos: z.number() });

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
      "Check tests: the mechanical pass (sources resolve, quotes found, empty or duplicated steps), then the check-test skill on each (3 in parallel); writes check.json. A draft test becomes checked.",
    input: z.object({
      ids: z.array(z.string()).optional().describe("Test ids to check"),
      folder: z.string().optional().describe("Check every test of this Xray folder and its subfolders"),
      all: z.boolean().optional().describe("Check every test of the project"),
      semantic: z
        .boolean()
        .default(true)
        .describe("Also run the check-test skill through Claude (default true); false = mechanical pass only"),
    }),
    output: z.object({
      tests: z.array(
        z.object({
          id: z.string(),
          ok: z.boolean(),
          review: z.string(),
          errors: z.number(),
          warnings: z.number(),
          infos: z.number(),
          summary: z.string().optional(),
          runId: z.string().optional(),
        }),
      ),
      totals: counts,
      failed: z.array(z.string()),
    }),
    mutates: true,
    job: "check",
    subject: subjectOf,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const ids = selectTests(project, input);
      // ponytail: called from inside a Claude run (the .mcp.json env says so), Claude is the semantic checker
      const nested = !!process.env.TESTIMUS_IN_CLAUDE && input.semantic;
      if (nested) ctx.log("info", "Called from a Claude run: mechanical pass only.");
      const results = await checkTests(ctx, project, ids, input.semantic && !nested);
      const tests = results.map((r) => {
        const review = promoteChecked(ctx, project, r);
        return {
          id: r.id,
          ok: r.ok,
          review,
          ...tally(r.check.findings),
          ...(r.summary !== undefined ? { summary: r.summary } : {}),
          ...(r.runId ? { runId: r.runId } : {}),
        };
      });
      return {
        tests,
        totals: tally(results.flatMap((r) => r.check.findings)),
        failed: results.filter((r) => !r.ok).map((r) => r.id),
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
            kind: z.enum(FINDING_KINDS).describe("Finding kind (SPEC §8)"),
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
    output: z.object({ id: z.string(), check: CHECK_FILE.nullable(), stale: z.boolean() }),
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
