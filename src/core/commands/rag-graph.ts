import { z } from "zod";
import { command, projectOf } from "../command.ts";
import { mentions } from "../rag/mentions.ts";
import { related } from "../rag/related.ts";
import { chunkKind, edgeKind } from "../rag/schemas.ts";

export const commands = [
  command({
    name: "rag.mentions",
    summary:
      "Every passage of every current document that contains a term, a code or an acronym (exact, stemmed and glossary forms, or a regex), grouped by document and section. No model, no top-k.",
    input: z.object({
      term: z.string().min(1).describe("A word, a phrase, a code, an acronym — or a regex with regex: true"),
      regex: z.boolean().default(false).describe("Treat term as a JavaScript regular expression (case-insensitive)"),
      stem: z.boolean().default(true).describe("Also match French stemmed forms (sectionneurs → sectionneur)"),
      glossary: z.boolean().default(true).describe("Also match the acronym's long form and the other way round"),
      docIds: z.array(z.string()).optional().describe("Only these documents"),
      page: z.number().int().min(1).default(1).describe("Page of sections (1-based)"),
      pageSize: z.number().int().min(1).max(200).default(50).describe("Sections per page"),
    }),
    output: z.object({
      term: z.string().describe("The term searched, as given"),
      forms: z.array(z.string()).describe("Every form searched: the term, its stem, its glossary expansions"),
      total: z.number().describe("Total hits across all documents"),
      sections: z.number().describe("Sections with at least one hit"),
      page: z.number().describe("This page (1-based)"),
      pages: z.number().describe("How many pages of sections there are"),
      docs: z
        .array(
          z.object({
            docId: z.string().describe("Document id"),
            count: z.number().describe("Hits in this document"),
            sections: z
              .array(
                z.object({
                  ref: z.string().describe("docId#anchor of the passage"),
                  path: z.string().describe("Section path"),
                  title: z.string().describe("Section title"),
                  kind: chunkKind,
                  count: z.number().describe("Hits in this passage"),
                  hits: z
                    .array(
                      z.object({
                        form: z.string().describe("The form that matched"),
                        context: z.string().describe("One line around the hit"),
                      }),
                    )
                    .describe("Each hit of the passage"),
                }),
              )
              .describe("The document's passages with hits on this page, in document order"),
          }),
        )
        .describe("Documents with hits on this page"),
    }),
    mutates: false,
    positional: ["term"],
    run: async (ctx, input) => mentions(projectOf(ctx), input),
  }),
  command({
    name: "rag.related",
    summary:
      "The graph neighbours of docId#anchor or of a document: parent section, cross-references both ways, siblings, figures, amending documents. No model.",
    input: z.object({
      ref: z.string().min(2).describe("docId#anchor (§x.y, fig:N) or a bare docId"),
      depth: z.number().int().min(1).max(2).default(1).describe("1 = direct neighbours; 2 = their neighbours too"),
    }),
    output: z.object({
      ref: z.string().describe("The reference asked, normalized"),
      neighbours: z
        .array(
          z.object({
            ref: z.string().describe("docId#anchor of the neighbour"),
            kind: edgeKind,
            direction: z.enum(["out", "in"]).describe("out = this ref → neighbour; in = neighbour → this ref"),
            title: z.string().describe("Section title or figure caption"),
            path: z.string().describe("Section path"),
            depth: z.number().describe("1 = direct neighbour; 2 = neighbour of a neighbour"),
          }),
        )
        .describe("Neighbours, amending documents first"),
      truncated: z.literal(true).optional().describe("Set when depth 2 went past 200 neighbours: the list stops there"),
      total: z.number().int().optional().describe("How many neighbours there were before the cut"),
    }),
    mutates: false,
    positional: ["ref"],
    run: async (ctx, input) => related(projectOf(ctx), input),
  }),
];
