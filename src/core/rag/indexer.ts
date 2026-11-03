import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { sha256 } from "../lib/hash.ts";
import { withPerfScope } from "../lib/models-perf.ts";
import { readJson, writeJson } from "../lib/project.ts";
import type { Chunk, ClaudeRun, DocJson, FigureEntry, ModelProfile, ResolvedModel, VectorSpace } from "../types.ts";
import { activeModels, queryTaskOf } from "./activation.ts";
import { chunkDoc, hooks } from "./chunk.ts";
import {
  chunkCount,
  chunksOf,
  createSpace,
  deleteChunk,
  dropSpace,
  indexFile,
  insertChunk,
  listSpaces,
  missingVectors,
  openDb,
  putVector,
  rebuildFts,
  replaceEdges,
  setMeta,
  setSpace,
  transaction,
  vecTable,
  vectorCount,
} from "./db.ts";
import { embedWith } from "./embed.ts";
import { fingerprintOf, legacySpace, spaceOf } from "./fingerprint.ts";
import { docEdges } from "./graph.ts";
import { modelForProfile } from "./models.ts";

export type DocIndexStatus = "indexed" | "unchanged" | "removed";
export type IndexReport = {
  embedding: string;
  dims: number;
  vectorsRebuilt: boolean;
  space?: string;
  degraded?: string;
  docs: { docId: string; status: DocIndexStatus; chunks: number }[];
  chunks: number;
  embedded: number;
  ms: number;
};
export type IndexState = {
  embedding: string;
  dims: number;
  builtAt: string;
  docs: Record<string, string>;
  space?: string | null;
};

export type ProjectDoc = { doc: DocJson; dir: string; md: string; figures: FigureEntry[]; content: string };

const BATCH = 16;

export function stateFile(project: string): string {
  return join(project, "index", "state.json");
}

export function readState(project: string): IndexState | null {
  return readJson<IndexState | null>(stateFile(project), null);
}

export function projectDocs(project: string): ProjectDoc[] {
  const root = join(project, "docs");
  if (!existsSync(root)) return [];
  const out: ProjectDoc[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    if (!existsSync(join(dir, "doc.json")) || !existsSync(join(dir, "doc.md"))) continue;
    const doc = readJson<DocJson>(join(dir, "doc.json"), {} as DocJson);
    if (!doc.id) doc.id = e.name;
    const md = readFileSync(join(dir, "doc.md"), "utf8");
    const figures = readJson<FigureEntry[]>(join(dir, "figures.json"), []);
    out.push({ doc, dir, md, figures, content: docContent(dir, doc, md) });
  }
  return out.sort((a, b) => a.doc.id.localeCompare(b.doc.id));
}

export function docContent(dir: string, doc: Pick<DocJson, "code" | "title">, md?: string): string {
  const text = md ?? (existsSync(join(dir, "doc.md")) ? readFileSync(join(dir, "doc.md"), "utf8") : "");
  const figRaw = existsSync(join(dir, "figures.json")) ? readFileSync(join(dir, "figures.json"), "utf8") : "[]";
  return sha256(JSON.stringify([text, figRaw, doc.code, doc.title]));
}

function chunkHash(c: Chunk): string {
  return sha256(JSON.stringify([c.anchor, c.path, c.header, c.text, c.kind, c.figureIds])).slice(0, 16);
}

async function headersFor(doc: DocJson, chunks: Chunk[], ctx: Ctx, claude?: ClaudeRun): Promise<string[]> {
  const fallback = chunks.map((c) => c.header);
  if (!hooks.describeChunks || !chunks.length) return fallback;
  try {
    const got = await hooks.describeChunks(doc, chunks, ctx.signal, ctx.project ?? undefined, claude);
    return chunks.map((c, i) => got[i]?.trim() || c.header);
  } catch (e) {
    ctx.log("warn", `Context headers for ${doc.id}: default used (${e instanceof Error ? e.message : String(e)})`);
    return fallback;
  }
}

async function indexDoc(
  db: DatabaseSync,
  d: ProjectDoc,
  ctx: Ctx,
  project: string,
  force = false,
  claude?: ClaudeRun,
): Promise<DocIndexStatus> {
  const row = db.prepare("select content from docs where doc_id = ?").get(d.doc.id) as { content: string } | undefined;
  if (row?.content === d.content) {
    transaction(db, () => {
      db.prepare("update docs set sha256 = ? where doc_id = ?").run(d.doc.source?.sha256 ?? "", d.doc.id);
      replaceEdges(db, d.doc.id, docEdges(project, d.doc, d.md, d.figures));
    });
    return "unchanged";
  }
  const chunks = chunkDoc(d.doc, d.md, d.figures);
  const old = new Map(chunksOf(db, d.doc.id).map((c) => [`${c.id} ${c.hash}`, c]));
  let fresh = chunks.filter((c) => !old.has(`${c.id} ${chunkHash(c)}`));
  let keep = new Set(chunks.map((c) => `${c.id} ${chunkHash(c)}`));
  let headers = await headersFor(d.doc, fresh, ctx, claude);
  // ponytail: forced, every chunk asks for its header again; one that comes out the same keeps its row and vectors
  if (force) {
    const all = await headersFor(d.doc, chunks, ctx, claude);
    const same = (c: Chunk, i: number) => old.get(`${c.id} ${chunkHash(c)}`)?.header === all[i];
    keep = new Set(chunks.filter(same).map((c) => `${c.id} ${chunkHash(c)}`));
    fresh = chunks.filter((c, i) => !same(c, i));
    headers = all.filter((_, i) => !same(chunks[i], i));
  }
  transaction(db, () => {
    for (const [key, c] of old) if (!keep.has(key)) deleteChunk(db, c.rowid);
    fresh.forEach((c, i) => {
      insertChunk(db, { ...c, header: headers[i] }, chunkHash(c));
    });
    replaceEdges(db, d.doc.id, docEdges(project, d.doc, d.md, d.figures));
    db.prepare(
      `insert into docs(doc_id, sha256, content) values (?, ?, ?)
       on conflict(doc_id) do update set sha256 = excluded.sha256, content = excluded.content`,
    ).run(d.doc.id, d.doc.source?.sha256 ?? "", d.content);
  });
  return "indexed";
}

// ponytail: adopting the migrated v1 space copies its vectors under the pinned fingerprint, then drops it
function adopt(db: DatabaseSync, m: ResolvedModel): VectorSpace {
  const fp = fingerprintOf(m);
  const own = spaceOf(db, m);
  if (own && !own.fingerprint.unpinned) return own;
  const legacy = legacySpace(db, m);
  return transaction(db, () => {
    const s = createSpace(db, fp);
    if (legacy) {
      db.exec(
        `insert or ignore into ${vecTable(s.id)}(chunk_rowid, embedding) select chunk_rowid, embedding from ${vecTable(legacy.id)}`,
      );
      setSpace(db, s.id, { builtAt: legacy.builtAt, lastUsed: legacy.lastUsed });
      dropSpace(db, legacy.id);
    }
    return s;
  });
}

async function chooseModel(
  project: string,
  opts: { profile?: ModelProfile; model?: ResolvedModel | null },
): Promise<{ model: ResolvedModel | null; degraded?: string }> {
  if (opts.model !== undefined) return { model: opts.model };
  if (opts.profile) return { model: modelForProfile(opts.profile, queryTaskOf(project)) };
  const active = await activeModels(project);
  if (active.embedding) return { model: active.embedding };
  return {
    model: null,
    degraded: `No embedding model is installed on this PC${active.missing.length ? ` (${active.missing.join(", ")})` : ""}: lexical index only.`,
  };
}

// ponytail: a removed document takes its vectors with it in every space, so a complete space stays complete
function forgetDoc(db: DatabaseSync, id: string): void {
  transaction(db, () => {
    const spaces = listSpaces(db);
    for (const c of chunksOf(db, id)) {
      db.prepare("delete from chunks where rowid = ?").run(c.rowid);
      db.prepare("delete from chunks_fts where rowid = ?").run(c.rowid);
      for (const s of spaces) db.prepare(`delete from ${vecTable(s.id)} where chunk_rowid = ?`).run(BigInt(c.rowid));
    }
    db.prepare("delete from docs where doc_id = ?").run(id);
    replaceEdges(db, id, []);
  });
}

export function unindexDoc(project: string, id: string): void {
  if (existsSync(indexFile(project))) {
    const db = openDb(indexFile(project));
    try {
      forgetDoc(db, id);
    } finally {
      db.close();
    }
  }
  const state = readState(project);
  if (state?.docs[id] !== undefined) {
    delete state.docs[id];
    writeJson(stateFile(project), state);
  }
}

export async function indexProject(
  project: string,
  ctx: Ctx,
  opts: {
    profile?: ModelProfile;
    model?: ResolvedModel | null;
    dbFile?: string;
    force?: boolean;
    claude?: ClaudeRun;
  } = {},
): Promise<IndexReport> {
  const t0 = Date.now();
  ctx.steps?.([
    { id: "model", label: "Find the search model" },
    { id: "chunk", label: "Cut the documents into passages" },
    { id: "embed", label: "Embed the passages" },
    { id: "save", label: "Save the index" },
  ]);
  ctx.step?.("model");
  const { model, degraded } = await chooseModel(project, opts);
  const live = !opts.dbFile;
  const db = openDb(opts.dbFile ?? indexFile(project));
  try {
    // ponytail: --force chunks every document again and re-embeds the active space only; an unchanged chunk keeps its
    // row, so the other spaces keep their vectors (activating a model never destroys another space, SPEC-RAG P3)
    if (opts.force) db.exec("delete from docs");
    const docs = projectDocs(project);
    const report: IndexReport["docs"] = [];
    ctx.step?.("chunk");
    for (const [i, d] of docs.entries()) {
      if (ctx.signal.aborted) throw new Error("Indexing cancelled.");
      ctx.progress({ message: `Chunking ${d.doc.id}`, done: i, total: docs.length });
      const status = await indexDoc(db, d, ctx, project, opts.force, opts.claude);
      report.push({ docId: d.doc.id, status, chunks: chunksOf(db, d.doc.id).length });
    }
    if (opts.force) rebuildFts(db);
    const onDisk = new Set(docs.map((d) => d.doc.id));
    const gone = (db.prepare("select doc_id from docs").all() as { doc_id: string }[])
      .map((r) => r.doc_id)
      .filter((id) => !onDisk.has(id));
    for (const id of gone) {
      forgetDoc(db, id);
      report.push({ docId: id, status: "removed", chunks: 0 });
    }
    for (const s of listSpaces(db))
      if (s.complete && missingVectors(db, s.id).length) setSpace(db, s.id, { complete: false });
    let space: VectorSpace | null = null;
    let embedded = 0;
    let vectorsRebuilt = false;
    if (model) {
      ctx.step?.("embed");
      space = adopt(db, model);
      if (opts.force) db.exec(`delete from ${vecTable(space.id)}`);
      vectorsRebuilt = vectorCount(db, space.id) === 0;
      setMeta(db, "embedding", model.entry.id);
      setMeta(db, "dims", String(space.dims));
      const todo = missingVectors(db, space.id);
      const id = space.id;
      await withPerfScope({ fingerprint: id, project, jobId: ctx.jobId }, async () => {
        for (let i = 0; i < todo.length; i += BATCH) {
          if (ctx.signal.aborted) throw new Error("Indexing cancelled.");
          const batch = todo.slice(i, i + BATCH);
          ctx.progress({ message: `Embedding ${batch[0].docId} (${model.entry.id})`, done: i, total: todo.length });
          const vectors = await embedWith(
            model,
            batch.map((c) => `${c.header}\n\n${c.text}`),
            "doc",
          );
          transaction(db, () => {
            batch.forEach((c, j) => {
              putVector(db, id, c.rowid, vectors[j]);
            });
          });
        }
      });
      embedded = todo.length;
      const now = env.now().toISOString();
      setSpace(db, space.id, { complete: true, builtAt: now, lastUsed: now });
    } else ctx.log("warn", degraded ?? "No embedding model: lexical index only.");
    ctx.step?.("save");
    ctx.progress({ message: "Index up to date", done: embedded, total: embedded });
    const embedding = model?.entry.id ?? "none";
    const dims = space?.dims ?? 0;
    if (live) {
      const state: IndexState = {
        embedding,
        dims,
        builtAt: env.now().toISOString(),
        docs: Object.fromEntries(docs.map((d) => [d.doc.id, d.content])),
        space: space?.id ?? null,
      };
      writeJson(stateFile(project), state);
    }
    return {
      embedding,
      dims,
      vectorsRebuilt,
      ...(space ? { space: space.id } : {}),
      ...(degraded ? { degraded } : {}),
      docs: report,
      chunks: chunkCount(db),
      embedded,
      ms: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}
