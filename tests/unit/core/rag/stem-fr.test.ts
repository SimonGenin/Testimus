import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { frenchTokens, stemText, stemWord } from "../../../../src/core/rag/stem-fr.ts";

describe("the French stemmer", () => {
  const dir = join(import.meta.dirname, "..", "..", "..", "fixtures", "snowball-fr");
  const lines = (f: string) => readFileSync(join(dir, f), "utf8").replace(/\r/g, "").split("\n");

  describe("Snowball French stemmer", () => {
    it("stems the whole Snowball reference vocabulary exactly", () => {
      const voc = lines("voc.txt");
      const out = lines("output.txt");
      expect(voc.length).toBe(out.length);
      const wrong = voc.flatMap((w, i) => (w && stemWord(w) !== out[i] ? [`${w} → ${stemWord(w)} ≠ ${out[i]}`] : []));
      expect(voc.filter(Boolean).length).toBeGreaterThan(20_000);
      expect(wrong).toEqual([]);
    });

    it("brings plurals and verb forms of the domain to one stem", () => {
      expect(stemWord("sectionneurs")).toBe(stemWord("sectionneur"));
      expect(stemWord("ouverts")).toBe(stemWord("ouvert"));
      expect(stemWord("disjoncteurs")).toBe(stemWord("disjoncteur"));
      expect(stemWord("alimentation")).toBe(stemWord("alimentations"));
      expect(stemWord("Déclenchement")).toBe(stemWord("déclenchements"));
    });

    it("tokenizes with elisions expanded, so « n' » is searchable as « ne »", () => {
      expect(frenchTokens("L’état n'est pas qu'un DSO_1")).toEqual([
        "le",
        "état",
        "ne",
        "est",
        "pas",
        "que",
        "un",
        "dso",
        "1",
      ]);
      expect(stemText("Les sectionneurs ouverts, sauf DHT")).toBe("le sectionneur ouvert sauf dht");
    });
  });
});

describe("stem-fr — less common words", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-cov-search-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t" }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("stem-fr", () => {
    it("drops -iv after -ité only in R2", () => {
      expect(stemWord("relativité")).toBe("relat");
      expect(stemWord("passivité")).toBe("passiv");
    });

    it("clears its cache past 50 000 words and still stems", () => {
      for (let i = 0; i < 50_002; i++) stemWord(`mot${i}`);
      expect(stemWord("sectionneurs")).toBe(stemWord("sectionneur"));
    });

    it("reads a word written with combining accents (NFD) as the same word", () => {
      const nfd = "Le d\u00e9part a \u00e9t\u00e9 refus\u00e9".normalize("NFD");
      expect(frenchTokens(nfd)).toEqual(["le", "départ", "a", "été", "refusé"]);
      expect(stemText(nfd)).toBe(stemText("Le départ a été refusé"));
    });
  });
});
