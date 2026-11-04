import { join } from "node:path";
import { docIds, readDoc } from "../../../src/core/lib/docs.ts";
import { indexFile, openDb, setMeta } from "../../../src/core/rag/db.ts";
import { docContent } from "../../../src/core/rag/indexer.ts";

// ponytail: index-helpers.markIndexed wrote index/state.json; the index state now lives in rag.db (meta index_state)
export function markIndexedInDb(project: string, only?: string[], content?: Record<string, string>): void {
  const ids = docIds(project).filter((id) => !only || only.includes(id));
  const docs = Object.fromEntries(
    ids.map((id) => [id, content?.[id] ?? docContent(join(project, "docs", id), readDoc(project, id))]),
  );
  const db = openDb(indexFile(project));
  try {
    setMeta(
      db,
      "index_state",
      JSON.stringify({ embedding: "none", dims: 0, builtAt: "2026-01-01T00:00:00.000Z", docs, space: null }),
    );
  } finally {
    db.close();
  }
}
