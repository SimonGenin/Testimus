import { z } from "zod";
import { type Command, command, projectOf } from "../command.ts";
import { searchAll } from "../search/all.ts";
import { embedTests } from "../search/vectors.ts";
import { REVIEWS, type Review, type SearchKind } from "../types.ts";

const kind = z.enum(["test", "document", "passage"] as [SearchKind, ...SearchKind[]]);
const mark = z.tuple([z.number(), z.number()]);

export const commands: Command[] = [
  command({
    name: "search.all",
    summary:
      "Search everywhere: tests (their words and their meaning), documents and document passages, ranked, with the matching text.",
    input: z.object({
      query: z
        .string()
        .describe(
          'What to look for. Words match accents, French word forms, prefixes and typos; "exact phrase"; -word excludes; filters: in:tests|reqs|docs|passages, review:draft|checked|to-fix|validated, label:x, folder:x, sync:local|modified|synced, has:findings|sources|key|images|note, is:generated|awaiting|dirty, doc:x. A filter alone lists the tests it keeps.',
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
            testId: z.string().optional(),
            key: z.string().optional(),
            review: z.enum(REVIEWS as [Review, ...Review[]]).optional(),
            awaiting: z.boolean().optional().describe("A generated test still waiting for review (opens in Review)"),
            step: z.number().optional().describe("Step number (1-based) the snippet comes from"),
            docId: z.string().optional(),
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
    }),
    mutates: false,
    positional: ["query"],
    run: (ctx, input) => searchAll(projectOf(ctx), input),
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
