import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexFile, insertChunk, openDb, setMeta } from "../../../../src/core/rag/db.ts";
import { readState } from "../../../../src/core/rag/indexer.ts";
import { bm25 } from "../../../../src/core/rag/search/lexical.ts";
import { passage } from "../../../../src/core/rag/search/passage.ts";

describe("an index file that is not in a project folder", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("is searched by its words alone, with no project glossary", () => {
    dir = mkdtempSync(join(tmpdir(), "testimus-lexical-outside-"));
    const deep = join(dir, "a", "b", "c", "d", "e");
    mkdirSync(deep, { recursive: true });
    const db = openDb(join(deep, "rag.db"));
    const id = insertChunk(
      db,
      {
        id: "D#§1",
        docId: "D",
        anchor: "§1",
        path: "1",
        figureIds: [],
        header: "Document D",
        text: "Le PTS alimente la ligne de traction.",
        kind: "section",
      },
      "D#§1",
    );
    expect(bm25(db, "traction", {})).toEqual([id]);
    expect(bm25(db, "secours", {})).toEqual([]);
    db.close();
  });
});

describe("a passage asked around a quote", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("says whether the quote is in the section, and a quote of only markup is not looked for", () => {
    dir = mkdtempSync(join(tmpdir(), "testimus-passage-quote-"));
    cpSync(resolve(import.meta.dirname, "../../../fixtures/project"), dir, { recursive: true });
    const ref = "SOSIE_211_D401-1_3#§5.6.6";
    expect(passage(dir, ref, "l'état OUVERT ou fermé").quoteFound).toBe(true);
    expect(passage(dir, ref, "un texte absent").quoteFound).toBe(false);
    expect(passage(dir, ref, "**").quoteFound).toBe(false);
    expect(passage(dir, ref, "  ").quoteFound).toBeUndefined();
  });
});

describe("an index whose state cannot be read", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("counts as never built, so the next index run starts again", () => {
    dir = mkdtempSync(join(tmpdir(), "testimus-index-state-"));
    cpSync(resolve(import.meta.dirname, "../../../fixtures/project"), dir, { recursive: true });
    const db = openDb(indexFile(dir));
    setMeta(db, "index_state", "{ not json");
    db.close();
    expect(readState(dir)).toBeNull();
  });
});
