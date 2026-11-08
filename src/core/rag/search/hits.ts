import { existsSync } from "node:fs";
import { join } from "node:path";
import { docDir, readDocMd, readFigures } from "../../lib/docs.ts";
import type { RetrievalSettings, SearchHit } from "../../types.ts";
import { docFigures } from "../chunk.ts";
import { type ChunkRow, indexFile, toChunk, withDb } from "../db.ts";
import { keep, type SearchOpts } from "./filter.ts";

export type Expand = RetrievalSettings["expand"];

function figureFile(project: string, c: ChunkRow): string | undefined {
  if (c.kind !== "figure") return undefined;
  const md = existsSync(join(docDir(project, c.docId), "doc.md")) ? readDocMd(project, c.docId) : "";
  const f = docFigures(md, readFigures(project, c.docId)).find((x) => x.anchor === c.anchor);
  return f?.file ? `docs/${c.docId}/${f.file}` : undefined;
}

export const hitOf = (project: string, c: ChunkRow, score: number, extra: Partial<SearchHit> = {}): SearchHit => {
  const figure = figureFile(project, c);
  return {
    docId: c.docId,
    anchor: c.anchor,
    path: c.path,
    text: c.text,
    header: c.header,
    score,
    kind: c.kind,
    ...(figure ? { figure } : {}),
    ...extra,
  };
};

const parentOf = (n: string) => n.split(".").slice(0, -1).join(".");

// ponytail: expansion follows the document's own structure, never a model — the parent section, the section a figure
// sits in, and (graph) the sections the hit cross-references or amends; added after the k hits, each passage once,
// flagged `via`
export function expandHits(
  project: string,
  hits: { chunk: ChunkRow; score: number }[],
  expand: Expand,
  opts: SearchOpts,
): SearchHit[] {
  if (expand === "none" || !hits.length) return [];
  return withDb(opts.dbFile ?? indexFile(project), (db) => {
    const sectionChunk = db.prepare(
      "select * from chunks where doc_id = ? and (id = ? or id = ?) order by rowid limit 1",
    );
    const linked = db.prepare("select dst from edges where src = ? and kind in ('refers', 'amends')");
    const seen = new Set(hits.map((h) => `${h.chunk.docId}#${h.chunk.anchor}`));
    const out: SearchHit[] = [];
    const addSection = (ref: string, score: number, via: "section" | "graph") => {
      const m = ref.match(/^([^#]+)#(§.+)$/);
      if (!m || seen.has(ref)) return;
      const raw = sectionChunk.get(m[1], ref, `${ref}~1`) as Parameters<typeof toChunk>[0] | undefined;
      const c = raw ? toChunk(raw) : undefined;
      if (!keep(c, opts)) return;
      seen.add(ref);
      out.push(hitOf(project, c, score, { via }));
    };
    for (const { chunk: c, score } of hits) {
      const n = c.path.split(" > ").pop() ?? "";
      if (c.kind === "section" && c.anchor.startsWith("§") && parentOf(n))
        addSection(`${c.docId}#§${parentOf(n)}`, score, "section");
      if (c.kind !== "section" && n) addSection(`${c.docId}#§${n}`, score, "section");
      if (expand !== "graph" || c.kind !== "section") continue;
      for (const r of linked.all(`${c.docId}#${c.anchor}`) as { dst: string }[]) addSection(r.dst, score, "graph");
    }
    return out;
  });
}
