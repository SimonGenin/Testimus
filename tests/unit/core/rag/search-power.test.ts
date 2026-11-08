import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { indexFile, withDb } from "../../../../src/core/rag/db.ts";
import { expandTerm } from "../../../../src/core/rag/glossary.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { search } from "../../../../src/core/rag/search/hybrid.ts";
import { oneApart, typoVariants } from "../../../../src/core/rag/search/typos.ts";
import type { SearchHit } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "evidence", "project");
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "testimus-search-power-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const b = join(dir, "docs", "SPEC_B", "doc.json");
  writeFileSync(b, JSON.stringify({ ...JSON.parse(readFileSync(b, "utf8")), date: "2026-11-02" }));
  await indexProject(dir, quietCtx(dir), { model: null });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const refs = (hits: SearchHit[]) => hits.map((h) => `${h.docId}#${h.anchor}`);
const bm25 = { mode: "bm25" as const, k: 20 };

describe("filters", () => {
  it("a section prefix keeps the section, its sub-sections and the figures inside them", async () => {
    const all = refs(await search(dir, "vue ligne poste", bm25));
    expect(all.some((r) => !r.startsWith("SPEC_A#§2") && r !== "SPEC_A#fig:1")).toBe(true);
    const two = refs(await search(dir, "vue ligne poste", { ...bm25, section: "2" }));
    expect(two.length).toBeGreaterThan(0);
    expect(two.every((r) => /#§2(\.|$)/.test(r) || r.endsWith("#fig:1"))).toBe(true);
    expect(two).toContain("SPEC_A#fig:1");
    const sub = refs(await search(dir, "vue ligne poste", { ...bm25, section: "§2.1" }));
    expect(sub.every((r) => r === "SPEC_A#§2.1" || r === "SPEC_A#fig:1")).toBe(true);
    expect(sub).toContain("SPEC_A#§2.1");
  });

  it("a kind keeps that kind of passage only", async () => {
    const figures = await search(dir, "vue ligne", { ...bm25, kinds: ["figure"] });
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.every((h) => h.kind === "figure")).toBe(true);
    const text = await search(dir, "vue ligne", { ...bm25, kinds: ["section"] });
    expect(text.every((h) => h.kind === "section")).toBe(true);
  });

  it("documents and dates narrow the documents searched", async () => {
    const onlyB = await search(dir, "alarmes poste", { ...bm25, docIds: ["SPEC_B"] });
    expect(onlyB.every((h) => h.docId === "SPEC_B")).toBe(true);
    const recent = await search(dir, "alarmes poste", { ...bm25, dateFrom: "2026-11-01" });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((h) => h.docId === "SPEC_B")).toBe(true);
    const older = await search(dir, "alarmes poste", { ...bm25, dateTo: "2026-10-31" });
    expect(older.some((h) => h.docId === "SPEC_B")).toBe(false);
    expect(await search(dir, "poste", { ...bm25, dateFrom: "2027-01-01" })).toEqual([]);
  });

  it("a narrow filter is applied before the candidates are cut", async () => {
    const hits = await search(dir, "poste", { ...bm25, section: "3.2", retrieval: { candidates: 1 } });
    expect(refs(hits)).toEqual([]);
    const fig = await search(dir, "vue", { ...bm25, kinds: ["figure"], retrieval: { candidates: 1 } });
    expect(refs(fig)).toEqual(["SPEC_A#fig:1"]);
  });
});

describe("synonyms of the project", () => {
  it("a query with one word of a group also finds the others, both ways", async () => {
    expect(refs(await search(dir, "interrupteur", bm25))).toEqual([]);
    const synonyms = [["interrupteur", "disjoncteur"]];
    const hits = await search(dir, "interrupteurs", { ...bm25, retrieval: { synonyms }, explain: true });
    expect(refs(hits)).toContain("SPEC_A#§3.2");
    expect(hits.find((h) => h.anchor === "§3.2")?.why?.synonyms).toEqual(["interrupteur → disjoncteur"]);
    const back = await search(dir, "disjoncteur", { ...bm25, retrieval: { synonyms }, explain: true });
    expect(back[0].why?.synonyms).toEqual([]);
    expect(back[0].why?.matched).toEqual(["disjoncteur"]);
  });

  it("project.json's synonyms reach rag.mentions' forms too", () => {
    const file = join(dir, "project.json");
    const pj = readFileSync(file, "utf8");
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(pj), rag: { retrieval: { synonyms: [["TK", "télécommande"]] } } }),
    );
    try {
      expect(expandTerm(dir, "TK")).toEqual(["TK", "télécommande"]);
      expect(expandTerm(dir, "les télécommandes")).toEqual(["les télécommandes", "TK"]);
      expect(expandTerm(dir, "tk")).toEqual(["tk"]);
    } finally {
      writeFileSync(file, pj);
    }
  });
});

describe("typos", () => {
  it("one letter changed, added, removed or two swapped is one apart; two letters are not", () => {
    expect(oneApart("disjonteur", "disjoncteur")).toBe(true);
    expect(oneApart("disjoncteru", "disjoncteur")).toBe(true);
    expect(oneApart("disjoncteurr", "disjoncteur")).toBe(true);
    expect(oneApart("disjancteur", "disjoncteur")).toBe(true);
    expect(oneApart("disjanctaur", "disjoncteur")).toBe(false);
    expect(oneApart("disjoncteur", "disjoncteur")).toBe(false);
  });

  it("a word the index lacks looks for indexed words one letter away, only when typos are on", async () => {
    expect(refs(await search(dir, "disjonteur", bm25))).toEqual([]);
    const hits = await search(dir, "disjonteur", { ...bm25, retrieval: { typos: true }, explain: true });
    expect(refs(hits)).toContain("SPEC_A#§3.2");
    expect(hits.find((h) => h.anchor === "§3.2")?.why?.typos).toEqual(["disjonteur → disjoncteur"]);
  });

  it("a word the index holds, a short word and a code are never second-guessed", () => {
    withDb(indexFile(dir), (db) => {
      expect(typoVariants(db, ["poste"])).toEqual([]);
      expect(typoVariants(db, ["vul"])).toEqual([]);
      expect(typoVariants(db, ["poste2"])).toEqual([]);
      expect(typoVariants(db, ["postr"]).map((t) => t.to)).toContain("poste");
    });
  });
});

describe("explain", () => {
  it("says each passage's rank by words, by meaning and the forms it holds", async () => {
    const hits = await search(dir, "ouvertures disjoncteur", { ...bm25, explain: true });
    expect(hits[0]).toMatchObject({ docId: "SPEC_A", anchor: "§3.2" });
    expect(hits[0].why).toEqual({
      words: 1,
      meaning: null,
      reranker: null,
      matched: ["disjoncteur"],
      stems: ["ouvertur"],
      synonyms: [],
      typos: [],
    });
    expect(hits.map((h) => h.why?.words)).toEqual(hits.map((_, i) => i + 1));
    expect((await search(dir, "ouverture", bm25))[0].why).toBeUndefined();
  });

  it("rag.search takes the filters, this search's settings and explain, as Claude calls it", async () => {
    const hits = (await invoke(
      "rag.search",
      { query: "disjonteur", mode: "bm25", section: "3", retrieval: { typos: true }, explain: true },
      { project: dir },
    )) as SearchHit[];
    expect(refs(hits)).toEqual(["SPEC_A#§3.2"]);
    expect(hits[0].why?.typos).toEqual(["disjonteur → disjoncteur"]);
  });
});
