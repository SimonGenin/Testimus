import type { ResolvedModel, RetrievalSettings } from "../../types.ts";
import type { ChunkRow } from "../db.ts";

export type SearchMode = "hybrid" | "bm25" | "vector";
export type RetrievalOverride = Omit<Partial<RetrievalSettings>, "rerank"> & {
  rerank?: Partial<RetrievalSettings["rerank"]>;
};
export type SearchOpts = {
  k?: number;
  docIds?: string[];
  mode?: SearchMode;
  reranker?: null;
  dbFile?: string;
  retrieval?: RetrievalOverride;
  project?: string;
  model?: ResolvedModel;
  rerankModel?: ResolvedModel | null;
};

export function keep(c: ChunkRow | undefined, opts: SearchOpts): c is ChunkRow {
  if (!c) return false;
  return !opts.docIds?.length || opts.docIds.includes(c.docId);
}
