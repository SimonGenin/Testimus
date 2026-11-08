import { z } from "zod";
import { CLAUDE_SEARCH } from "../claude/access.ts";
import { command, projectOf } from "../command.ts";
import { modelsDeps } from "../lib/models-use.ts";
import { DOCS_INDEX } from "../rag/indexer.ts";
import { PALETTE_SEARCH, TESTS_SEARCH } from "../search/all.ts";
import { TESTS_INDEX } from "../search/vectors.ts";
import type { ResolvedModel, SearchUse } from "../types.ts";
import { COMMAND_SEARCH } from "./rag.ts";

// ponytail: every user of the search, each declared beside its own code (what it takes: words, the active embedding,
// the active reranker, and when) — another LLM's runs declare their line beside Claude's and are added here
const USERS: SearchUse[] = [CLAUDE_SEARCH, PALETTE_SEARCH, TESTS_SEARCH, DOCS_INDEX, TESTS_INDEX, COMMAND_SEARCH];

const model = z.string().nullable().describe("Catalog id of the model it uses on this PC (null = none here)");
const label = z.string().nullable().describe("That model's name in words (null = none here)");

function used(m: ResolvedModel | null, use: string) {
  return use === "no" || !m ? { model: null, label: null } : { model: m.entry.id, label: m.entry.label };
}

export const commands = [
  command({
    name: "models.usage",
    summary:
      "Who uses what on this PC: one line per user of the search (Claude's runs, Search everything, the tests list, the indexes, the command line), with the words (BM25), the embedding and the reranker each one really uses here, and when.",
    input: z.object({}),
    output: z.array(
      z
        .object({
          id: z.string().describe("The user's id"),
          who: z.string().describe("Who searches, in words"),
          when: z.string().describe("When it searches or builds"),
          words: z
            .enum(["always", "builds", "no"])
            .describe("Words (BM25 and the document's structure): always looked up · built (the index) · not used"),
          embedding: z
            .object({
              use: z.enum(["uses", "builds", "no"]).describe("uses it to rank · builds its vectors · never"),
              model,
              label,
            })
            .describe("The active embedding"),
          reranker: z
            .object({
              use: z.enum(["uses", "no"]).describe("reorders with it · never"),
              model,
              label,
              why: z.string().nullable().describe("Why it never uses one (null = it does, or no reason given)"),
            })
            .describe("The active reranker"),
        })
        .describe("One user of the search"),
    ),
    mutates: false,
    async run(ctx) {
      const a = await modelsDeps.activeModels(projectOf(ctx));
      return USERS.map((u) => ({
        id: u.id,
        who: u.who,
        when: u.when,
        words: u.words,
        embedding: { use: u.embedding, ...used(a.embedding, u.embedding) },
        reranker: {
          use: u.reranker,
          ...used(a.reranker, u.reranker),
          why: u.reranker === "no" ? (u.why ?? null) : null,
        },
      }));
    },
  }),
];
