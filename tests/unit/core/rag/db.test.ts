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
  edgesOf,
  getSpace,
  insertChunk,
  listSpaces,
  missingVectors,
  openDb,
  putVector,
  replaceEdges,
  setSpace,
  spaceId,
  vectorCount,
} from "../../../../src/core/rag/db.ts";
import type { Chunk, SpaceFingerprint } from "../../../../src/core/types.ts";

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
  it("migrates an older index: FTS gains the stem column, the chunks lose their dropped columns", () => {
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
      insert into meta values ('embedding', 'bge-m3'), ('dims', '4');
      insert into chunks values (1, 'D#§1', 'D', '§1', '1', '[]', '[]', 'h', 'sectionneur ouvert', 'section', 'x', 0);
      insert into chunks_fts(rowid, header, text, codes) values (1, 'h', 'sectionneur ouvert', '1');
    `);
    old.close();

    const db = openDb(file);
    try {
      expect(listSpaces(db)).toEqual([]);
      const sql = (db.prepare("select sql from sqlite_master where name = 'chunks_fts'").get() as { sql: string }).sql;
      expect(sql).toContain("stem");
      expect(db.prepare("select rowid from chunks_fts where chunks_fts match 'sectionneur'").all()).toHaveLength(1);
    } finally {
      db.close();
    }
    const again = openDb(file);
    expect(again.prepare("select count(*) as n from chunks").get()).toEqual({ n: 1 });
    again.close();
  });

  it("keeps several spaces; a changed chunk loses its vectors everywhere and spaces become incomplete", () => {
    const db = openDb(join(dir, "rag.db"));
    try {
      const a = createSpace(db, fp());
      const b = createSpace(db, fp({ model: "sha:def", modelId: "qwen", dims: 2 }));
      expect(a.id).toBe(spaceId(fp()));
      expect(a.id).not.toBe(b.id);
      const r1 = insertChunk(db, chunk("1"), "h1");
      const r2 = insertChunk(db, chunk("2"), "h2");
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

  it("stores the document graph per document", () => {
    const db = openDb(join(dir, "rag.db"));
    try {
      replaceEdges(db, "D", [
        { from: "D#§3.2", to: "D#§3", kind: "parent", docId: "D" },
        { from: "D#§5.6", to: "D#§3.2", kind: "refers", docId: "D" },
      ]);
      replaceEdges(db, "D", [{ from: "D#§5.6", to: "D#§3.2.4", kind: "refers", docId: "D" }]);
      expect(edgesOf(db, "D").filter((e) => e.from === "D#§5.6")).toEqual([
        { from: "D#§5.6", to: "D#§3.2.4", kind: "refers", docId: "D" },
      ]);
      expect(edgesOf(db, "D").filter((e) => e.to === "D#§3")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("cuts an index of an older chunker back to sections and figures: no extra column, no other kind", () => {
    const file = join(dir, "rag.db");
    const db = openDb(file);
    const s = createSpace(db, fp());
    const keep = insertChunk(db, chunk("1"), "h1");
    putVector(db, s.id, keep, new Float32Array([1, 0, 0, 0]));
    setSpace(db, s.id, { complete: true });
    db.exec("alter table chunks add column req_ids text not null default '[]'");
    db.prepare(
      "insert into chunks(id, doc_id, anchor, path, req_ids, figure_ids, header, text, kind, hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "D#req:EXI_1@matrix",
      "D",
      "req:EXI_1@matrix",
      "",
      '["EXI_1"]',
      "[]",
      "h",
      "EXI_1 | ligne",
      "matrix-row",
      "x",
    );
    const row = Number(
      (db.prepare("select rowid from chunks where kind = 'matrix-row'").get() as { rowid: number }).rowid,
    );
    putVector(db, s.id, row, new Float32Array([0, 1, 0, 0]));
    db.prepare("insert into docs(doc_id, sha256, content) values ('D', '', 'c')").run();
    replaceEdges(db, "D", [{ from: "D#§1", to: "D#§2", kind: "refers", docId: "D" }]);
    db.close();

    const again = openDb(file);
    try {
      const cols = (again.prepare("select name from pragma_table_info('chunks')").all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).not.toContain("req_ids");
      expect((again.prepare("select id, kind from chunks").all() as { id: string }[]).map((c) => c.id)).toEqual([
        "D#§1",
      ]);
      expect(vectorCount(again, s.id)).toBe(1);
      expect(getSpace(again, s.id)?.complete).toBe(false);
      expect(again.prepare("select * from docs").all()).toEqual([]);
      expect(edgesOf(again, "D").filter((e) => e.from === "D#§1")).toEqual([]);
      expect(again.prepare("select rowid from chunks_fts where chunks_fts match 'EXI_1'").all()).toEqual([]);
      expect(again.prepare("select rowid from chunks_fts where chunks_fts match 'texte'").all()).toHaveLength(1);
    } finally {
      again.close();
    }
    const third = openDb(file);
    expect(vectorCount(third, s.id)).toBe(1);
    third.close();
  });
});
