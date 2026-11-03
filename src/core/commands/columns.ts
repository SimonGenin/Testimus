import { z } from "zod";
import { suggestColumns } from "../claude/columns.ts";
import { MODEL } from "../claude/schemas.ts";
import { command, projectOf } from "../command.ts";
import { removeColumn, saveColumn, setModes, setOrder, stepColumns } from "../lib/columns.ts";
import { COLUMN_SHOW, STEP_COLUMN } from "../schemas.ts";

const SHOW = COLUMN_SHOW;
const column = STEP_COLUMN;

export const commands = [
  command({
    name: "columns.list",
    summary:
      "The step columns of the project in display order: Xray's step fields and the local ones, each a smart column with the description Claude follows to fill it.",
    input: z.object({}),
    output: z.array(column),
    mutates: false,
    run: async (ctx) => stepColumns(projectOf(ctx)),
  }),
  command({
    name: "columns.save",
    summary:
      "Describe a smart column (what Claude writes in it) and whether its items link to their sources, or add a local smart column (kept in test.md, never pushed).",
    input: z.object({
      name: z.string().min(1).describe("Column name: an Xray step field, a local column, or a new local column"),
      description: z
        .string()
        .optional()
        .describe("What Claude writes in it, in plain words; empty = Claude never fills the column; omitted = kept"),
      referenceSource: z
        .boolean()
        .optional()
        .describe(
          'Reference source: Claude cites the passage of each item it writes in the column (@<column> "<item>"), the check asks for it and the editor links the item to it; omitted = kept',
        ),
    }),
    output: z.array(column),
    mutates: true,
    positional: ["name"],
    run: async (ctx, input) => saveColumn(projectOf(ctx), input),
  }),
  command({
    name: "columns.setModes",
    summary:
      "Set how step columns show in every test of the project (columns.json): open, filled, collapsed or hidden; the columns not named keep theirs. A test can fold its own way (tests.setFolds).",
    input: z.object({
      modes: z.record(z.string(), SHOW).describe("Mode by column name (columns.list gives the names)"),
    }),
    output: z.array(column),
    mutates: true,
    run: async (ctx, input) => setModes(projectOf(ctx), input.modes),
  }),
  command({
    name: "columns.order",
    summary: "Put the step columns in this order (columns.json); the columns not named follow in their current order.",
    input: z.object({ names: z.array(z.string()).describe("Column names, first to last") }),
    output: z.array(column),
    mutates: true,
    run: async (ctx, input) => setOrder(projectOf(ctx), input.names),
  }),
  command({
    name: "columns.remove",
    summary:
      "Remove a local step column (the text tests hold in it stays in test.md); an Xray step field can only be hidden.",
    input: z.object({ name: z.string().min(1).describe("Name of the local column") }),
    output: z.array(column),
    mutates: true,
    positional: ["name"],
    run: async (ctx, input) => removeColumn(projectOf(ctx), input.name),
  }),
  command({
    name: "columns.suggest",
    summary:
      "Ask Claude what each step column should hold — it reads the columns, Xray's step fields, the tests, the documents and the contexts, and proposes descriptions or new local columns. Nothing is saved: apply a proposal with columns.save.",
    input: z.object({
      ask: z.string().default("").describe("What the team wants from the columns, in words; empty = review them all"),
      contexts: z
        .array(z.string().regex(/^[\w-]+$/))
        .default([])
        .describe("Saved contexts (contexts.list ids) to read, on top of the project's"),
      model: MODEL.optional().describe("Model alias or name (default: project.json claude.model)"),
    }),
    output: z.object({
      ok: z.boolean().describe("false when the run failed or gave no columns block"),
      proposals: z
        .array(
          z.object({
            name: z.string().describe("The column: an existing one, or a new local column"),
            kind: z
              .enum(["xray", "local", "new"])
              .describe("xray: a step field of Xray; local: in test.md only; new: a local column to add"),
            builtin: z.boolean().describe("Action, Data or Expected Result"),
            current: z.string().nullable().describe("Its description today; null for a new column"),
            description: z.string().describe("The proposed description; empty = Claude never fills the column"),
            why: z.string().describe("Why, in one sentence, from what Claude read"),
          }),
        )
        .describe("Only the columns Claude would change or add"),
      summary: z.string().describe("Claude's reply"),
      costUsd: z.number().optional().describe("What the Claude run cost"),
      diagnosis: z
        .object({
          kind: z.string().describe("What went wrong, as a stable name"),
          title: z.string().describe("What went wrong, in words"),
          detail: z.string().describe("What to do about it"),
        })
        .optional()
        .describe("Why the run failed, when it did"),
    }),
    mutates: false,
    job: "columns",
    positional: ["ask"],
    subject: (i) => i.ask.slice(0, 60) || "Every column",
    async run(ctx, input) {
      return await suggestColumns({
        project: projectOf(ctx),
        ask: input.ask,
        contexts: input.contexts,
        model: input.model,
        signal: ctx.signal,
        onEvent: (e) => ctx.claude(e),
      });
    },
  }),
];
