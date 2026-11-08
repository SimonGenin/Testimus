import { z } from "zod";
import { llmSearch } from "../claude/access.ts";
import { command, projectOf } from "../command.ts";
import { searchAll } from "../search/all.ts";
import { embedTests } from "../search/vectors.ts";
import { REVIEWS, type Review, type SearchKind } from "../types.ts";

const kind = z
  .enum(["test", "document", "passage"] as [SearchKind, ...SearchKind[]])
  .describe("test, document or passage");
const mark = z.tuple([z.number(), z.number()]).describe("[start, end) of a match");

export const commands = [
  command({
    name: "search.all",
    summary:
      "Search everywhere: tests (their words and their meaning), documents and document passages, ranked, with the matching text.",
    input: z.object({
      query: z
        .string()
        .describe(
          'What to look for. Words match accents, French word forms, prefixes and typos; "exact phrase"; -word excludes; filters: in:tests|reqs|docs|passages, review:draft|to-fix|validated, label:x, folder:x, sync:local|modified|synced, has:findings|sources|key|images|note, is:generated|awaiting|dirty, doc:x. A filter alone lists the tests it keeps.',
        ),
      in: z.array(kind).optional().describe("Only these kinds of results (the query's in: filters add to it)"),
      k: z.number().int().min(1).max(500).default(8).describe("At most this many results of each kind"),
      meaning: z
        .boolean()
        .default(true)
        .describe(
          "Also search by meaning (the project's embedding model on tests, hybrid search on passages); false = words only, faster",
        ),
    }),
    output: z.object({
      hits: z
        .array(
          z.object({
            kind,
            id: z.string().describe("Test id, document id, or docId#anchor for a passage"),
            title: z.string().describe("What to show first: summary, document title, section"),
            titleMarks: z.array(mark).describe("[start, end) ranges of title that match the query"),
            detail: z.string().optional().describe("Second line: key and folder, document and section"),
            snippet: z.string().optional().describe("The matching text, cut around the first match"),
            marks: z.array(mark).describe("[start, end) ranges of snippet that match the query"),
            where: z.string().optional().describe("For a test: where the snippet comes from (Step 3 · Action)"),
            score: z.number().describe("Rank score inside its kind"),
            why: z
              .enum(["words", "meaning", "both", "filter"])
              .describe("Found by its words, by its meaning, both, or listed by a filter alone"),
            testId: z.string().optional().describe("For a test: its id (folder name)"),
            key: z.string().optional().describe("For a test: its Jira key once pushed"),
            review: z
              .enum(REVIEWS as [Review, ...Review[]])
              .optional()
              .describe("For a test: its review state"),
            awaiting: z.boolean().optional().describe("A generated test still waiting for review (opens in Review)"),
            step: z.number().optional().describe("Step number (1-based) the snippet comes from"),
            docId: z.string().optional().describe("For a document or a passage: the document id"),
            anchor: z.string().optional().describe("§5.6.6, fig:<n> or page:<n>"),
          }),
        )
        .describe("Results grouped by kind, in the order of `order`"),
      totals: z.record(z.string(), z.number()).describe("How many results each kind had before the cut at k"),
      order: z.array(kind).describe("Kinds in the order they are shown: an exact key or id puts its kind first"),
      meaning: z
        .enum(["on", "off", "unavailable"])
        .describe("Whether search by meaning took part (unavailable: no embedding model on this PC)"),
      unembedded: z
        .number()
        .describe("Tests without a vector yet, left out of the search by meaning: run search.index"),
      notes: z.array(z.string()).describe("What fell back and why"),
      filters: z
        .array(
          z.object({
            token: z.string().describe("The key:value as it is written in the query"),
            key: z.string().describe("The filter: in, review, sync, has, is, label, folder or doc"),
            value: z.string().describe("The value it keeps (to-fix, /Traction…), or as typed when not known"),
            known: z.boolean().describe("false: the key is a filter's but the value is not one it takes (left out)"),
          }),
        )
        .describe("The key:value filters read in the query"),
      words: z.string().describe("The query without its filters: what was searched as words"),
      suggest: z
        .object({
          token: z.string().describe("The key:value being typed at the end of the query"),
          key: z.string().describe("Its filter"),
          values: z
            .array(
              z.object({
                value: z.string().describe("A value this filter takes that holds what is typed so far"),
                count: z.number().optional().describe("How many tests it keeps (filters on tests)"),
              }),
            )
            .describe("At most 8, the ones that keep the most tests first"),
        })
        .optional()
        .describe("When the query ends with a filter being typed (« label: », « review:to »): what it can be"),
    }),
    mutates: false,
    positional: ["query"],
    run: (ctx, input) => searchAll(projectOf(ctx), input, llmSearch(ctx.llm)),
  }),
  command({
    name: "search.index",
    summary: "Embed the project's tests with the embedding model, so search.all also finds tests by their meaning.",
    input: z.object({}),
    output: z.object({
      model: z.string().describe("Embedding model used, empty without one"),
      embedded: z.number().describe("Tests embedded by this run (new or changed since the last one)"),
      total: z.number().describe("Tests in the project"),
      degraded: z.string().optional().describe("Why nothing was embedded"),
    }),
    mutates: true,
    job: "search-index",
    subject: () => "tests",
    run: (ctx) => embedTests(projectOf(ctx), ctx),
  }),
];
