import { z } from "zod";
import { claudeHeaders } from "../claude/headers.ts";
import { command, projectOf } from "../command.ts";
import { runBench } from "../rag/bench.ts";
import { compareFiles } from "../rag/compare.ts";
import { runEval } from "../rag/eval.ts";
import { policy, retrievalOverride, retrievalSettings, searchMode, spaceFingerprint } from "../rag/schemas.ts";
import { EFFORT } from "./claude.ts";

const choice = z
  .union([
    z.object({ pack: z.string().describe("Pack id: light, performance, balanced, quality") }),
    z.object({
      embedding: z.string().describe("Catalog id of the embedding"),
      reranker: z.string().nullable().describe("Catalog id of the reranker, or null"),
    }),
  ])
  .describe("A model configuration: a pack, or an embedding + reranker pair");

const byK = <T extends z.ZodType>(value: T, what: string) =>
  z.record(z.string(), value).describe(`${what}, by k (10, 20, 50 and the MRR cut-off)`);

const atK = byK(
  z.object({
    recall: z.number().describe("Mean share of the must evidence found in the top k"),
    complete: z.number().describe("Share of behaviors with every must evidence found"),
    precision: z.number().describe("Mean share of returned items that are evidence"),
    chars: z.number().describe("Mean characters returned to Claude"),
  }),
  "Totals",
);

const policyTotals = z
  .object({
    n: z.number().describe("Behaviors scored"),
    atK,
    byRole: z
      .record(
        z.string(),
        z.object({
          n: z.number().describe("Evidence items of this role"),
          recall: byK(z.number(), "Share of them found"),
        }),
      )
      .describe("Recall of every evidence item of a role, pooled — exceptions, amendments, contradictions first"),
    ndcg10: z.number().describe("Mean nDCG@10 of the must evidence on the search ranking"),
    mrr: z.number().describe("Mean reciprocal rank of the first must evidence"),
  })
  .describe("The policy's totals over the behavior set");

const behaviorScore = z
  .object({
    atK: byK(
      z.object({
        recall: z.number().describe("Share of the must evidence found"),
        complete: z.boolean().describe("Every must evidence found"),
        precision: z.number().describe("Share of returned items that are evidence"),
        chars: z.number().describe("Characters returned"),
        items: z.number().describe("Distinct passages returned"),
      }),
      "Scores",
    ),
    roles: z
      .record(
        z.string(),
        z.object({
          n: z.number().describe("Evidence items of this role"),
          found: byK(z.number(), "How many were found"),
        }),
      )
      .describe("By evidence role"),
    found: byK(z.array(z.string()), "The must evidence found"),
    ndcg10: z.number().describe("nDCG@10 of the must evidence"),
    mrr: z.number().describe("Reciprocal rank of the first must evidence (0 past the cut-off)"),
    rank: z.number().nullable().describe("Rank of the first must evidence in the fused ranking"),
  })
  .describe("One behavior's scores under one policy");

export const commands = [
  command({
    name: "rag.eval",
    summary:
      "Benchmark retrieval (L1) over eval/behaviors.jsonl: evidence recall@10/20/50, complete, recall by role, precision, nDCG@10, MRR, characters — for search and for search + related + mentions. Brings the index up to date first; report with its fingerprints in .testimus/eval/.",
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
      mode: searchMode,
      retrieval: retrievalOverride.optional(),
    }),
    output: z.object({
      version: z.literal(2).describe("Report format"),
      setting: z.string().describe("Name of the configuration measured: embedding[+reranker]-mode[-r<settings hash>]"),
      provisional: z.boolean().describe("The behavior set is not validated by the testers: results are provisional"),
      config: z
        .object({
          chunker: z.string().describe("Hash of the chunk ids and hashes of the index"),
          headers: z.enum(["claude", "default"]).describe("Context headers written by Claude, or the default ones"),
          space: z
            .object({
              id: z.string().describe("Space id"),
              model: z.string().describe("Catalog id of its embedding model"),
              complete: z.boolean().describe("Every chunk had a vector"),
              fingerprint: spaceFingerprint,
            })
            .nullable()
            .describe("Vector space used (null in bm25 mode)"),
          embedding: z.string().describe("Embedding measured, or none"),
          reranker: z.string().nullable().describe("Reranker measured, or null"),
          mode: z.string().describe("hybrid, bm25 or vector"),
          retrieval: retrievalSettings,
          ks: z.array(z.number()).describe("The k values recall is measured at"),
          mrrK: z.number().describe("Rank cut-off of MRR"),
          corpus: z.string().describe("Hash of the indexed documents"),
          set: z
            .object({
              file: z.string().describe("Behavior set file"),
              hash: z.string().describe("Hash of its content"),
              behaviors: z.number().describe("Behaviors in it"),
              validated: z.boolean().describe("Every behavior is validated by the testers"),
            })
            .describe("The behavior set"),
          app: z.string().describe("Testimus version"),
          index: z.string().describe("The rag.db measured"),
        })
        .describe("Everything needed to reproduce the run (SPEC-RAG §10.5)"),
      policies: z
        .array(
          z.object({
            name: policy,
            available: z.boolean().describe("The policy could run"),
            reason: z.string().optional().describe("Why the policy could not run"),
            description: z.string().describe("What the policy does, in words"),
            totals: policyTotals.nullable(),
            warnings: z.array(z.string()).describe("Fallbacks taken (no vectors, reranker down) and tool failures"),
          }),
        )
        .describe("One line per retrieval policy"),
      behaviors: z
        .array(
          z.object({
            id: z.string().describe("Behavior id"),
            question: z.string().describe("The behavior's question"),
            category: z.string().nullable().describe("Its category, if any"),
            validated: z.boolean().nullable().describe("Validated by the testers (null: not said)"),
            must: z.number().describe("Must evidence items"),
            rank: z
              .number()
              .nullable()
              .describe("Rank of the first must evidence for the question alone (null: not in the top k)"),
            policies: z.record(z.string(), behaviorScore).describe("Per policy: recall, complete, roles, ranks"),
          }),
        )
        .describe("One line per behavior"),
      n: z.number().describe("Behaviors measured"),
      recall5: z.number().describe("Share of questions alone with a must evidence in the top 5 (v1 score, kept)"),
      recall10: z.number().describe("Same in the top 10 (v1 score, kept)"),
      mrr: z.number().describe("Mean reciprocal rank of the question alone, cut at k (v1 score, kept)"),
      embedding: z.string().describe("Embedding measured, or none"),
      reranker: z.string().nullable().describe("Reranker measured, or null"),
      mode: z.string().describe("hybrid, bm25 or vector"),
      k: z.number().describe("Rank cut-off of MRR"),
      index: z.string().describe("The rag.db measured"),
      report: z.string().describe("Where the report was saved"),
    }),
    mutates: true,
    job: "rag-eval",
    subject: (i) => i.embedding ?? "eval",
    run: (ctx, input) => runEval(projectOf(ctx), ctx, { ...input, describe: claudeHeaders }),
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
      baseline: z.string().describe("The baseline report file"),
      policy,
      k: z.number().describe("Rank cut-off of the recall compared"),
      samples: z.number().describe("Bootstrap resamples"),
      provisional: z.boolean().describe("A report rests on a behavior set not validated by the testers"),
      rows: z
        .array(
          z.object({
            report: z.string().describe("The report compared with the baseline"),
            setting: z.string().describe("Its configuration"),
            n: z.number().describe("Behaviors paired"),
            recall: z.number().describe("Its must-evidence recall on the paired behaviors"),
            baseline: z.number().describe("Must-evidence recall of the baseline on the same behaviors"),
            diff: z.number().describe("Mean paired difference in must-evidence recall against the baseline"),
            low: z.number().describe("Bootstrap 95 % interval, lower bound"),
            high: z.number().describe("Bootstrap 95 % interval, upper bound"),
            byRole: z
              .record(
                z.string(),
                z.object({
                  recall: z.number().describe("Recall of this role"),
                  baseline: z.number().describe("The baseline's"),
                  diff: z.number().describe("Difference"),
                  n: z.number().describe("Evidence items of this role"),
                }),
              )
              .describe("By evidence role"),
            adopt: z.boolean().describe("The interval excludes zero upwards and no role goes down"),
            why: z.string().describe("The adopt rule's verdict, in words"),
            provisional: z.boolean().describe("This report's set is not validated"),
            warnings: z.array(z.string()).describe("What makes the comparison weaker (different corpus, set…)"),
          }),
        )
        .describe("One line per report compared"),
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
      report: z.string().describe("Where the report was saved"),
      provisional: z.boolean().describe("The behavior set is not validated by the testers"),
      notes: z.array(z.string()).describe("What the numbers do not say (no ledger, provisional set, revert failures)"),
      summary: z
        .array(
          z.object({
            config: z.string().describe("Configuration label"),
            runs: z.number().describe("Runs made"),
            failed: z.number().describe("Runs that failed"),
            agenticRecall: z.number().nullable().describe("Mean agentic recall; null when never measured"),
            tests: z.number().describe("Mean tests written per run"),
            errors: z.number().describe("Mean check errors per run"),
            quoteErrors: z.number().describe("Mean quote errors per run"),
            costUsd: z.number().describe("Total cost in US dollars"),
            durationMs: z.number().describe("Mean run duration"),
          }),
        )
        .describe("One line per configuration"),
      rows: z
        .array(
          z.object({
            config: z.string().describe("Configuration label"),
            behavior: z.string().describe("Behavior id"),
            run: z.number().describe("Run number (1-based)"),
            ok: z.boolean().describe("gen.tests finished"),
            agenticRecall: z
              .number()
              .nullable()
              .describe("Share of must evidence Claude actually opened; null when the ledger has no consulted list"),
            consulted: z.number().nullable().describe("Passages Claude opened; null without a ledger"),
            tests: z.number().describe("Tests written"),
            findings: z
              .object({
                errors: z.number().describe("Check errors"),
                warnings: z.number().describe("Check warnings"),
              })
              .describe("Findings of the check on the tests written"),
            quoteErrors: z.number().describe("Quotes not found or not at their anchor"),
            costUsd: z.number().optional().describe("Cost of the run in US dollars"),
            durationMs: z.number().describe("Duration of the run"),
            runId: z.string().optional().describe("The Claude run"),
            error: z.string().optional().describe("Why the run failed"),
          }),
        )
        .describe("One line per configuration × behavior × run"),
    }),
    mutates: true,
    job: "gen-bench",
    subject: (i) => `${i.behaviors.length} behaviors × ${i.configs.length}`,
    run: (ctx, input) => runBench(projectOf(ctx), ctx, input),
  }),
];
