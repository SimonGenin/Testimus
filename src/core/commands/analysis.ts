import { z } from "zod";
import { analyzeTest } from "../claude/analyze.ts";
import { CONTEXT_IDS, DIAGNOSIS, EFFORT, MODEL, NOTE, TEST_REF, WITHOUT } from "../claude/schemas.ts";
import { command, projectOf, UserError } from "../command.ts";
import { COLUMN_ROLES, decide, PROPOSAL_KINDS, readAnalysis, recordAnalysis, viewOf } from "../lib/analysis.ts";
import { testName } from "../lib/names.ts";
import { testExists } from "../lib/store.ts";
import { SOURCE } from "../schemas.ts";

const needTest = (project: string, id: string) => {
  if (!testExists(project, id))
    throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.", "test-gone");
};

const SOURCE_LINES = z
  .array(z.string())
  .describe(
    'Source lines as in ### Sources: docId#anchor "exact quote from doc.md", optionally ending @<column> "<item>" to back one item of a column',
  );

const COLUMN = z.object({
  name: z.string().describe("The column, as columns_list names it"),
  role: z
    .enum(COLUMN_ROLES)
    .describe(
      "keep = the team's: what is written stays word for word, Claude only adds and links; open = may be reworded where a passage says otherwise; leave = stays empty",
    ),
  why: z.string().describe("One short sentence: what in its description or its cells says so"),
});

const UNFOUND = z.object({
  step: z.number().int().min(1).describe("The step (1-based)"),
  column: z.string().describe("The column that holds it"),
  item: z.string().describe("The requirement or value, as the cell has it"),
  why: z.string().optional().describe("Where Claude looked"),
});

const PROPOSAL = z.object({
  id: z.string().describe("p1, p2… in the order Claude proposed them"),
  kind: z.enum(PROPOSAL_KINDS).describe("source, change, step (a new step) or remove"),
  title: z.string().describe("What it does, in a few words"),
  why: z.string().describe("Why, in one sentence"),
  step: z.number().optional().describe("The step it is about, numbered as when analysed"),
  after: z.number().optional().describe("A new step goes after this step (0 = first), numbered as when analysed"),
  column: z.string().optional().describe("The column a change rewrites"),
  before: z.string().optional().describe("That column's text when analysed"),
  value: z.string().optional().describe("Its new text"),
  fields: z.record(z.string(), z.string()).optional().describe("A new step's columns"),
  sources: z.array(z.string()).describe("Source lines it adds"),
  cites: z.array(SOURCE).describe("The same sources, read: document, anchor, quote, column and item"),
  state: z.enum(["open", "accepted", "rejected"]).describe("Not decided yet, accepted (in the test) or rejected"),
  decidedBy: z.string().optional().describe("Who decided"),
  decidedAt: z.string().optional().describe("When"),
  now: z.number().optional().describe("Where it lands in the test as it is now: its step, or for a new step its index"),
  stale: z.string().optional().describe("Why it no longer applies to the test as it is now"),
  drops: z
    .array(z.object({ column: z.string().describe("A column kept as written"), item: z.string().describe("The item") }))
    .optional()
    .describe("A step to remove: the items of the team's columns it takes out with it"),
});

const ANALYSIS = z.object({
  at: z.string().describe("When Claude recorded it"),
  testHash: z.string().describe("test.md (after the frontmatter) as the analysis last saw it"),
  changed: z.boolean().describe("The test changed since, outside the analysis"),
  summary: z.string().describe("Claude's reading of the test, in a few sentences"),
  columns: z.array(COLUMN).describe("How each column is treated"),
  unfound: z.array(UNFOUND).describe("Items no document holds: kept as they are"),
  steps: z
    .array(
      z.object({
        id: z.string().optional().describe("Xray step id"),
        print: z.string().describe("Its fields when analysed (to find it again)"),
        gone: z.boolean().optional().describe("Removed by an accepted proposal"),
      }),
    )
    .describe("The steps as analysed"),
  proposals: z.array(PROPOSAL).describe("Every proposal, decided or not"),
  run: z
    .object({
      runId: z.string().describe("The Claude run"),
      model: z.string().describe("Its model"),
      effort: z.string().describe("Its effort"),
      note: z.string().optional().describe("What it was asked to look at"),
    })
    .optional()
    .describe("The run that made it"),
});

export const commands = [
  command({
    name: "analysis.run",
    summary:
      "Claude reads a test against the project's documents (skill analyze-test) and records what it proposes: sources for what is right, changes, new steps, steps to remove — each decided one by one with analysis.decide. The test is never changed by the run. Replaces the test's previous analysis once Claude records a new one.",
    input: z.object({
      id: TEST_REF,
      note: NOTE.describe("What to look at especially, in plain words"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Effort level (default: project.json claude.effort)"),
      contexts: CONTEXT_IDS.optional().describe(
        "Context ids to attach (default: the test's own list, else the project's)",
      ),
      without: WITHOUT,
    }),
    output: z.object({
      ok: z.boolean().describe("Whether Claude finished and recorded its analysis"),
      runId: z.string().describe("The Claude run"),
      summary: z.string().describe("Claude's last words, or why it failed"),
      proposals: z.number().describe("How many proposals it recorded"),
      diagnosis: DIAGNOSIS.optional(),
    }),
    mutates: true,
    job: "analyze",
    positional: ["id"],
    subject: (i) => i.id,
    label: (i, project) => testName(project, i.id),
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      return await analyzeTest(ctx, project, input.id, input);
    },
  }),

  command({
    name: "analysis.record",
    summary:
      "Record Claude's analysis of a test (what the analyze-test skill sends): its reading, how it treats each column, the items no document holds, and its proposals. Every source is checked at its anchor and a column kept as written may only grow; a call with any problem records nothing and lists them all.",
    input: z.object({
      id: TEST_REF,
      summary: z
        .string()
        .min(1)
        .describe("2 to 4 sentences in the project language: how the test stands against the documents"),
      columns: z.array(COLUMN).default([]).describe("Every column that holds text, and how it is treated"),
      unfound: z.array(UNFOUND).default([]).describe("Requirements or values no document holds (kept as they are)"),
      proposals: z
        .array(
          z.object({
            kind: z
              .enum(PROPOSAL_KINDS)
              .describe(
                "source: add source lines to a step (to back its expected result or one item of a column); change: rewrite one column of a step; step: a new step; remove: take a step out",
              ),
            title: z.string().min(1).max(120).describe("What it does, in a few words, project language"),
            why: z.string().min(1).describe("Why, in one sentence, project language"),
            step: z
              .number()
              .int()
              .optional()
              .describe("source, change, remove: the step (1-based, as tests_show numbers it)"),
            after: z
              .number()
              .int()
              .optional()
              .describe("step: the new step goes after this step (0 = before step 1; default: at the end)"),
            column: z.string().optional().describe("change: the column to rewrite"),
            value: z.string().optional().describe("change: the column's whole new text"),
            fields: z
              .record(z.string(), z.string())
              .optional()
              .describe("step: the new step's columns, by name (Action and Expected Result at least)"),
            sources: SOURCE_LINES.optional(),
          }),
        )
        .describe("Every proposal, [] when the test matches the documents"),
    }),
    output: ANALYSIS.omit({ changed: true, proposals: true }).extend({
      proposals: z
        .array(PROPOSAL.omit({ now: true, stale: true, cites: true, drops: true }))
        .describe("The proposals recorded"),
    }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      return recordAnalysis(project, input.id, input);
    },
  }),

  command({
    name: "analysis.show",
    summary:
      "The last analysis of a test: Claude's reading, how each column is treated, the items no document holds, and every proposal with its state — those still to decide say where they land in the test now, or why they no longer apply.",
    input: z.object({ id: TEST_REF }),
    output: z.object({
      id: z.string().describe("Test id"),
      analysis: ANALYSIS.nullable().describe("Its last analysis, or null when it was never analysed"),
    }),
    mutates: false,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      const a = readAnalysis(project, input.id);
      return { id: input.id, analysis: a ? viewOf(project, input.id, a) : null };
    },
  }),

  command({
    name: "analysis.decide",
    summary:
      "Accept, reject or reconsider proposals of a test's analysis. accept writes them into test.md at once, in the order given (a proposal that no longer applies refuses the whole call, code stale); reject keeps one aside; reopen brings a rejected one back.",
    input: z.object({
      id: TEST_REF,
      proposals: z.array(z.string()).min(1).describe("Proposal ids (p1, p2…), as analysis.show lists them"),
      decision: z.enum(["accept", "reject", "reopen"]).describe("accept, reject or reopen"),
    }),
    output: z.object({
      analysis: ANALYSIS.describe("The analysis after the decision"),
      applied: z.array(z.string()).describe("The proposals written into the test by this call"),
    }),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      const project = projectOf(ctx);
      needTest(project, input.id);
      return decide(project, input.id, input.proposals, input.decision);
    },
  }),
];
