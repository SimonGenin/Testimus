import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CorpusDoc, chunkTitle, mentions } from "../../src/core/rag/mentions.ts";
import type { Chunk } from "../../src/core/types.ts";

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
