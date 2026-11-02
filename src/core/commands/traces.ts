import { z } from "zod";
import { proposeTrace } from "../claude/traces.ts";
import { type Command, command, projectOf, UserError } from "../command.ts";
import {
  projectTraces,
  REQUIREMENT,
  removeTrace,
  saveTrace,
  scanTrace,
  traceCoverage,
  traceViews,
} from "../lib/traces.ts";
import { MODEL } from "./claude.ts";

const TRACE = z.object({
  id: z.string().describe("Key of the tracked ids (requirement = the one the index and the check know)"),
  label: z.string().describe("What one id is called, e.g. Exigence, Code alarme"),
  patterns: z.array(z.string()).describe("JavaScript regular expressions that match one id"),
  field: z.string().describe("The Xray step column that holds the ids a step verifies"),
  ask: z.string().optional().describe("The words the team used to ask for them"),
});

const VIEW = TRACE.extend({
  origin: z
    .enum(["declared", "detected"])
    .describe("declared = in project.json.traces; detected = guessed for a project that predates tracked ids"),
  column: z.enum(["in-xray", "local"]).describe("in-xray = the step field exists in Xray; local = only in test.md"),
  found: z.number().describe("Distinct ids found in the documents"),
  docs: z.number().describe("Documents that hold at least one"),
});

const SCAN = z.object({
  total: z.number().describe("Occurrences in the documents"),
  distinct: z.number().describe("Distinct ids"),
  docs: z
    .array(z.object({ doc: z.string(), count: z.number(), distinct: z.number() }))
    .describe("Per document that holds some"),
  items: z
    .array(
      z.object({
        id: z.string(),
        doc: z.string().describe("Document of its first occurrence (empty: only in requirements.csv)"),
        anchor: z.string().describe("Section of its first occurrence, §x.y"),
        context: z.string().describe("The line it appears in, or its requirements.csv text"),
      }),
    )
    .describe("Distinct ids, first occurrence, sorted"),
});

const USE = z.object({
  test: z.string().describe("Local test folder"),
  key: z.string().optional().describe("Jira key once pushed"),
  summary: z.string().describe("Test summary"),
  steps: z.array(z.number()).describe("Step numbers (1-based) that cite the id"),
});

export const commands: Command[] = [
  command({
    name: "traces.list",
    summary:
      "The ids this project tracks in its documents (requirements, alarm codes…): each with its patterns, its step column and how many ids the documents hold.",
    input: z.object({}),
    output: z.array(VIEW),
    mutates: false,
    async run(ctx) {
      return traceViews(projectOf(ctx));
    },
  }),
  command({
    name: "traces.find",
    summary:
      "Find the ids that match patterns (or a tracked kind) in the documents — the preview before tracking them.",
    input: z.object({
      patterns: z.array(z.string()).optional().describe("Regular expressions to try (default: those of trace)"),
      trace: z.string().optional().describe("Key of a tracked kind, from traces.list"),
      doc: z.string().optional().describe("Only this document"),
      limit: z.number().int().min(0).max(5000).default(200).describe("At most this many ids in items"),
    }),
    output: SCAN,
    mutates: false,
    async run(ctx, input) {
      const project = projectOf(ctx);
      const t = input.trace ? projectTraces(project).traces.find((x) => x.id === input.trace) : undefined;
      if (input.trace && !t) throw new UserError(`No tracked ids called ${input.trace}.`, "traces.list shows them.");
      const patterns = input.patterns?.length ? input.patterns : (t?.patterns ?? []);
      return scanTrace(project, patterns, { doc: input.doc, limit: input.limit, csv: t?.id === REQUIREMENT });
    },
  }),
  command({
    name: "traces.coverage",
    summary:
      "Which tracked ids the local tests cover: each id found in the documents with the tests and steps that cite it in their column, and the ids tests cite that no document writes.",
    input: z.object({
      trace: z.string().optional().describe("Key of one tracked kind (default: every kind)"),
    }),
    output: z.array(
      z.object({
        trace: z.string().describe("Key of the tracked kind"),
        label: z.string().describe("What one id is called"),
        field: z.string().describe("The step column read"),
        total: z.number().describe("Distinct ids in the documents"),
        covered: z.number().describe("Of those, ids cited by at least one step"),
        tests: z.number().describe("Local tests that cite at least one id of this kind"),
        items: z
          .array(
            SCAN.shape.items.element.extend({
              uses: z.array(USE).describe("Tests citing it; empty = not covered"),
            }),
          )
          .describe("Every id of the documents, sorted"),
        unknown: z
          .array(z.object({ id: z.string(), uses: z.array(USE) }))
          .describe("Values in the column that are no id of the documents (typo, renamed or removed id)"),
      }),
    ),
    mutates: false,
    positional: ["trace"],
    async run(ctx, input) {
      return traceCoverage(projectOf(ctx), input.trace);
    },
  }),
  command({
    name: "traces.propose",
    summary:
      "Ask Claude what to track from a sentence (« les codes d'alarme ») — it reads the documents and proposes a name, patterns and a step column, with the preview. Nothing is saved.",
    input: z.object({
      ask: z.string().min(1).describe("What to track, in words"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
    }),
    output: z.object({
      ok: z.boolean(),
      proposal: z
        .object({ label: z.string(), patterns: z.array(z.string()), field: z.string(), why: z.string() })
        .nullable()
        .describe("Claude's proposal; null when the run failed or gave no answer block"),
      preview: SCAN.nullable().describe("What the proposed patterns find (first 12 ids)"),
      column: z.enum(["in-xray", "local"]).nullable().describe("Whether the proposed column exists in Xray"),
      summary: z.string().describe("Claude's reply"),
      costUsd: z.number().optional(),
      diagnosis: z.object({ kind: z.string(), title: z.string(), detail: z.string() }).optional(),
    }),
    mutates: false,
    job: "traces",
    positional: ["ask"],
    subject: (i) => i.ask.slice(0, 60),
    async run(ctx, input) {
      return await proposeTrace({
        project: projectOf(ctx),
        ask: input.ask,
        model: input.model,
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
  command({
    name: "traces.save",
    summary:
      "Track a kind of id (new, or change one by its key): it gets its step column in the editor, a picker in Generate and is filled by the generation.",
    input: z.object({
      id: z.string().optional().describe("Key to change; omit to add (requirement re-adds the requirements)"),
      label: z.string().describe("What one id is called, e.g. Exigence"),
      patterns: z.array(z.string()).min(1).describe("Regular expressions that match one id"),
      field: z.string().describe("Xray step column (custom step field) that holds them"),
      ask: z.string().optional().describe("The words used to ask for them, kept for the record"),
    }),
    output: z.array(TRACE),
    mutates: true,
    async run(ctx, input) {
      return saveTrace(projectOf(ctx), input);
    },
  }),
  command({
    name: "traces.remove",
    summary: "Stop tracking a kind of id. The values already written in tests stay in test.md.",
    input: z.object({ id: z.string().describe("Key from traces.list") }),
    output: z.array(TRACE),
    mutates: true,
    positional: ["id"],
    async run(ctx, input) {
      return removeTrace(projectOf(ctx), input.id);
    },
  }),
];
