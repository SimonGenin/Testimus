import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSpace,
  deleteChunk,
  dropSpace,
  edgesFrom,
  edgesTo,
  findSpace,
  getSpace,
  insertChunk,
  listSpaces,
  missingVectors,
  nearest,
  openDb,
  putVector,
  replaceEdges,
  setSpace,
  spaceId,
  vectorCount,
} from "../../src/core/rag/db.ts";
import type { Chunk, SpaceFingerprint } from "../../src/core/types.ts";

const require = createRequire(import.meta.url);

const fp = (over: Partial<SpaceFingerprint> = {}): SpaceFingerprint => ({
  runtime: "transformers",
  model: "sha:abc",
  modelId: "bge-m3-q8",
  pooling: "cls",
  normalize: true,
  queryInstruction: "",
  docInstruction: "",
  dims: 4,
  maxInputTokens: 8192,
  recipe: 1,
  ...over,
});

const chunk = (id: string): Chunk => ({
  id: `D#§${id}`,
  docId: "D",
  anchor: `§${id}`,
  path: id,
  reqIds: [],
  figureIds: [],
  header: "D — header",
  text: `texte ${id}`,
  kind: "section",
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-db-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("rag.db schema v2", () => {
  it("migrates a v1 index: vecs becomes an unpinned space, FTS gains the stem column", () => {
    const file = join(dir, "rag.db");
    const old = new DatabaseSync(file, { allowExtension: true });
    (require("sqlite-vec") as { load(db: DatabaseSync): void }).load(old);
    old.exec(`
      create table meta (key text primary key, value text not null);
      create table chunks (
        rowid integer primary key, id text not null unique, doc_id text not null, anchor text not null,
        path text not null, req_ids text not null, figure_ids text not null, header text not null,
        text text not null, kind text not null, hash text not null, superseded integer not null default 0
      );
      create virtual table chunks_fts using fts5(header, text, codes, tokenize = 'unicode61 remove_diacritics 2');
      create virtual table vecs using vec0(chunk_rowid integer primary key, embedding float[4] distance_metric=cosine);
      insert into meta values ('embedding', 'bge-m3'), ('dims', '4');
      insert into chunks values (1, 'D#§1', 'D', '§1', '1', '[]', '[]', 'h', 'sectionneur ouvert', 'section', 'x', 0);
      insert into chunks_fts(rowid, header, text, codes) values (1, 'h', 'sectionneur ouvert', '1');
    `);
    old.prepare("insert into vecs(chunk_rowid, embedding) values (?, ?)").run(1n, new Float32Array([1, 0, 0, 0]));
    old.close();

    const db = openDb(file);
    try {
      expect(db.prepare("select 1 from sqlite_master where name = 'vecs'").get()).toBeUndefined();
      const [s] = listSpaces(db);
      expect(s.fingerprint.unpinned).toBe(true);
      expect(s.modelId).toBe("bge-m3");
      expect(s.complete).toBe(true);
      expect(vectorCount(db, s.id)).toBe(1);
      expect(nearest(db, s.id, new Float32Array([1, 0, 0, 0]), 1)[0].rowid).toBe(1);
      const sql = (db.prepare("select sql from sqlite_master where name = 'chunks_fts'").get() as { sql: string }).sql;
      expect(sql).toContain("stem");
      expect(db.prepare("select rowid from chunks_fts where chunks_fts match 'sectionneur'").all()).toHaveLength(1);
      expect(findSpace(db, fp({ modelId: "bge-m3", dims: 4 }))?.id).toBe(s.id);
    } finally {
      db.close();
    }
    const again = openDb(file);
    expect(listSpaces(again)).toHaveLength(1);
    again.close();
  });

  it("keeps several spaces; a changed chunk loses its vectors everywhere and spaces become incomplete", () => {
    const db = openDb(join(dir, "rag.db"));
    try {
      const a = createSpace(db, fp());
      const b = createSpace(db, fp({ model: "sha:def", modelId: "qwen", dims: 2 }));
      expect(a.id).toBe(spaceId(fp()));
      expect(a.id).not.toBe(b.id);
      const r1 = insertChunk(db, chunk("1"), "h1", false);
      const r2 = insertChunk(db, chunk("2"), "h2", false);
      putVector(db, a.id, r1, new Float32Array([1, 0, 0, 0]));
      putVector(db, a.id, r2, new Float32Array([0, 1, 0, 0]));
      putVector(db, b.id, r1, new Float32Array([1, 0]));
      setSpace(db, a.id, { complete: true, builtAt: "t", lastUsed: "t" });
      expect(missingVectors(db, b.id).map((c) => c.rowid)).toEqual([r2]);
      deleteChunk(db, r1);
      expect(vectorCount(db, a.id)).toBe(1);
      expect(vectorCount(db, b.id)).toBe(0);
      expect(getSpace(db, a.id)?.complete).toBe(false);
      dropSpace(db, b.id);
      expect(listSpaces(db).map((s) => s.id)).toEqual([a.id]);
      expect(db.prepare(`select 1 from sqlite_master where name = 'vec_${b.id}'`).get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("stores the requirement graph per document", () => {
    const db = openDb(join(dir, "rag.db"));
    try {
      replaceEdges(db, "D", [
        { from: "D#req:EXI_1", to: "D#§3.2", kind: "defines", docId: "D" },
        { from: "D#§5.6", to: "D#req:EXI_1", kind: "mentions", docId: "D" },
      ]);
      replaceEdges(db, "D", [{ from: "D#req:EXI_1", to: "D#§3.2.4", kind: "traces", docId: "D" }]);
      expect(edgesFrom(db, "D#req:EXI_1")).toEqual([
        { from: "D#req:EXI_1", to: "D#§3.2.4", kind: "traces", docId: "D" },
      ]);
      expect(edgesTo(db, "D#req:EXI_1")).toEqual([]);
    } finally {
      db.close();
    }
  });
});
