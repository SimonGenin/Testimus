import type { DatabaseSync } from "node:sqlite";
import { activeModels } from "../activation.ts";
import { chunkCount, chunksByRowid, nearest, vectorCount } from "../db.ts";
import { embedWith } from "../embed.ts";
import { spaceOf } from "../fingerprint.ts";
import { keep, type SearchOpts } from "./filter.ts";
import { CANDIDATES } from "./lexical.ts";

export type VectorResult = { ids: number[]; degraded: string | null };

export async function vector(
  db: DatabaseSync,
  project: string,
  query: string,
  opts: SearchOpts,
): Promise<VectorResult> {
  const m = (await activeModels(project)).embedding;
  if (!m) return { ids: [], degraded: "No embedding model is installed on this PC: lexical search only." };
  const space = spaceOf(db, m);
  if (!space) return { ids: [], degraded: `No vectors for ${m.entry.id} yet: lexical search until rag index ends.` };
  if (!space.complete)
    return {
      ids: [],
      degraded: `The vectors of ${m.entry.id} are incomplete (${vectorCount(db, space.id)}/${chunkCount(db)}): lexical search until rag index ends.`,
    };
  let q: Float32Array;
  try {
    [q] = await embedWith(m, [query], "query");
  } catch (e) {
    return { ids: [], degraded: `${m.entry.id} failed on the query (${e instanceof Error ? e.message : String(e)}).` };
  }
  const limit = opts.retrieval?.candidates ?? CANDIDATES;
  const ids = nearest(db, space.id, q, Math.min(chunkCount(db), 4096)).map((r) => r.rowid);
  const byId = chunksByRowid(db, ids);
  return { ids: ids.filter((id) => keep(byId.get(id), opts)).slice(0, limit), degraded: null };
}
