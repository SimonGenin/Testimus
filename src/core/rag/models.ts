import { UserError } from "../command.ts";
import { catalogEntry } from "../lib/models-catalog.ts";
import type { ModelProfile, ResolvedModel, SpaceFingerprint } from "../types.ts";
import { resolveModel } from "./activation.ts";
import { RECIPE } from "./db.ts";

export const EMBEDDINGS: ModelProfile[] = [
  {
    name: "bge-m3",
    hfId: "Xenova/bge-m3",
    dims: 1024,
    dtype: "q8",
    pooling: "cls",
    normalize: true,
    queryPrefix: "",
    docPrefix: "",
    maxTokens: 8192,
  },
  {
    name: "qwen3-embedding-0.6b",
    hfId: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    dims: 1024,
    dtype: "q8",
    pooling: "last",
    normalize: true,
    queryPrefix:
      "Instruct: Given a question about a railway simulator specification, retrieve the passage that answers it\nQuery: ",
    docPrefix: "",
    maxTokens: 8192,
  },
];

export const RERANKERS: ModelProfile[] = [
  {
    name: "bge-reranker-v2-m3",
    hfId: "onnx-community/bge-reranker-v2-m3-ONNX",
    dims: 1,
    dtype: "q8",
    pooling: "cls",
    normalize: false,
    queryPrefix: "",
    docPrefix: "",
    maxTokens: 1024,
  },
];

export function findProfile(name: string): ModelProfile | undefined {
  return [...EMBEDDINGS, ...RERANKERS].find((m) => m.name === name);
}

export function embeddingProfile(name: string): ModelProfile {
  const p = EMBEDDINGS.find((m) => m.name === name);
  if (!p)
    throw new UserError(
      `Unknown embedding profile "${name}".`,
      `Use one of ${EMBEDDINGS.map((m) => m.name).join(", ")} in project.json rag.embedding.`,
    );
  return p;
}

export function rerankerProfile(name: string): ModelProfile {
  const p = RERANKERS.find((m) => m.name === name);
  if (!p)
    throw new UserError(
      `Unknown reranker profile "${name}".`,
      `Use one of ${RERANKERS.map((m) => m.name).join(", ")} or null in project.json rag.reranker.`,
    );
  return p;
}

export function profileFingerprint(p: ModelProfile): SpaceFingerprint {
  return {
    runtime: "transformers",
    model: `profile:${p.hfId}:${p.dtype}`,
    modelId: p.name,
    pooling: p.pooling,
    normalize: p.normalize,
    queryInstruction: p.queryPrefix,
    docInstruction: p.docPrefix,
    dims: p.dims,
    maxInputTokens: p.maxTokens,
    recipe: RECIPE,
  };
}

export function catalogIdOf(p: ModelProfile): string {
  const e = catalogEntry(p.name);
  if (!e)
    throw new UserError(`The profile ${p.name} has no catalog entry.`, "Use a model id from testimus models catalog.");
  return e.id;
}

export function modelForProfile(p: ModelProfile, queryTask: string): ResolvedModel {
  const m = resolveModel(catalogIdOf(p), queryTask);
  if (!m)
    throw new UserError(
      `${p.name} is not installed on this PC.`,
      `Install it from Settings › Models (testimus models pull ${catalogIdOf(p)}).`,
    );
  return m;
}
