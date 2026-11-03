import { z } from "zod";
import { checkTests, promoteChecked } from "../claude/check.ts";
import { type Command, command, projectOf, UserError } from "../command.ts";
import { isStale, recordSemantic } from "../lib/check.ts";
import { listLocalTests, readCheck, testExists } from "../lib/store.ts";
import type { FindingKind } from "../types.ts";

export const KINDS: [FindingKind, ...FindingKind[]] = [
  "source-missing",
  "quote-not-found",
  "unsupported",
  "contradicted",
  "wrong-requirement",
  "requirement-unknown",
  "requirement-not-covered",
  "wrong-object",
  "negative-missing",
  "case-missing",
  "not-simulated-unsourced",
  "vague-result",
  "documents-conflict",
  "empty-field",
  "raw-embed",
  "duplicate-step",
  "figure-not-embedded",
  "other",
];

const id = z.string().describe("Test id: the folder under tests/ — a Jira key (LFRPS12-1420) or local-<8hex>");
const severity = z.enum(["error", "warning", "info"]);

export const finding = z.object({
  step: z.number().int().min(1).optional(),
  kind: z.enum(KINDS),
  severity,
  message: z.string(),
  sources: z.array(z.string()),
  pass: z.enum(["mechanical", "semantic"]).optional(),
});

export const checkFile = z.object({ at: z.string(), testHash: z.string(), findings: z.array(finding) });

const counts = z.object({ errors: z.number(), warnings: z.number(), infos: z.number() });

const tally = (fs: { severity: string }[]) => ({
  errors: fs.filter((f) => f.severity === "error").length,
  warnings: fs.filter((f) => f.severity === "warning").length,
  infos: fs.filter((f) => f.severity === "info").length,
});

const inFolder = (folder: string, f: string) => {
  const root = f.replace(/\/+$/, "");
  return folder === root || folder.startsWith(`${root}/`) || root === "";
};

export function selectTests(project: string, input: { ids?: string[]; folder?: string; all?: boolean }): string[] {
  const tests = listLocalTests(project);
  if (input.all) return tests.map((t) => t.id);
  if (!input.ids?.length && input.folder === undefined)
    throw new UserError("Say which tests to check.", "Pass ids, a folder (--folder /Traction) or --all.");
  const out = new Set<string>();
  for (const t of input.ids ?? []) {
    if (!testExists(project, t))
      throw new UserError(`No test ${t} in this project.`, "testimus tests list shows the tests.");
    out.add(t);
  }
  if (input.folder !== undefined) {
    const f = input.folder;
    const hit = tests.filter((t) => inFolder(t.folder, f));
    if (!hit.length && !out.size)
      throw new UserError(`No test in the folder ${f}.`, "testimus tests list shows the tests and their folders.");
    for (const t of hit) out.add(t.id);
  }
  return [...out];
}

const subjectOf = (i: { ids?: string[]; folder?: string; all?: boolean }) =>
  i.all ? "all tests" : [...(i.ids ?? []), ...(i.folder !== undefined ? [i.folder] : [])].join(", ") || "tests";

export const commands: Command[] = [
  command({
    name: "check.run",
    summary:
      "Check tests: the mechanical pass (sources resolve, quotes found, requirement ids exist, empty or duplicated steps), then the check-test skill on each (3 in parallel); writes check.json. A draft test becomes checked.",
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
      id,
      findings: z
        .array(
          z.object({
            step: z.number().int().min(1).optional().describe("Step number (1-based); absent for the whole test"),
            kind: z.enum(KINDS).describe("Finding kind (SPEC §8)"),
            severity: severity.describe(
              "error = a tester would pass a wrong behavior or fail a right one; warning = gap or vague; info otherwise",
            ),
            message: z.string().min(1).describe("One sentence in the project language naming the exact discrepancy"),
            sources: z
              .array(z.string())
              .default([])
              .describe('The anchors that prove it: docId#anchor, e.g. "SOSIE_211_D401-1_3#§5.6.6"'),
          }),
        )
        .describe("Every semantic finding of this check ([] when there is none)"),
    }),
    output: checkFile,
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
    input: z.object({ id }),
    output: z.object({ id: z.string(), check: checkFile.nullable(), stale: z.boolean() }),
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
