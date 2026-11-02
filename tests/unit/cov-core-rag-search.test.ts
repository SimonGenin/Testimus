import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../src/core/rag/db.ts";
import { expand, glossaryOf, parseGlossary } from "../../src/core/rag/glossary.ts";
import { bm25, ftsQuery } from "../../src/core/rag/search/lexical.ts";
import { figure, passage } from "../../src/core/rag/search/passage.ts";
import { stemWord } from "../../src/core/rag/stem-fr.ts";

let dir = "";
const addDoc = (id: string, md: string, json?: Record<string, unknown>) => {
  mkdirSync(join(dir, "docs", id), { recursive: true });
  writeFileSync(join(dir, "docs", id, "doc.md"), md);
  if (json) writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify(json));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-search-"));
  writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t" }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("passage — the less common anchors", () => {
  const MD = [
    "<!-- fig 1 --> Figure 1 – Vue générale",
    "",
    "| Exigence | Section | Objet |",
    "| --- | --- | --- |",
    "| EXI_TOP_1 | 9 | Exigence tracée vers une section absente |",
    "| EXI_TOP_2 | 9 | Seconde exigence tracée ailleurs |",
    "| EXI_TOP_3 | 7 | Troisième exigence |",
    "| EXI_TOP_4 |  | Exigence sans section |",
    "",
    "<!-- req EXI_EARLY_1 -->",
    "Une exigence avant toute section.",
    "",
    "## 1 Général <!-- § 1 -->",
    "",
    "Le texte cite EXI_INLINE_1 <!-- req EXI_INLINE_1 --> dans une phrase.",
  ].join("\n");

  beforeEach(() => addDoc("P", MD));

  it("refuses a document the project does not have", () => {
    expect(() => passage(dir, "NOPE#§1")).toThrow(/No document NOPE/);
    expect(() => figure(dir, "NOPE", "1")).toThrow(/No document NOPE/);
  });

  it("a document without doc.json gets default metadata", () => {
    expect(passage(dir, "P#§1").doc).toEqual({
      code: "P",
      title: "",
      version: "",
      status: "draft",
      binding: "informative",
    });
  });

  it("a figure before any section has no path, and an unknown figure is refused", () => {
    expect(passage(dir, "P#fig:1")).toMatchObject({ path: "", title: "Figure 1 – Vue générale" });
    expect(figure(dir, "P", "fig:1")).toMatchObject({ n: "1", path: "" });
    expect(() => passage(dir, "P#fig:99")).toThrow(/has no anchor fig:99/);
  });

  it("a matrix row traced to a missing section outside any section has no path nor title", () => {
    expect(passage(dir, "P#req:EXI_TOP_1@matrix")).toMatchObject({ path: "", title: "" });
    expect(passage(dir, "P#req:EXI_TOP_4@matrix")).toMatchObject({ path: "", title: "" });
    expect(() => passage(dir, "P#req:EXI_NONE@matrix")).toThrow(/has no anchor/);
  });

  it("a requirement only marked inline focuses on its marker line; one before any section is refused", () => {
    expect(passage(dir, "P#req:EXI_INLINE_1")).toMatchObject({ anchor: "req:EXI_INLINE_1", path: "1" });
    expect(() => passage(dir, "P#req:EXI_EARLY_1")).toThrow(/has no anchor/);
    expect(() => passage(dir, "P#req:EXI_GHOST_1")).toThrow(/has no anchor/);
  });
});

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

describe("glossary", () => {
  it("rejects cells that are not abbreviations and the header row of a table", () => {
    const md = [
      "## Glossaire <!-- § 2 -->",
      "",
      "| Sigle | Signification |",
      "| --- | --- |",
      "| | vide |",
      "| un sigle beaucoup trop long pour en être un vraiment | long |",
      "| A B C D E | trop de mots |",
      "| -X | ne commence pas par une lettre |",
      "| minuscule | sans majuscule |",
      "| PCC | Poste de commande centralisé |",
    ].join("\n");
    expect(parseGlossary(md, "D").map((g) => g.abbr)).toEqual(["PCC"]);
  });

  it("dedupes entries, re-reads a touched but identical doc.md from its cache, and expands each form once", () => {
    writeFileSync(
      join(dir, "project.json"),
      JSON.stringify({ name: "t", glossary: { PCC: "Poste de commande centralisé" } }),
    );
    const md = "## Acronymes\n\n- PCC : Poste de commande centralisé\n- TK : télécommande\n";
    addDoc("G", md);
    expect(glossaryOf(dir).map((g) => `${g.abbr}=${g.source}`)).toEqual(["PCC=project.json", "TK=G"]);
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dir, "docs", "G", "doc.md"), later, later);
    expect(glossaryOf(dir)).toHaveLength(2);
    const g = [
      { abbr: "TK", long: "télécommande", source: "a" },
      { abbr: "TCK", long: "télécommande", source: "b" },
      { abbr: "", long: "", source: "c" },
    ];
    expect(expand(g, "TK TCK")).toEqual(["télécommande"]);
  });
});

describe("stem-fr", () => {
  it("drops -iv after -ité only in R2", () => {
    expect(stemWord("relativité")).toBe("relat");
    expect(stemWord("passivité")).toBe("passiv");
  });

  it("clears its cache past 50 000 words and still stems", () => {
    for (let i = 0; i < 50_002; i++) stemWord(`mot${i}`);
    expect(stemWord("sectionneurs")).toBe(stemWord("sectionneur"));
  });
});
