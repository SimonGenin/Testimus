import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CancelledError, isCancelled, type Semaphore, semaphore } from "../../shared/run/work.ts";
import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { docDir, docIds, readDoc, readDocMd, readFigures } from "../lib/docs.ts";
import { sha256 } from "../lib/hash.ts";
import { withPerfScope } from "../lib/models-perf.ts";
import type { Chunk, ClaudeRun, DocJson, FigureEntry, ResolvedModel, VectorSpace } from "../types.ts";
import { activeModels } from "./activation.ts";
import { chunkDoc, type DescribeChunks } from "./chunk.ts";
import {
  chunkCount,
  chunksOf,
  createSpace,
  deleteChunk,
  getMeta,
  indexFile,
  insertChunk,
  listSpaces,
  missingVectors,
  putVector,
  rebuildFts,
  replaceEdges,
  setMeta,
  setSpace,
  transaction,
  vecTable,
  vectorCount,
  withDb,
  withIndex,
} from "./db.ts";
import { embedWith } from "./embed.ts";
import { fingerprintOf, spaceOf } from "./fingerprint.ts";
import { docEdges } from "./graph.ts";

type DocIndexStatus = "indexed" | "unchanged" | "removed";
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
type IndexState = {
  embedding: string;
  dims: number;
  builtAt: string;
  docs: Record<string, string>;
  space?: string | null;
};

type ProjectDoc = { doc: DocJson; dir: string; md: string; figures: FigureEntry[]; content: string };

const BATCH = 16;

// ponytail: what the last complete index run of the project saw lives in rag.db itself (meta « index_state »), so the
// index is one derived file and its state can never disagree with it
const STATE = "index_state";

function stateIn(db: DatabaseSync): IndexState | null {
  try {
    const raw = getMeta(db, STATE);
    return raw ? (JSON.parse(raw) as IndexState) : null;
  } catch {
    return null;
  }
}

export function readState(project: string): IndexState | null {
  return withIndex(project, null, stateIn);
}

export function projectDocs(project: string): ProjectDoc[] {
  const out: ProjectDoc[] = [];
  for (const id of docIds(project)) {
    const dir = docDir(project, id);
    if (!existsSync(join(dir, "doc.md"))) continue;
    const doc = readDoc(project, id);
    const md = readDocMd(project, id);
    const figures = readFigures(project, id);
    out.push({ doc, dir, md, figures, content: docContent(dir, doc, md) });
  }
  return out.sort((a, b) => a.doc.id.localeCompare(b.doc.id));
}

// ponytail: changes when the index file or a document changes — the corpus tools (mentions, related) cache on it
export function corpusKey(project: string, docs: ProjectDoc[]): string {
  const file = indexFile(project);
  const mtime = existsSync(file) ? statSync(file).mtimeMs : 0;
  return [mtime, ...docs.map((d) => `${d.doc.id}:${d.content}`)].join("\n");
}

// ponytail: the dir is a document folder of docs/ — its name is the document id
export function docContent(dir: string, doc: Pick<DocJson, "code" | "title">, md?: string): string {
  const project = dirname(dirname(dir));
  const id = basename(dir);
  const text = md ?? readDocMd(project, id);
  return sha256(JSON.stringify([text, readFigures(project, id), doc.code, doc.title]));
}

function chunkHash(c: Chunk): string {
  return sha256(JSON.stringify([c.anchor, c.path, c.header, c.text, c.kind, c.figureIds])).slice(0, 16);
}

type Headers = { describe?: DescribeChunks; claude?: ClaudeRun };

async function headersFor(doc: DocJson, chunks: Chunk[], ctx: Ctx, h: Headers): Promise<string[]> {
  const fallback = chunks.map((c) => c.header);
  if (!h.describe || !chunks.length) return fallback;
  try {
    const got = await h.describe(doc, chunks, ctx.signal, ctx.project ?? undefined, h.claude);
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
  force: boolean,
  h: Headers,
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
  let headers = await headersFor(d.doc, fresh, ctx, h);
  // ponytail: forced, every chunk asks for its header again; one that comes out the same keeps its row and vectors
  if (force) {
    const all = await headersFor(d.doc, chunks, ctx, h);
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

async function chooseModel(
  project: string,
  opts: { model?: ResolvedModel | null },
): Promise<{ model: ResolvedModel | null; degraded?: string }> {
  if (opts.model !== undefined) return { model: opts.model };
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
  withIndex(project, undefined, (db) => {
    forgetDoc(db, id);
    const state = stateIn(db);
    if (state?.docs[id] === undefined) return;
    delete state.docs[id];
    setMeta(db, STATE, JSON.stringify(state));
  });
}

type IndexOpts = {
  model?: ResolvedModel | null;
  dbFile?: string;
  force?: boolean;
  describe?: DescribeChunks;
  claude?: ClaudeRun;
};

const cancelled = () => new CancelledError("Indexing cancelled.");

const lanes = new Map<string, Semaphore>();

// ponytail: one index run at a time per rag.db — a second rag.index (or a conversion's index step) waits for the first
// instead of writing the same database beside it
export function indexProject(project: string, ctx: Ctx, opts: IndexOpts = {}): Promise<IndexReport> {
  const file = opts.dbFile ?? indexFile(project);
  let lane = lanes.get(file);
  if (!lane) {
    lane = semaphore(1);
    lanes.set(file, lane);
  }
  return lane(() => runIndex(project, ctx, opts, file), ctx.signal).catch((e) => {
    throw isCancelled(e) ? cancelled() : e;
  });
}

async function runIndex(project: string, ctx: Ctx, opts: IndexOpts, file: string): Promise<IndexReport> {
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
  const h: Headers = { describe: opts.describe, claude: opts.claude };
  return withDb(file, async (db) => {
    // ponytail: --force chunks every document again and re-embeds the active space only; an unchanged chunk keeps its
    // row, so the other spaces keep their vectors (activating a model never destroys another space, SPEC-RAG P3)
    if (opts.force) db.exec("delete from docs");
    const docs = projectDocs(project);
    const report: IndexReport["docs"] = [];
    ctx.step?.("chunk");
    for (const [i, d] of docs.entries()) {
      if (ctx.signal.aborted) throw cancelled();
      ctx.progress({ message: `Chunking ${d.doc.id}`, done: i, total: docs.length });
      const status = await indexDoc(db, d, ctx, project, !!opts.force, h);
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
      space = spaceOf(db, model) ?? createSpace(db, fingerprintOf(model));
      if (opts.force) db.exec(`delete from ${vecTable(space.id)}`);
      vectorsRebuilt = vectorCount(db, space.id) === 0;
      setMeta(db, "embedding", model.entry.id);
      setMeta(db, "dims", String(space.dims));
      const todo = missingVectors(db, space.id);
      const id = space.id;
      await withPerfScope({ fingerprint: id, project, jobId: ctx.jobId }, async () => {
        for (let i = 0; i < todo.length; i += BATCH) {
          if (ctx.signal.aborted) throw cancelled();
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
      setMeta(db, STATE, JSON.stringify(state));
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
  });
}
