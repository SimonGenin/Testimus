import { z } from "zod";
import { type Command, command, projectOf } from "../command.ts";
import { search } from "../rag/search/hybrid.ts";
import { figure, passage } from "../rag/search/passage.ts";

export const mode = z
  .enum(["hybrid", "bm25", "vector"])
  .default("hybrid")
  .describe("hybrid = BM25 + vectors fused by RRF; bm25 or vector alone to compare");

export const chunkKind = z.enum(["section", "figure", "matrix-row"]);

const figureEntry = z.object({ file: z.string(), anchor: z.string(), caption: z.string(), description: z.string() });

export const commands: Command[] = [
  command({
    name: "rag.search",
    summary: "Search the project's documents (hybrid BM25 + vectors); returns passages with their anchors.",
    input: z.object({
      query: z.string().min(1).describe("What to look for: a question, a requirement id, a device name"),
      k: z.number().int().min(1).max(50).default(10).describe("How many passages to return"),
      docIds: z.array(z.string()).optional().describe("Only search these documents"),
      includeSuperseded: z.boolean().default(false).describe("Also return passages of superseded documents"),
      mode,
      expand: z
        .enum(["none", "section", "graph"])
        .optional()
        .describe(
          "Add related passages flagged `via`: section = parent and traced sections; graph = also the statements of the requirements in each hit (default: project.json rag.retrieval.expand, else none)",
        ),
    }),
    output: z.array(
      z.object({
        docId: z.string(),
        anchor: z.string(),
        path: z.string(),
        text: z.string(),
        header: z.string(),
        score: z.number(),
        kind: chunkKind,
        figure: z.string().optional(),
        via: z.enum(["section", "graph"]).optional().describe("Set when the passage was added by `expand`"),
        degraded: z
          .boolean()
          .optional()
          .describe("True when vectors were missing or incomplete and the search fell back to BM25 alone"),
      }),
    ),
    mutates: false,
    positional: ["query"],
    run: (ctx, input) => search(projectOf(ctx), input.query, input),
  }),
  command({
    name: "rag.passage",
    summary: "Read one passage of a document by its source reference docId#anchor (§5.6.6, req:ID, fig:N).",
    input: z.object({
      ref: z.string().min(3).describe("Source reference docId#anchor, e.g. SOSIE_211_D401-1_3#§5.6.6 or DOC#req:EXI_…"),
    }),
    output: z.object({
      docId: z.string(),
      anchor: z.string(),
      path: z.string(),
      title: z.string(),
      text: z.string().describe("The section's text, capped at project.json rag.passageMaxChars (default 12000)"),
      focus: z.string().optional().describe("For req: anchors, the requirement's statement (never the id alone)"),
      truncated: z.boolean().optional().describe("True when text was cut at the cap; read the rest with readMore"),
      outline: z
        .array(
          z.object({
            anchor: z.string(),
            title: z.string(),
            chars: z.number(),
            reqIds: z.array(z.string()),
            figureIds: z.array(z.string()),
          }),
        )
        .optional()
        .describe("When truncated: the section's sub-sections with their size, requirement ids and figures"),
      readMore: z
        .string()
        .optional()
        .describe("When truncated: how to read the rest (Read docs/<id>/doc.md lines a–b)"),
      figures: z.array(figureEntry),
      doc: z.object({
        code: z.string(),
        title: z.string(),
        version: z.string(),
        status: z.string(),
        binding: z.string(),
      }),
    }),
    mutates: false,
    positional: ["ref"],
    run: async (ctx, input) => passage(projectOf(ctx), input.ref),
  }),
  command({
    name: "rag.figure",
    summary: "One figure of a document: its file, caption and description.",
    input: z.object({
      docId: z.string().describe("Document id (folder name under docs/)"),
      n: z.string().describe("Figure number as anchored in doc.md (40 or fig:40)"),
    }),
    output: z.object({
      docId: z.string(),
      n: z.string(),
      anchor: z.string(),
      file: z.string().describe("Path relative to the project folder"),
      absPath: z.string(),
      exists: z.boolean(),
      caption: z.string(),
      description: z.string(),
      path: z.string(),
    }),
    mutates: false,
    positional: ["docId", "n"],
    run: async (ctx, input) => figure(projectOf(ctx), input.docId, input.n),
  }),
];
