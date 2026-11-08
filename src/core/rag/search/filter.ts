import type { ResolvedModel, RetrievalSettings } from "../../types.ts";
import type { ChunkRow } from "../db.ts";

export type SearchMode = "hybrid" | "bm25" | "vector";
export type RetrievalOverride = Omit<Partial<RetrievalSettings>, "rerank"> & {
  rerank?: Partial<RetrievalSettings["rerank"]>;
};
export type SearchOpts = {
  k?: number;
  docIds?: string[];
  kinds?: string[];
  section?: string;
  mode?: SearchMode;
  reranker?: null;
  dbFile?: string;
  retrieval?: RetrievalOverride;
  project?: string;
  model?: ResolvedModel;
  rerankModel?: ResolvedModel | null;
};

export const sectionKey = (section: string) => section.trim().replace(/^§\s*/, "");

const inSection = (path: string, key: string) => path.split(" > ").includes(key);

// ponytail: a section prefix keeps the section, its sub-sections and the figures inside them — by the chunk's path,
// which lists every enclosing section (5 > 5.6 > 5.6.6), never by the text of an anchor
export function keep(c: ChunkRow | undefined, opts: SearchOpts): c is ChunkRow {
  if (!c) return false;
  if (opts.docIds?.length && !opts.docIds.includes(c.docId)) return false;
  if (opts.kinds?.length && !opts.kinds.includes(c.kind)) return false;
  const key = opts.section ? sectionKey(opts.section) : "";
  return !key || inSection(c.path, key);
}

// ponytail: the same filters as keep, as a condition on the chunks table — BM25 asks SQLite for filtered candidates
// so a narrow filter never empties a list that was cut before it
export function scopeSql(opts: SearchOpts): { where: string; args: string[] } {
  const parts: string[] = [];
  const args: string[] = [];
  const list = (column: string, values: string[] | undefined) => {
    if (!values?.length) return;
    parts.push(`${column} in (${values.map(() => "?").join(",")})`);
    args.push(...values);
  };
  list("doc_id", opts.docIds);
  list("kind", opts.kinds);
  const key = opts.section ? sectionKey(opts.section) : "";
  if (key) {
    parts.push("instr(' > ' || path || ' > ', ?) > 0");
    args.push(` > ${key} > `);
  }
  return { where: parts.join(" and "), args };
}
