import { z } from "zod";
import { type Command, command, projectOf } from "../command.ts";
import { removeColumn, saveColumn, stepColumns } from "../lib/columns.ts";

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
];
