import { z } from "zod";
import { type Command, command, projectOf } from "../command.ts";
import { mentions } from "../rag/mentions.ts";
import { related } from "../rag/related.ts";
import { chunkKind } from "./rag.ts";

const edgeKind = z.enum(["defines", "traces", "mentions", "refers", "parent", "sibling", "shows", "amends"]);

export const commands: Command[] = [
  command({
    name: "rag.mentions",
    summary:
      "Every passage of every current document that contains a term, an id or an acronym (exact, stemmed and glossary forms, or a regex), grouped by document and section. No model, no top-k.",
    input: z.object({
      term: z.string().min(1).describe("A word, a phrase, a requirement id, an acronym — or a regex with regex: true"),
      regex: z.boolean().default(false).describe("Treat term as a JavaScript regular expression (case-insensitive)"),
      stem: z.boolean().default(true).describe("Also match French stemmed forms (sectionneurs → sectionneur)"),
      glossary: z.boolean().default(true).describe("Also match the acronym's long form and the other way round"),
      docIds: z.array(z.string()).optional().describe("Only these documents"),
      includeSuperseded: z.boolean().default(false).describe("Also search superseded documents"),
      page: z.number().int().min(1).default(1).describe("Page of sections (1-based)"),
      pageSize: z.number().int().min(1).max(200).default(50).describe("Sections per page"),
    }),
    output: z.object({
      term: z.string(),
      forms: z.array(z.string()).describe("Every form searched: the term, its stem, its glossary expansions"),
      total: z.number().describe("Total hits across all documents"),
      sections: z.number().describe("Sections with at least one hit"),
      page: z.number(),
      pages: z.number(),
      docs: z.array(
        z.object({
          docId: z.string(),
          count: z.number(),
          sections: z.array(
            z.object({
              ref: z.string().describe("docId#anchor of the passage"),
              path: z.string(),
              title: z.string(),
              kind: chunkKind,
              count: z.number(),
              hits: z.array(z.object({ form: z.string(), context: z.string().describe("One line around the hit") })),
            }),
          ),
        }),
      ),
    }),
    mutates: false,
    positional: ["term"],
    run: async (ctx, input) => mentions(projectOf(ctx), input),
  }),
  command({
    name: "rag.related",
    summary:
      "The graph neighbours of docId#anchor or of a requirement id: statement, defining and traced sections, requirements mentioned, cross-references both ways, siblings, figures, amending documents. No model.",
    input: z.object({
      ref: z.string().min(2).describe("docId#anchor (§x.y, req:ID, fig:N) or a bare requirement id"),
      depth: z.number().int().min(1).max(2).default(1).describe("1 = direct neighbours; 2 = their neighbours too"),
    }),
    output: z.object({
      ref: z.string(),
      statement: z
        .object({ id: z.string(), source: z.enum(["body", "matrix"]), section: z.string(), text: z.string() })
        .optional()
        .describe("For a requirement: the text that defines it"),
      neighbours: z.array(
        z.object({
          ref: z.string(),
          kind: edgeKind,
          direction: z.enum(["out", "in"]).describe("out = this ref → neighbour; in = neighbour → this ref"),
          title: z.string(),
          path: z.string(),
          depth: z.number(),
        }),
      ),
      warnings: z.array(z.string()).describe("E.g. a traced section that differs from the defining one"),
    }),
    mutates: false,
    positional: ["ref"],
    run: async (ctx, input) => related(projectOf(ctx), input),
  }),
];
