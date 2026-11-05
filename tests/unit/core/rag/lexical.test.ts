import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertChunk, openDb } from "../../../../src/core/rag/db.ts";
import { bm25, bm25Weights, ftsQuery } from "../../../../src/core/rag/search/lexical.ts";
import type { Chunk } from "../../../../src/core/types.ts";

describe("lexical search", () => {
  let project: string;
  let db: DatabaseSync;

  const chunk = (id: string, text: string, over: Partial<Chunk> = {}): Chunk => ({
    id: `D#§${id}`,
    docId: "D",
    anchor: `§${id}`,
    path: id,
    figureIds: [],
    header: "Document D",
    text,
    kind: "section",
    ...over,
  });

  function add(c: Chunk): number {
    return insertChunk(db, c, c.id);
  }

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "testimus-lexical-"));
    writeFileSync(
      join(project, "project.json"),
      JSON.stringify({ name: "p", glossary: { PTS: "Poste de Traction de Secours" } }),
    );
    mkdirSync(join(project, "docs", "D"), { recursive: true });
    writeFileSync(
      join(project, "docs", "D", "doc.md"),
      "## 1.4 Acronymes <!-- § 1.4 -->\n\n| Acronyme | Signification |\n| --- | --- |\n| DSO | Départ Sur Ordre |\n| IL | Incident Ligne |\n",
    );
    db = openDb(join(project, "index", "rag.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(project, { recursive: true, force: true });
  });

  describe("FTS query", () => {
    it("asks the exact columns for the forms typed and the stemmed column for their stems", () => {
      expect(ftsQuery("le menu des sectionneurs")).toBe(
        '{header text codes} : ("menu" OR "sectionneurs") OR stem : ("menu" OR "sectionneur")',
      );
    });

    it("keeps codes as exact phrases, never stemmed", () => {
      expect(ftsQuery("EXI_MOP_SPF_511_A_1670")).toBe('{header text codes} : ("exi mop spf 511 a 1670")');
    });

    it("drops articles and prepositions only: negations and restrictions stay searchable", () => {
      const q = ftsQuery("ne pas sauf excepté uniquement seulement interdit jamais sans");
      for (const w of ["ne", "pas", "sauf", "excepte", "uniquement", "seulement", "interdit", "jamais", "sans"])
        expect(q).toContain(`"${w}"`);
      expect(ftsQuery("le la les un une des du de au aux à en dans par pour sur avec")).toBe("");
      expect(ftsQuery("n'est")).toContain('stem : ("ne" OR "est")');
    });

    it("adds glossary expansions as phrases, both exact and stemmed", () => {
      const g = [{ abbr: "DSO", long: "Départ Sur Ordre", source: "D#§1.4" }];
      expect(ftsQuery("DSO", g)).toBe(
        '{header text codes} : ("dso" OR "depart sur ordre") OR stem : ("dso" OR "depart sur ordre")',
      );
      expect(ftsQuery("départs sur ordre", g)).toContain('"dso"');
    });

    it("reads three column weights, the stemmed column taking the text weight unless a fourth is given", () => {
      expect(bm25Weights()).toEqual([1, 1, 5, 1]);
      expect(bm25Weights([2, 3, 4])).toEqual([2, 3, 4, 3]);
      expect(bm25Weights([2, 3, 4, 0.5])).toEqual([2, 3, 4, 0.5]);
    });
  });

  describe("BM25 search", () => {
    it("finds stemmed forms and ranks the exact form first", () => {
      const stemmed = add(chunk("1", "Le sectionneur ouvert reste visible au poste."));
      const exact = add(chunk("2", "Les sectionneurs ouverts restent visibles au poste."));
      add(chunk("3", "Le disjoncteur se ferme."));
      expect(bm25(db, "sectionneurs ouverts", {})).toEqual([exact, stemmed]);
    });

    it("matches a code in the text exactly, not its neighbour", () => {
      const hit = add(chunk("1", "EXI_MOP_SPF_511_A_1670 : le sectionneur."));
      add(chunk("2", "EXI_MOP_SPF_511_A_1671 : le sectionneur."));
      expect(bm25(db, "EXI_MOP_SPF_511_A_1670", {})).toEqual([hit]);
    });

    it("finds negations and exceptions", () => {
      const sauf = add(chunk("1", "Tous les postes sauf le PTS."));
      const ne = add(chunk("2", "Le disjoncteur n'est commandable que depuis le PCC."));
      add(chunk("3", "Le disjoncteur est commandable depuis le poste."));
      expect(bm25(db, "sauf", {})).toEqual([sauf]);
      expect(bm25(db, "ne", {})).toEqual([ne]);
    });

    it("applies the column weights and the number of candidates", () => {
      const inHeader = add(chunk("1", "Texte quelconque du poste.", { header: "Alimentation" }));
      const inText = add(chunk("2", "Alimentation du poste.", { header: "Autre chose" }));
      expect(bm25(db, "alimentation", { retrieval: { bm25Weights: [10, 1, 5] } })[0]).toBe(inHeader);
      expect(bm25(db, "alimentation", { retrieval: { bm25Weights: [1, 10, 5] } })[0]).toBe(inText);
      expect(bm25(db, "alimentation", { retrieval: { candidates: 1 } })).toHaveLength(1);
    });

    it("expands acronyms both ways from the project's documents and project.json", () => {
      const long = add(chunk("1", "Le départ sur ordre est donné par le régulateur."));
      const short = add(chunk("2", "Le DSO est affiché sur l'IHM."));
      const secours = add(chunk("3", "Le poste de traction de secours alimente la section."));
      expect(bm25(db, "DSO", {}).sort()).toEqual([long, short].sort());
      expect(bm25(db, "départs sur ordre", {}).sort()).toEqual([long, short].sort());
      expect(bm25(db, "PTS", {})).toEqual([secours]);
    });

    it("does not take a two-letter acronym for a common word", () => {
      add(chunk("1", "Un incident ligne est signalé."));
      expect(bm25(db, "il", {})).toEqual([]);
    });

    it("filters by document before the cut, so a small document is not crowded out by a large one", () => {
      for (let i = 0; i < 30; i++) add(chunk(`${i}`, "Le disjoncteur disjoncteur disjoncteur s'ouvre."));
      const other = add(
        chunk("1", "Le disjoncteur et bien d'autres mots encore dans ce texte.", { id: "E#§1", docId: "E" }),
      );
      expect(bm25(db, "disjoncteur", { docIds: ["E"], retrieval: { candidates: 5 } })).toEqual([other]);
    });
  });
});

describe("lexical — less common inputs", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-cov-search-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t" }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("lexical", () => {
    it("skips empty words and glossary expansions without letters", () => {
      const q = ftsQuery(" XYZ", [{ abbr: "XYZ", long: "—", source: "p" }]);
      expect(q).toMatch(/^\{header text codes\} : \("xyz"\) OR stem : /);
      expect(q).not.toContain("—");
      expect(ftsQuery("   ")).toBe("");
    });

    it("an in-memory index has no project, and an empty query finds nothing", () => {
      const db = openDb(":memory:");
      try {
        expect(bm25(db, "", {})).toEqual([]);
        expect(bm25(db, "sectionneur", {})).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});
