import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Ctx, quietCtx } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import { resolveModel } from "../../../../src/core/rag/activation.ts";
import type { DescribeChunks } from "../../../../src/core/rag/chunk.ts";
import { chunkCount, indexFile, listSpaces, missingVectors, openDb, vectorCount } from "../../../../src/core/rag/db.ts";
import { indexProject, projectDocs, readState, unindexDoc } from "../../../../src/core/rag/indexer.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
let dir = "";

const ctxWith = (over: Partial<Ctx> = {}): Ctx => ({ ...quietCtx(dir), ...over });
const docJson = (id: string) => join(dir, "docs", id, "doc.json");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-indexer-"));
  cpSync(FIXTURE, dir, { recursive: true });
  env.mock = true;
});
afterEach(() => {
  env.mock = false;
  rmSync(dir, { recursive: true, force: true });
});

describe("projectDocs", () => {
  it("is empty without a docs folder", () => {
    rmSync(join(dir, "docs"), { recursive: true });
    expect(projectDocs(dir)).toEqual([]);
  });

  it("skips files and incomplete folders, and names a doc without id after its folder", () => {
    writeFileSync(join(dir, "docs", "notes.txt"), "x");
    mkdirSync(join(dir, "docs", "HALF"));
    writeFileSync(join(dir, "docs", "HALF", "doc.json"), "{}");
    const j = JSON.parse(readFileSync(docJson(D3), "utf8"));
    delete j.id;
    writeFileSync(docJson(D3), JSON.stringify(j));
    expect(projectDocs(dir).map((d) => d.doc.id)).toEqual([
      "Manoeuvre_d_un_sectionneur_au_PCC",
      "Notes_de_reunion",
      "RECETTE_TCO_12-10",
      D3,
      "SOSIE_211_D401-1_4",
    ]);
  });
});

describe("indexProject — less common paths", () => {
  it("context headers: a non-Error failure keeps the defaults, an empty answer keeps a chunk's own header", async () => {
    const warnings: string[] = [];
    const boom: DescribeChunks = async () => {
      throw "boom";
    };
    await indexProject(dir, ctxWith({ project: null, log: (_l, m) => warnings.push(m) }), {
      model: null,
      describe: boom,
    });
    expect(warnings.some((w) => w.includes("default used (boom)"))).toBe(true);
    let seenProject: string | undefined = "unset";
    const blank: DescribeChunks = async (_doc, chunks, _signal, project) => {
      seenProject = project;
      return chunks.map(() => "  ");
    };
    writeFileSync(
      join(dir, "docs", D3, "doc.md"),
      `${readFileSync(join(dir, "docs", D3, "doc.md"), "utf8")}\nAjout.\n`,
    );
    const r = await indexProject(dir, ctxWith({ project: null }), { model: null, describe: blank });
    expect(seenProject).toBeUndefined();
    expect(r.docs.find((d) => d.docId === D3)?.status).toBe("indexed");
  });

  it("an unchanged document without a source hash stays unchanged", async () => {
    await indexProject(dir, quietCtx(dir), { model: null });
    const j = JSON.parse(readFileSync(docJson(D3), "utf8"));
    delete j.source;
    writeFileSync(docJson(D3), JSON.stringify(j));
    const r = await indexProject(dir, quietCtx(dir), { model: null });
    expect(r.docs.find((d) => d.docId === D3)?.status).toBe("unchanged");
    expect(r.embedding).toBe("none");
  });

  it("indexes with a given model", async () => {
    const r = await indexProject(dir, quietCtx(dir), { model: resolveModel("bge-m3-q8") });
    expect(r.embedding).toBe("bge-m3-q8");
    expect(r.embedded).toBeGreaterThan(0);
  });

  it("unindexDoc drops a document's rows, vectors, links and state, and keeps the space complete", async () => {
    unindexDoc(dir, D3);
    await indexProject(dir, quietCtx(dir), { model: resolveModel("bge-m3-q8") });
    const count = (sql: string) => {
      const db = openDb(indexFile(dir));
      try {
        return Number((db.prepare(sql).get(D3) as { n: number }).n);
      } finally {
        db.close();
      }
    };
    expect(count("select count(*) n from chunks where doc_id = ?")).toBeGreaterThan(0);
    unindexDoc(dir, D3);
    expect(count("select count(*) n from chunks where doc_id = ?")).toBe(0);
    expect(count("select count(*) n from docs where doc_id = ?")).toBe(0);
    expect(count("select count(*) n from edges where doc_id = ?")).toBe(0);
    const db = openDb(indexFile(dir));
    try {
      const [space] = listSpaces(db);
      expect(space.complete).toBe(true);
      expect(missingVectors(db, space.id)).toEqual([]);
      expect(vectorCount(db, space.id)).toBe(chunkCount(db));
      expect(db.prepare("select count(*) n from chunks_fts").get()).toEqual({ n: chunkCount(db) });
    } finally {
      db.close();
    }
    expect(readState(dir)?.docs).not.toHaveProperty(D3);
    unindexDoc(dir, D3);
  });

  it("stops before chunking when already cancelled", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(indexProject(dir, quietCtx(dir, ctl.signal), { model: null })).rejects.toThrow(/cancelled/);
  });

  it("stops between embedding batches when cancelled", async () => {
    mkdirSync(join(dir, "docs", "BIG"));
    writeFileSync(
      join(dir, "docs", "BIG", "doc.md"),
      Array.from(
        { length: 40 },
        (_, i) => `## ${i + 1} Section ${i + 1} <!-- § ${i + 1} -->\n\nTexte numéro ${i + 1}.\n`,
      ).join("\n"),
    );
    writeFileSync(join(dir, "docs", "BIG", "doc.json"), JSON.stringify({ id: "BIG", code: "BIG", title: "Big" }));
    const ctl = new AbortController();
    const ctx = ctxWith({
      signal: ctl.signal,
      progress: (p) => {
        if (p.message.startsWith("Embedding")) ctl.abort();
      },
    });
    await expect(indexProject(dir, ctx, { model: resolveModel("bge-m3-q8") })).rejects.toThrow(/cancelled/);
  });
});
