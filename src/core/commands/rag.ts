import { z } from "zod";
import { CLAUDE_SEARCH } from "../claude/access.ts";
import { command, projectOf } from "../command.ts";
import { chunkKind, searchMode } from "../rag/schemas.ts";
import { search } from "../rag/search/hybrid.ts";
import { figure, passage } from "../rag/search/passage.ts";
import type { SearchUse } from "../types.ts";

// ponytail: rag.search asked by a person (the command line, a script on the HTTP face): the whole hybrid search, the
// active reranker included — an LLM's run gets its own line (CLAUDE_SEARCH)
export const COMMAND_SEARCH: SearchUse = {
  id: "command",
  who: "testimus rag search, from the command line",
  when: "When you run it",
  words: "always",
  embedding: "uses",
  reranker: "uses",
};

const figureEntry = z
  .object({
    file: z.string().describe("Picture file, relative to the document folder; empty when the figure is text"),
    anchor: z.string().describe("fig:<n>"),
    caption: z.string().describe("The figure's caption as the document writes it"),
    description: z.string().describe("What the figure shows, written at conversion"),
    table: z
      .string()
      .optional()
      .describe("A figure read by its anchor that captions a table of the text: that table, as doc.md writes it"),
  })
  .describe("A figure of the passage");

export const commands = [
  command({
    name: "rag.search",
    summary: "Search the project's documents (hybrid BM25 + vectors); returns passages with their anchors.",
    input: z.object({
      query: z.string().min(1).describe("What to look for: a question, a code, a device name"),
      k: z.number().int().min(1).max(50).default(10).describe("How many passages to return"),
      docIds: z.array(z.string()).optional().describe("Only search these documents"),
      mode: searchMode,
      expand: z
        .enum(["none", "section", "graph"])
        .optional()
        .describe(
          "Add related passages flagged `via`: section = parent sections and the section a figure sits in; graph = also the sections each hit cross-references or amends (default: project.json rag.retrieval.expand, else none)",
        ),
    }),
    output: z
      .array(
        z.object({
          docId: z.string().describe("Document id"),
          anchor: z.string().describe("§x.y or fig:<n>: the passage's source anchor"),
          path: z.string().describe("Section path, e.g. 5 > 5.6 > 5.6.6"),
          text: z.string().describe("The passage's text"),
          header: z.string().describe("The context line indexed with it (document, section, Claude's sentence)"),
          score: z.number().describe("Rank score (fused or reranked)"),
          kind: chunkKind,
          figure: z.string().optional().describe("For a figure: its picture, relative to the project folder"),
          via: z.enum(["section", "graph"]).optional().describe("Set when the passage was added by `expand`"),
          degraded: z
            .boolean()
            .optional()
            .describe("True when vectors were missing or incomplete and the search fell back to BM25 alone"),
        }),
      )
      .describe("Best passages first, then the ones `expand` added"),
    mutates: false,
    positional: ["query"],
    run: (ctx, input) =>
      search(projectOf(ctx), input.query, {
        ...input,
        ...(ctx.llm && CLAUDE_SEARCH.reranker === "no" ? { reranker: null } : {}),
        log: (level, m) => ctx.log(level, m),
      }),
  }),
  command({
    name: "rag.passage",
    summary:
      "Read one passage of a document by its source reference docId#anchor (§5.6.6, fig:N). A document that is not in the project fails with the code doc-gone.",
    input: z.object({
      ref: z.string().min(3).describe("Source reference docId#anchor, e.g. SOSIE_211_D401-1_3#§5.6.6 or DOC#fig:40"),
      around: z
        .string()
        .optional()
        .describe(
          "A quote to centre the capped text on (the Review panel passes the cited quote): a long section then shows the part that holds it",
        ),
    }),
    output: z.object({
      docId: z.string().describe("Document id"),
      anchor: z.string().describe("The anchor read, normalized (§x.y or fig:<n>)"),
      path: z.string().describe("Section path, e.g. 5 > 5.6 > 5.6.6"),
      title: z.string().describe("Section title, or the figure's caption"),
      text: z.string().describe("The section's text, capped at project.json rag.passageMaxChars (default 12000)"),
      truncated: z.boolean().optional().describe("True when text was cut at the cap; read the rest with readMore"),
      quoteFound: z
        .boolean()
        .optional()
        .describe("With around: whether the quote is in this passage's section (text is centred on it when it is)"),
      outline: z
        .array(
          z.object({
            anchor: z.string().describe("Anchor of the sub-section"),
            title: z.string().describe("Its title"),
            chars: z.number().describe("Its size in characters"),
            figureIds: z.array(z.string()).describe("Figure numbers it holds"),
          }),
        )
        .optional()
        .describe("When truncated: the section's sub-sections with their size and figures"),
      readMore: z
        .string()
        .optional()
        .describe("When truncated: how to read the rest (Read docs/<id>/doc.md lines a–b)"),
      figures: z.array(figureEntry).describe("The figures inside the passage"),
      doc: z
        .object({
          code: z.string().describe("Document code"),
          title: z.string().describe("Document title"),
          version: z.string().describe("Document version"),
          status: z.string().describe("draft, validated…"),
        })
        .describe("The document the passage comes from"),
    }),
    mutates: false,
    positional: ["ref"],
    run: async (ctx, input) => passage(projectOf(ctx), input.ref, input.around),
  }),
  command({
    name: "rag.figure",
    summary: "One figure of a document: its file, caption and description.",
    input: z.object({
      docId: z.string().describe("Document id (folder name under docs/)"),
      n: z.string().describe("Figure number as anchored in doc.md (40 or fig:40)"),
    }),
    output: z.object({
      docId: z.string().describe("Document id"),
      n: z.string().describe("Figure number"),
      anchor: z.string().describe("fig:<n>"),
      file: z.string().describe("Path relative to the project folder; empty when the figure has no picture"),
      absPath: z.string().describe("Absolute path of the picture; empty without one"),
      picture: z
        .boolean()
        .describe("False when the document writes the figure as text (a table, a caption): nothing to Read or embed"),
      exists: z.boolean().describe("The picture's file is on disk"),
      caption: z.string().describe("The figure's caption"),
      description: z.string().describe("What the figure shows, written at conversion"),
      path: z.string().describe("Path of the section the figure sits in"),
    }),
    mutates: false,
    positional: ["docId", "n"],
    run: async (ctx, input) => figure(projectOf(ctx), input.docId, input.n),
  }),
];
