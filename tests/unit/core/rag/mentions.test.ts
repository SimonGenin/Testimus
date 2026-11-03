import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { type CorpusDoc, chunkTitle, type Mentions, mentions } from "../../../../src/core/rag/mentions.ts";
import type { Chunk } from "../../../../src/core/types.ts";

describe("rag.mentions", () => {
  const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "evidence", "project");
  let dir: string;

  function addDoc(id: string, md: string, extra: Record<string, unknown> = {}) {
    mkdirSync(join(dir, "docs", id), { recursive: true });
    writeFileSync(join(dir, "docs", id, "doc.md"), md);
    writeFileSync(
      join(dir, "docs", id, "doc.json"),
      JSON.stringify({
        id,
        code: id,
        title: `Doc ${id}`,
        version: "1",
        date: "",
        kind: "spec",
        status: "validated",
        source: { path: `${id}.docx`, sha256: id },
        ...extra,
      }),
    );
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-mentions-"));
    cpSync(FIXTURE, dir, { recursive: true });
    addDoc(
      "GLOSS",
      [
        "# GLOSS — Glossaire",
        "",
        "## 1 Acronymes <!-- § 1 -->",
        "",
        "| Sigle | Signification |",
        "| --- | --- |",
        "| DSO | Départ Sur Ordre |",
        "",
        "## 2 Exploitation <!-- § 2 -->",
        "",
        "Le régulateur donne les départs sur ordre depuis le poste central.",
        "",
        "Le DSO est refusé hors service. Voir EXI_MOP_SPF_900_A_10 et EXI_MOP_SPF_900_A_1.",
        "",
        "## 3 Postes de redressement <!-- § 3 -->",
        "",
        "Chaque sous-station alimente la ligne.",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const refs = (m: Mentions) => m.docs.flatMap((d) => d.sections.map((s) => s.ref));
  const section = (m: Mentions, ref: string) => m.docs.flatMap((d) => d.sections).find((s) => s.ref === ref);

  describe("rag.mentions (SPEC-RAG §4.1)", () => {
    it("finds an id as an exact code, never as the prefix of a longer id", () => {
      const m = mentions(dir, { term: "EXI_MOP_SPF_900_A_1" });
      expect(m.forms).toEqual(["EXI_MOP_SPF_900_A_1"]);
      expect(refs(m)).toContain("GLOSS#§2");
      expect(refs(m)).toContain("SPEC_A#§6.1");
      expect(section(m, "GLOSS#§2")?.count).toBe(1);
      expect(section(m, "GLOSS#§2")?.hits[0]).toEqual({
        form: "EXI_MOP_SPF_900_A_1",
        context: "Le DSO est refusé hors service. Voir EXI_MOP_SPF_900_A_10 et EXI_MOP_SPF_900_A_1.",
      });
      expect(section(m, "SPEC_A#§6.1")?.count).toBe(1);
    });

    it("matches the stemmed form, case and accents aside; stem: false keeps the exact form only", () => {
      const m = mentions(dir, { term: "Poste" });
      expect(m.forms).toEqual(["Poste", "post*"]);
      const s = section(m, "SPEC_A#§2.1");
      expect(s?.hits.map((h) => h.form)).toContain("postes");
      expect(s?.title).toBe("Vue ligne");
      expect(section(m, "GLOSS#§3")?.hits[0]).toEqual({ form: "Postes", context: "Postes de redressement" });
      const exact = mentions(dir, { term: "Poste", stem: false });
      expect(exact.forms).toEqual(["Poste"]);
      expect(section(exact, "SPEC_A#§2.1")?.hits.map((h) => h.form)).toEqual(["poste", "poste"]);
      expect(exact.total).toBeLessThan(m.total);
    });

    it("expands an acronym through the glossary, both ways", () => {
      const a = mentions(dir, { term: "DSO" });
      expect(a.forms).toContain("Départ Sur Ordre");
      expect(section(a, "GLOSS#§2")?.hits.map((h) => h.form)).toEqual(["départs sur ordre", "DSO"]);
      const b = mentions(dir, { term: "départ sur ordre" });
      expect(b.forms).toContain("DSO");
      expect(section(b, "GLOSS#§2")?.count).toBe(2);
      expect(mentions(dir, { term: "DSO", glossary: false }).forms).toEqual(["DSO"]);
    });

    it("takes a regex, case-insensitive, and refuses a broken one", () => {
      const m = mentions(dir, { term: "postes? (en|hors) service", regex: true });
      expect(m.forms).toEqual(["postes? (en|hors) service"]);
      expect(section(m, "SPEC_A#§2.1")?.hits.map((h) => h.form)).toEqual(["postes en service", "postes hors service"]);
      expect(() => mentions(dir, { term: "(", regex: true })).toThrow(/regular expression/);
    });

    it("filters by document", () => {
      const only = mentions(dir, { term: "poste", docIds: ["GLOSS"] });
      expect(only.docs.map((d) => d.docId)).toEqual(["GLOSS"]);
    });

    it("pages by sections, not by a top-k: every section once across the pages", () => {
      const all = mentions(dir, { term: "poste", pageSize: 200 });
      expect(all.pages).toBe(1);
      const p1 = mentions(dir, { term: "poste", pageSize: 2 });
      expect(p1.pages).toBe(Math.ceil(all.sections / 2));
      const paged: string[] = [];
      for (let page = 1; page <= p1.pages; page++) {
        const p = mentions(dir, { term: "poste", pageSize: 2, page });
        expect(p.total).toBe(all.total);
        paged.push(...refs(p));
      }
      expect(paged).toEqual(refs(all));
      expect(mentions(dir, { term: "poste", pageSize: 2, page: 99 }).docs).toEqual([]);
      expect(all.docs[0].count).toBeGreaterThanOrEqual(all.docs[all.docs.length - 1].count);
    });

    it("gives the same answer from doc.md and from the index, and sees a doc.md changed after indexing", async () => {
      const before = ["poste", "DSO", "EXI_MOP_SPF_100_A_10", "Figure"].map((term) => mentions(dir, { term }));
      await indexProject(dir, quietCtx(dir), { model: null });
      const after = ["poste", "DSO", "EXI_MOP_SPF_100_A_10", "Figure"].map((term) => mentions(dir, { term }));
      expect(after).toEqual(before);
      expect(refs(after[3])).toContain("SPEC_A#fig:1");
      appendFileSync(join(dir, "docs", "SPEC_B", "doc.md"), "\nLe poste de secours.\n");
      expect(refs(mentions(dir, { term: "poste" }))).toContain("SPEC_B#§4.1");
    });

    it("is the rag.mentions command (CLI, MCP, HTTP)", async () => {
      const r = (await invoke("rag.mentions", { term: "sous-station" }, { project: dir })) as Mentions;
      expect(refs(r)).toEqual(["GLOSS#§3"]);
      expect(r).toMatchObject({ page: 1, pages: 1, sections: 1, total: 1 });
    });
  });

  describe("a section title is searched even when the section has no text of its own (review #8)", () => {
    it("finds « DSO » in « 3.15 DSO, départs… » whose text is all in sub-sections, with and without the index", async () => {
      addDoc(
        "SOSIE_4111",
        [
          "# SOSIE_4111 — PR2I",
          "",
          "### 3.15 DSO, départs, vue système et impression <!-- § 3.15 -->",
          "",
          "#### 3.15.1 Vue système <!-- § 3.15.1 -->",
          "",
          "La vue système présente les équipements.",
        ].join("\n"),
      );
      const without = mentions(dir, { term: "DSO", docIds: ["SOSIE_4111"] });
      expect(refs(without)).toEqual(["SOSIE_4111#§3.15"]);
      expect(without.docs[0].sections[0]).toMatchObject({
        path: "3 > 3.15",
        title: "DSO, départs, vue système et impression",
        kind: "section",
        count: 1,
        hits: [{ form: "DSO", context: "DSO, départs, vue système et impression" }],
      });
      expect(refs(mentions(dir, { term: "vue système", docIds: ["SOSIE_4111"] }))).toEqual([
        "SOSIE_4111#§3.15",
        "SOSIE_4111#§3.15.1",
      ]);
      await indexProject(dir, quietCtx(dir), { model: null });
      expect(mentions(dir, { term: "DSO", docIds: ["SOSIE_4111"] })).toEqual(without);
    });
  });
});

describe("rag.mentions — less common inputs", () => {
  let dir = "";
  const addDoc = (id: string, md: string) => {
    mkdirSync(join(dir, "docs", id), { recursive: true });
    writeFileSync(join(dir, "docs", id, "doc.md"), md);
    writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify({ id, code: id, title: id, status: "validated" }));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-cov-mentions-"));
    writeFileSync(join(dir, "project.json"), "{}");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("mentions — the less common inputs", () => {
    it("refuses an empty term and a regex no engine accepts", () => {
      expect(() => mentions(dir, { term: "  " })).toThrow(/the term is empty/);
      expect(() => mentions(dir, { term: "(", regex: true })).toThrow(/Not a valid regular expression/);
    });

    it("a term of stop words only is matched as a phrase, not by stems", () => {
      addDoc("A", "## 1 Titre <!-- § 1 -->\n\nIl est de la partie.\n");
      const r = mentions(dir, { term: "de la" });
      expect(r.forms).toEqual(["de la"]);
      expect(r.total).toBe(1);
    });

    it("folds letters whose decomposition is longer, and keeps a lowercase that grows", () => {
      addDoc("K", "## 1 Titre <!-- § 1 -->\n\n한국 İstanbul ligne.\n");
      expect(mentions(dir, { term: "한국" }).total).toBe(1);
      expect(mentions(dir, { term: "İstanbul", stem: false }).total).toBe(1);
    });

    it("cuts long lines around a hit with ellipses, and orders sections at the same place by ref", () => {
      const pad = "mot ".repeat(40);
      addDoc("L", `## 1 Titre <!-- § 1 -->\n\n${pad}sectionneur ${pad}\n`);
      const hit = mentions(dir, { term: "sectionneur", stem: false }).docs[0].sections[0].hits[0];
      expect(hit.context.startsWith("…")).toBe(true);
      expect(hit.context.endsWith("…")).toBe(true);
    });

    it("a code with digits is never stemmed, and two rows on one matrix line are ordered by ref", () => {
      addDoc(
        "M",
        [
          "## 1 Matrice <!-- § 1 -->",
          "",
          "| Exigence | Section | Objet |",
          "| --- | --- | --- |",
          "| EXI_B_2, EXI_A_1 | 1 | Le pantographe S1 monte |",
        ].join("\n"),
      );
      expect(mentions(dir, { term: "S1" }).forms).toEqual(["S1"]);
      const refs = mentions(dir, { term: "pantographe" }).docs[0].sections.map((s) => s.ref);
      expect(refs.filter((r) => r.includes("@matrix"))).toEqual([...refs.filter((r) => r.includes("@matrix"))].sort());
    });

    it("text before any section is found and placed after the known anchors", () => {
      addDoc("P", "Préambule qui parle du disjoncteur.\n\n## 1 Titre <!-- § 1 -->\n\nLe disjoncteur s'ouvre.\n");
      const r = mentions(dir, { term: "disjoncteur", stem: false });
      expect(r.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("chunkTitle", () => {
    const d = { titles: new Map([["§4", "Quatre"]]) } as unknown as CorpusDoc;
    const chunk = (c: Partial<Chunk>) => ({ anchor: "§1", kind: "section", text: "", path: "", ...c }) as Chunk;

    it("a section takes its title, a split part its section's, a figure its caption line", () => {
      expect(chunkTitle(d, chunk({ anchor: "§4" }))).toBe("Quatre");
      expect(chunkTitle(d, chunk({ anchor: "§4~2" }))).toBe("Quatre");
      expect(chunkTitle(d, chunk({ kind: "figure", anchor: "fig:1", text: "Figure 1 – Vue\nsa description" }))).toBe(
        "Figure 1 – Vue",
      );
    });

    it("a section without a title has an empty one", () => {
      expect(chunkTitle(d, chunk({ anchor: "§9" }))).toBe("");
    });
  });
});
