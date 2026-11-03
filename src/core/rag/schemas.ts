import { z } from "zod";

export const searchMode = z
  .enum(["hybrid", "bm25", "vector"])
  .default("hybrid")
  .describe("hybrid = BM25 + vectors fused by RRF; bm25 or vector alone to compare");

export const chunkKind = z
  .enum(["section", "figure"])
  .describe("section = a section's text; figure = a figure's caption and description");

export const edgeKind = z
  .enum(["refers", "parent", "sibling", "shows", "amends"])
  .describe(
    "refers = cross-reference; parent = enclosing section; sibling = same parent; shows = section → its figure; amends = an amending document",
  );

export const policy = z
  .enum(["search", "search+graph"])
  .describe("search = rag.search alone; search+graph = search, then rag.related and rag.mentions");

const rerank = {
  top: z.number().int().min(1).describe("topk: candidates given to the reranker"),
  mode: z
    .enum(["topk", "threshold"])
    .describe("topk = reorder the top candidates; threshold = keep every candidate above the threshold"),
  threshold: z.number().describe("Threshold used when the reranker has none of its own"),
  thresholds: z.record(z.string(), z.number()).describe("Threshold per reranker model id"),
};

const retrievalFields = {
  candidates: z.number().int().min(1).max(1000).describe("Candidates taken from BM25 and from vectors"),
  rrfK: z.number().min(0).describe("Reciprocal rank fusion constant"),
  bm25Weights: z
    .array(z.number().min(0))
    .min(3)
    .max(4)
    .describe(
      "BM25 weights of the header, text and codes columns, and optionally of the stemmed column (0 turns it off)",
    ),
  expand: z.enum(["none", "section", "graph"]).describe("Related passages added to the hits"),
};

export const retrievalOverride = z
  .object({
    candidates: retrievalFields.candidates.optional(),
    rrfK: retrievalFields.rrfK.optional(),
    bm25Weights: retrievalFields.bm25Weights.optional(),
    rerank: z
      .object({
        top: rerank.top.optional(),
        mode: rerank.mode.optional(),
        threshold: rerank.threshold.optional(),
        thresholds: rerank.thresholds.optional(),
      })
      .optional()
      .describe("Reranker settings (the reranker itself is --reranker or the active configuration)"),
    expand: retrievalFields.expand.optional(),
  })
  .describe("Retrieval settings for this run, over project.json rag.retrieval (SPEC-RAG §4.3)");

export const retrievalSettings = z
  .object({
    ...retrievalFields,
    rerank: z
      .object({
        top: rerank.top,
        mode: rerank.mode,
        threshold: rerank.threshold.optional(),
        thresholds: rerank.thresholds.optional(),
      })
      .describe("Reranker settings"),
  })
  .describe("Effective retrieval settings: defaults, then the pack, project.json rag.retrieval, then this run's");

export const spaceFingerprint = z
  .object({
    runtime: z.enum(["transformers", "llamacpp", "mock"]).describe("Runtime that computes the vectors"),
    model: z.string().describe("Hash of the model's weights (sha256:…)"),
    modelId: z.string().describe("Catalog id of the embedding model"),
    pooling: z.string().describe("Pooling of the token vectors (cls, mean, last)"),
    normalize: z.boolean().describe("Vectors are normalized to length 1"),
    queryInstruction: z.string().describe("Text put before a query"),
    docInstruction: z.string().describe("Text put before a passage"),
    dims: z.number().describe("Vector dimension"),
    maxInputTokens: z.number().describe("Longest input the model reads, in tokens"),
    recipe: z.number().describe("Version of the way Testimus builds the vectors"),
  })
  .describe("What makes two vectors comparable: same fingerprint, same space (SPEC-RAG §6)");
