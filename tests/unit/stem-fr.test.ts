import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frenchTokens, stemText, stemWord } from "../../src/core/rag/stem-fr.ts";

const dir = join(import.meta.dirname, "..", "fixtures", "snowball-fr");
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
