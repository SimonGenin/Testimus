import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "../lib/hash.ts";
import type { Chunk, Edge, EdgeKind, SpaceFingerprint, VectorSpace } from "../types.ts";
import { STEM_VERSION, stemText } from "./stem-fr.ts";

export type ChunkRow = Chunk & { rowid: number; hash: string };

const require = createRequire(import.meta.url);

export const RECIPE = 1;

export function indexFile(project: string): string {
  return join(project, "index", "rag.db");
}

export function openDb(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { allowExtension: true });
  (require("sqlite-vec") as { load(db: DatabaseSync): void }).load(db);
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists meta (key text primary key, value text not null);
    create table if not exists docs (
      doc_id text primary key, sha256 text not null, content text not null
    );
    create table if not exists chunks (
      rowid integer primary key, id text not null unique, doc_id text not null, anchor text not null,
      path text not null, figure_ids text not null, header text not null,
      text text not null, kind text not null, hash text not null
    );
    create index if not exists chunks_doc on chunks(doc_id);
    create table if not exists edges (src text not null, dst text not null, kind text not null, doc_id text not null);
    create index if not exists edges_src on edges(src);
    create index if not exists edges_dst on edges(dst);
    create index if not exists edges_doc on edges(doc_id);
    create table if not exists spaces (
      id text primary key, fingerprint text not null, model_id text not null, dims integer not null,
      built_at text, complete integer not null default 0, last_used text
    );
  `);
  migrateFts(db);
  migrateChunks(db);
  return db;
}

// ponytail: the one place a rag.db handle is closed — after the work, whether it returns, throws or settles later
export function withDb<T>(file: string, work: (db: DatabaseSync) => T): T {
  const db = openDb(file);
  let out: T;
  try {
    out = work(db);
  } catch (e) {
    db.close();
    throw e;
  }
  if (out instanceof Promise) return out.finally(() => db.close()) as T;
  db.close();
  return out;
}

export function withIndex<T>(project: string, none: T, work: (db: DatabaseSync) => T): T {
  const file = indexFile(project);
  return existsSync(file) ? withDb(file, work) : none;
}

const CHUNK_COLUMNS = new Set([
  "rowid",
  "id",
  "doc_id",
  "anchor",
  "path",
  "figure_ids",
  "header",
  "text",
  "kind",
  "hash",
]);

// ponytail: an index written by an older chunker (a column or a chunk kind this one no longer makes) is cut back to
// the current shape in place — sections and figures keep their rows and vectors, the FTS and the graph are rebuilt,
// and every document is chunked again at the next index
function migrateChunks(db: DatabaseSync): void {
  const extra = (db.prepare("select name from pragma_table_info('chunks')").all() as { name: string }[])
    .map((c) => c.name)
    .filter((n) => !CHUNK_COLUMNS.has(n));
  if (!extra.length) return;
  transaction(db, () => {
    const stale = db.prepare("select rowid from chunks where kind not in ('section', 'figure')").all() as {
      rowid: number;
    }[];
    for (const r of stale) deleteChunk(db, Number(r.rowid));
    for (const n of extra) db.exec(`alter table chunks drop column "${n}"`);
    db.exec("delete from edges");
    db.exec("delete from docs");
  });
  rebuildFts(db);
}

const FTS = `create virtual table chunks_fts using fts5(
  header, text, codes, stem, tokenize = 'unicode61 remove_diacritics 2'
)`;

function ftsRow(c: Pick<Chunk, "header" | "text" | "figureIds" | "anchor">) {
  return [
    c.header,
    c.text,
    [...c.figureIds.map((f) => `fig ${f}`), c.anchor.replace(/^§/, "")].join(" "),
    stemText(`${c.header}\n${c.text}`),
  ];
}

export function rebuildFts(db: DatabaseSync): void {
  transaction(db, () => {
    db.exec("drop table if exists chunks_fts");
    db.exec(FTS);
    const insert = db.prepare("insert into chunks_fts(rowid, header, text, codes, stem) values (?, ?, ?, ?, ?)");
    for (const c of (db.prepare("select * from chunks").all() as RawChunk[]).map(toChunk))
      insert.run(c.rowid, ...ftsRow(c));
    setMeta(db, "stem_version", String(STEM_VERSION));
  });
}

function migrateFts(db: DatabaseSync): void {
  const sql = (
    db.prepare("select sql from sqlite_master where name = 'chunks_fts'").get() as { sql: string } | undefined
  )?.sql;
  if (sql?.includes("stem") && getMeta(db, "stem_version") === String(STEM_VERSION)) return;
  rebuildFts(db);
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const r = db.prepare("select value from meta where key = ?").get(key) as { value: string } | undefined;
  return r?.value;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("insert into meta(key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(
    key,
    value,
  );
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec("begin");
  try {
    const r = work();
    db.exec("commit");
    return r;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}

// Vector spaces

function fingerprintJson(fp: SpaceFingerprint): string {
  const keys = Object.keys(fp).sort() as (keyof SpaceFingerprint)[];
  return JSON.stringify(Object.fromEntries(keys.filter((k) => fp[k] !== undefined).map((k) => [k, fp[k]])));
}

export function spaceId(fp: SpaceFingerprint): string {
  return sha256(fingerprintJson(fp)).slice(0, 12);
}

export function vecTable(id: string): string {
  if (!/^[0-9a-f]{12}$/.test(id)) throw new Error(`Bad space id ${id}`);
  return `vec_${id}`;
}

type RawSpace = {
  id: string;
  fingerprint: string;
  model_id: string;
  dims: number;
  built_at: string | null;
  complete: number;
  last_used: string | null;
};

function toSpace(r: RawSpace): VectorSpace {
  return {
    id: r.id,
    fingerprint: JSON.parse(r.fingerprint),
    modelId: r.model_id,
    dims: Number(r.dims),
    builtAt: r.built_at,
    complete: !!r.complete,
    lastUsed: r.last_used,
  };
}

export function listSpaces(db: DatabaseSync): VectorSpace[] {
  return (db.prepare("select * from spaces order by last_used desc, id").all() as RawSpace[]).map(toSpace);
}

export function getSpace(db: DatabaseSync, id: string): VectorSpace | undefined {
  const r = db.prepare("select * from spaces where id = ?").get(id) as RawSpace | undefined;
  return r ? toSpace(r) : undefined;
}

export function createSpace(db: DatabaseSync, fp: SpaceFingerprint): VectorSpace {
  const id = spaceId(fp);
  transaction(db, () => {
    db.prepare("insert or ignore into spaces(id, fingerprint, model_id, dims, complete) values (?, ?, ?, ?, 0)").run(
      id,
      fingerprintJson(fp),
      fp.modelId,
      fp.dims,
    );
    db.exec(
      `create virtual table if not exists ${vecTable(id)} using vec0(chunk_rowid integer primary key, embedding float[${fp.dims}] distance_metric=cosine)`,
    );
  });
  return getSpace(db, id) as VectorSpace;
}

export function setSpace(
  db: DatabaseSync,
  id: string,
  patch: { complete?: boolean; builtAt?: string | null; lastUsed?: string | null },
): void {
  if (patch.complete !== undefined)
    db.prepare("update spaces set complete = ? where id = ?").run(patch.complete ? 1 : 0, id);
  if (patch.builtAt !== undefined) db.prepare("update spaces set built_at = ? where id = ?").run(patch.builtAt, id);
  if (patch.lastUsed !== undefined) db.prepare("update spaces set last_used = ? where id = ?").run(patch.lastUsed, id);
}

export function dropSpace(db: DatabaseSync, id: string): void {
  transaction(db, () => {
    db.exec(`drop table if exists ${vecTable(id)}`);
    db.prepare("delete from spaces where id = ?").run(id);
  });
}

export function vectorCount(db: DatabaseSync, id: string): number {
  return Number((db.prepare(`select count(*) n from ${vecTable(id)}`).get() as { n: number }).n);
}

export function missingVectors(db: DatabaseSync, id: string): ChunkRow[] {
  return (
    db
      .prepare(`select * from chunks where rowid not in (select chunk_rowid from ${vecTable(id)}) order by rowid`)
      .all() as RawChunk[]
  ).map(toChunk);
}

export function putVector(db: DatabaseSync, id: string, rowid: number, v: Float32Array): void {
  db.prepare(`insert into ${vecTable(id)}(chunk_rowid, embedding) values (?, ?)`).run(BigInt(rowid), v);
}

export function nearest(
  db: DatabaseSync,
  id: string,
  q: Float32Array,
  k: number,
): { rowid: number; distance: number }[] {
  if (k <= 0) return [];
  return (
    db
      .prepare(`select chunk_rowid, distance from ${vecTable(id)} where embedding match ? and k = ? order by distance`)
      .all(q, k) as { chunk_rowid: number; distance: number }[]
  ).map((r) => ({ rowid: Number(r.chunk_rowid), distance: r.distance }));
}

// Chunks

type RawChunk = {
  rowid: number;
  id: string;
  doc_id: string;
  anchor: string;
  path: string;
  figure_ids: string;
  header: string;
  text: string;
  kind: string;
  hash: string;
};

export function toChunk(r: RawChunk): ChunkRow {
  return {
    rowid: Number(r.rowid),
    id: r.id,
    docId: r.doc_id,
    anchor: r.anchor,
    path: r.path,
    figureIds: JSON.parse(r.figure_ids),
    header: r.header,
    text: r.text,
    kind: r.kind as Chunk["kind"],
    hash: r.hash,
  };
}

export function chunksOf(db: DatabaseSync, docId: string): ChunkRow[] {
  return (db.prepare("select * from chunks where doc_id = ?").all(docId) as RawChunk[]).map(toChunk);
}

export function allChunks(db: DatabaseSync): ChunkRow[] {
  return (db.prepare("select * from chunks order by rowid").all() as RawChunk[]).map(toChunk);
}

export function chunksByRowid(db: DatabaseSync, rowids: number[]): Map<number, ChunkRow> {
  const out = new Map<number, ChunkRow>();
  if (!rowids.length) return out;
  const rows = db
    .prepare(`select * from chunks where rowid in (${rowids.map(() => "?").join(",")})`)
    .all(...rowids) as RawChunk[];
  for (const r of rows) out.set(Number(r.rowid), toChunk(r));
  return out;
}

export function insertChunk(db: DatabaseSync, c: Chunk, hash: string): number {
  const r = db
    .prepare(
      `insert into chunks(id, doc_id, anchor, path, figure_ids, header, text, kind, hash)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(c.id, c.docId, c.anchor, c.path, JSON.stringify(c.figureIds), c.header, c.text, c.kind, hash);
  const rowid = Number(r.lastInsertRowid);
  db.prepare("insert into chunks_fts(rowid, header, text, codes, stem) values (?, ?, ?, ?, ?)").run(
    rowid,
    ...ftsRow(c),
  );
  return rowid;
}

// ponytail: a changed chunk loses its vectors in every space; the inactive ones become incomplete
export function deleteChunk(db: DatabaseSync, rowid: number): void {
  db.prepare("delete from chunks where rowid = ?").run(rowid);
  db.prepare("delete from chunks_fts where rowid = ?").run(rowid);
  for (const s of listSpaces(db)) {
    db.prepare(`delete from ${vecTable(s.id)} where chunk_rowid = ?`).run(BigInt(rowid));
    if (s.complete) setSpace(db, s.id, { complete: false });
  }
}

export function indexedContents(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("select doc_id, content from docs").all() as { doc_id: string; content: string }[];
  return new Map(rows.map((r) => [r.doc_id, r.content]));
}

export function chunkCount(db: DatabaseSync): number {
  return Number((db.prepare("select count(*) n from chunks").get() as { n: number }).n);
}

// Document graph

export function replaceEdges(db: DatabaseSync, docId: string, edges: Edge[]): void {
  transaction(db, () => {
    db.prepare("delete from edges where doc_id = ?").run(docId);
    const insert = db.prepare("insert into edges(src, dst, kind, doc_id) values (?, ?, ?, ?)");
    for (const e of edges) insert.run(e.from, e.to, e.kind, e.docId);
  });
}

type RawEdge = { src: string; dst: string; kind: string; doc_id: string };
const toEdge = (r: RawEdge): Edge => ({ from: r.src, to: r.dst, kind: r.kind as EdgeKind, docId: r.doc_id });

export function edgesOf(db: DatabaseSync, docId: string): Edge[] {
  return (db.prepare("select * from edges where doc_id = ?").all(docId) as RawEdge[]).map(toEdge);
}
