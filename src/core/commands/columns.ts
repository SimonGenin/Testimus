import { z } from "zod";
import { suggestColumns } from "../claude/columns.ts";
import { type Command, command, projectOf } from "../command.ts";
import { removeColumn, saveColumn, stepColumns } from "../lib/columns.ts";
import { MODEL } from "./claude.ts";

const column = z.object({
  name: z.string(),
  origin: z.enum(["xray", "local"]).describe("xray: a step field of Xray, pushed; local: kept in test.md only"),
  builtin: z.boolean().describe("Action, Data or Expected Result"),
  status: z
    .enum(["ok", "new", "gone"])
    .describe("new: added in Xray and never described here; gone: was in Xray, no longer — now local"),
  description: z.string().describe("What Claude writes in it (a smart column); empty = Claude leaves it empty"),
});

export const commands: Command[] = [
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
      "Describe a smart column (what Claude writes in it), or add a local smart column (kept in test.md, never pushed).",
    input: z.object({
      name: z.string().min(1).describe("Column name: an Xray step field, a local column, or a new local column"),
      description: z
        .string()
        .default("")
        .describe("What Claude writes in it, in plain words; empty = Claude never fills the column"),
    }),
    output: z.array(column),
    mutates: true,
    positional: ["name"],
    run: async (ctx, input) => saveColumn(projectOf(ctx), input),
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
      costUsd: z.number().optional(),
      diagnosis: z.object({ kind: z.string(), title: z.string(), detail: z.string() }).optional(),
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
