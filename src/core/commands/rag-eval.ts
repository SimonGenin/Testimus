import { z } from "zod";
import { type Command, command, projectOf } from "../command.ts";
import { runBench } from "../rag/bench.ts";
import { compareFiles } from "../rag/compare.ts";
import { runEval } from "../rag/eval.ts";
import { EFFORT } from "./claude.ts";
import { mode } from "./rag.ts";

const scores = z.object({ n: z.number(), recall5: z.number(), recall10: z.number(), mrr: z.number() });

const choice = z
  .union([
    z.object({ pack: z.string().describe("Pack id: light, performance, balanced, quality") }),
    z.object({
      embedding: z.string().describe("Catalog id of the embedding"),
      reranker: z.string().nullable().describe("Catalog id of the reranker, or null"),
    }),
  ])
  .describe("A model configuration: a pack, or an embedding + reranker pair");

const policy = z.enum(["search", "search+graph"]);

const retrieval = z
  .object({
    candidates: z.number().int().min(1).max(1000).optional().describe("Candidates taken from BM25 and from vectors"),
    rrfK: z.number().min(0).optional().describe("Reciprocal rank fusion constant"),
    bm25Weights: z
      .array(z.number().min(0))
      .min(3)
      .max(4)
      .optional()
      .describe(
        "BM25 weights of the header, text and codes columns, and optionally of the stemmed column (0 turns it off)",
      ),
    rerank: z
      .object({
        top: z.number().int().min(1).optional().describe("topk: candidates given to the reranker"),
        mode: z
          .enum(["topk", "threshold"])
          .optional()
          .describe("topk = reorder the top candidates; threshold = keep every candidate above the threshold"),
        threshold: z.number().optional().describe("Threshold used when the reranker has none of its own"),
        thresholds: z.record(z.string(), z.number()).optional().describe("Threshold per reranker model id"),
      })
      .optional()
      .describe("Reranker settings (the reranker itself is --reranker or the active configuration)"),
    expand: z.enum(["none", "section", "graph"]).optional().describe("Related passages added to the hits"),
  })
  .describe("Retrieval settings for this run, over project.json rag.retrieval (SPEC-RAG §4.3)");

const atK = z
  .record(
    z.string(),
    z.object({
      recall: z.number().describe("Mean share of the must evidence found in the top k"),
      complete: z.number().describe("Share of behaviors with every must evidence found"),
      precision: z.number().describe("Mean share of returned items that are evidence"),
      chars: z.number().describe("Mean characters returned to Claude"),
    }),
  )
  .describe("By k (10, 20, 50)");

const policyTotals = z.object({
  n: z.number(),
  atK,
  byRole: z
    .record(z.string(), z.object({ n: z.number(), recall: z.record(z.string(), z.number()) }))
    .describe("Recall of every evidence item of a role, pooled, by k — exceptions, amendments, contradictions first"),
  ndcg10: z.number(),
  mrr: z.number(),
});

export const commands: Command[] = [
  command({
    name: "rag.eval",
    summary:
      "Benchmark retrieval (L1) over eval/behaviors.jsonl: evidence recall@10/20/50, complete, recall by role, precision, nDCG@10, MRR, characters — for search and for search + related + mentions. Report with its fingerprints in .testimus/eval/.",
    input: z.object({
      set: z.string().optional().describe("Behavior set, relative to the project (default eval/behaviors.jsonl)"),
      k: z.number().int().min(1).max(50).default(10).describe("Rank cut-off for MRR (recall is at 10, 20 and 50)"),
      embedding: z
        .string()
        .optional()
        .describe(
          "Candidate embedding (catalog id, installed here): measured in its own vector space of index/rag.db; the active space is untouched",
        ),
      reranker: z.string().nullable().optional().describe("Candidate reranker (catalog id; none = no reranker)"),
      mode,
      retrieval: retrieval.optional(),
    }),
    output: scores.extend({
      version: z.literal(2),
      setting: z.string(),
      provisional: z.boolean().describe("The behavior set is not validated by the testers: results are provisional"),
      config: z
        .object({
          chunker: z.string().describe("Hash of the chunk ids and hashes of the index"),
          headers: z.enum(["claude", "default"]),
          space: z
            .object({ id: z.string(), model: z.string(), complete: z.boolean(), fingerprint: z.unknown() })
            .nullable()
            .describe("Vector space used (null in bm25 mode)"),
          embedding: z.string(),
          reranker: z.string().nullable(),
          mode: z.string(),
          retrieval: z.unknown().describe("Effective retrieval settings"),
          ks: z.array(z.number()),
          mrrK: z.number(),
          corpus: z.string().describe("Hash of the indexed documents"),
          set: z.object({
            file: z.string(),
            hash: z.string(),
            behaviors: z.number(),
            validated: z.boolean(),
          }),
          app: z.string().describe("Testimus version"),
          index: z.string(),
        })
        .describe("Everything needed to reproduce the run (SPEC-RAG §10.5)"),
      policies: z.array(
        z.object({
          name: policy,
          available: z.boolean(),
          reason: z.string().optional().describe("Why the policy could not run"),
          description: z.string(),
          totals: policyTotals.nullable(),
          warnings: z.array(z.string()),
        }),
      ),
      behaviors: z.array(
        z.object({
          id: z.string(),
          question: z.string(),
          category: z.string().nullable(),
          validated: z.boolean().nullable(),
          must: z.number(),
          rank: z
            .number()
            .nullable()
            .describe("Rank of the first must evidence for the question alone (null: not in the top k)"),
          policies: z.record(z.string(), z.unknown()).describe("Per policy: recall, complete, roles, ranks"),
        }),
      ),
      embedding: z.string(),
      reranker: z.string().nullable(),
      mode: z.string(),
      k: z.number(),
      index: z.string(),
      report: z.string().describe("Where the report was saved"),
    }),
    mutates: false,
    job: "rag-eval",
    subject: (i) => i.embedding ?? "eval",
    run: (ctx, input) => runEval(projectOf(ctx), ctx, input),
  }),
  command({
    name: "rag.compare",
    summary:
      "Compare benchmark reports paired per behavior: must-evidence recall difference with a bootstrap 95 % interval, per role.",
    input: z.object({
      reports: z
        .array(z.string())
        .min(1)
        .describe("Report files under .testimus/eval/ (the first is the baseline); one name = compare with the latest"),
      k: z.number().int().min(1).max(50).default(10).describe("Rank cut-off of the recall compared"),
      samples: z.number().int().min(100).max(100000).default(10000).describe("Bootstrap resamples"),
      policy: policy
        .optional()
        .describe("Policy compared (default search+graph when every report has it, else search)"),
    }),
    output: z.object({
      baseline: z.string(),
      policy,
      k: z.number(),
      samples: z.number(),
      provisional: z.boolean().describe("A report rests on a behavior set not validated by the testers"),
      rows: z.array(
        z.object({
          report: z.string(),
          setting: z.string(),
          n: z.number().describe("Behaviors paired"),
          recall: z.number(),
          baseline: z.number().describe("Must-evidence recall of the baseline on the same behaviors"),
          diff: z.number().describe("Mean paired difference in must-evidence recall against the baseline"),
          low: z.number().describe("Bootstrap 95 % interval, lower bound"),
          high: z.number().describe("Bootstrap 95 % interval, upper bound"),
          byRole: z.record(
            z.string(),
            z.object({ recall: z.number(), baseline: z.number(), diff: z.number(), n: z.number() }),
          ),
          adopt: z.boolean().describe("The interval excludes zero upwards and no role goes down"),
          why: z.string(),
          provisional: z.boolean(),
          warnings: z.array(z.string()),
        }),
      ),
    }),
    mutates: false,
    run: async (ctx, input) => compareFiles(projectOf(ctx), input),
  }),
  command({
    name: "gen.bench",
    summary:
      "End-to-end benchmark (L2): gen.tests on chosen behaviors × configurations × runs, scored from the evidence ledger. Costly.",
    input: z.object({
      set: z.string().optional().describe("Behavior set, relative to the project (default eval/behaviors.jsonl)"),
      behaviors: z.array(z.string()).min(1).describe("Behavior ids to run"),
      configs: z.array(choice).min(1).describe("Configurations to compare"),
      runs: z.number().int().min(1).max(5).default(3).describe("Runs per behavior and configuration"),
      model: z.string().optional().describe("Claude model alias (default: project.json claude.model)"),
      effort: EFFORT.optional().describe("Claude effort (default: project.json claude.effort)"),
      check: z.boolean().default(true).describe("Check the generated tests (mechanical + check-test skill)"),
      keep: z
        .boolean()
        .default(false)
        .describe("Keep the generated tests (default: each run's tests are reverted once scored)"),
    }),
    output: z.object({
      report: z.string(),
      provisional: z.boolean().describe("The behavior set is not validated by the testers"),
      notes: z.array(z.string()),
      summary: z.array(
        z.object({
          config: z.string(),
          runs: z.number(),
          failed: z.number(),
          agenticRecall: z.number().nullable(),
          tests: z.number(),
          errors: z.number(),
          quoteErrors: z.number(),
          costUsd: z.number(),
          durationMs: z.number(),
        }),
      ),
      rows: z.array(
        z.object({
          config: z.string(),
          behavior: z.string(),
          run: z.number(),
          ok: z.boolean(),
          agenticRecall: z
            .number()
            .nullable()
            .describe("Share of must evidence Claude actually opened; null when the ledger has no consulted list"),
          consulted: z.number().nullable(),
          tests: z.number(),
          findings: z.object({ errors: z.number(), warnings: z.number() }),
          quoteErrors: z.number(),
          costUsd: z.number().optional(),
          durationMs: z.number(),
          runId: z.string().optional(),
          error: z.string().optional(),
        }),
      ),
    }),
    mutates: true,
    job: "gen-bench",
    subject: (i) => `${i.behaviors.length} behaviors × ${i.configs.length}`,
    run: (ctx, input) => runBench(projectOf(ctx), ctx, input),
  }),
];
