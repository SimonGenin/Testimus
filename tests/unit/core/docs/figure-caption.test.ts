import { describe, expect, it } from "vitest";
import { chunkDoc, docFigures } from "../../../../src/core/rag/chunk.ts";
import type { DocJson } from "../../../../src/core/types.ts";

const md = [
  "# D — Doc",
  "",
  "## 5.6.6 Sectionneur <!-- § 5.6.6 -->",
  "",
  "Invalide carré magenta Figure 40 – Représentation graphique sectionneur <!-- fig 40 -->",
  "",
  "![Figure 41 – Menu](figures/fig-41.png) <!-- fig 41 -->",
].join("\n");

describe("figures whose picture is missing", () => {
  it("are figures with no file, captioned by their « Figure N – … » text", () => {
    const figs = docFigures(md, []);
    expect(figs.find((f) => f.n === "40")).toEqual({
      n: "40",
      anchor: "fig:40",
      file: "",
      caption: "Figure 40 – Représentation graphique sectionneur",
      description: "",
    });
    expect(figs.find((f) => f.n === "41")?.file).toBe("figures/fig-41.png");
  });

  it("get a figure chunk under their section", () => {
    const chunks = chunkDoc({ id: "D", code: "D", title: "Doc" } as DocJson, md, []);
    const c = chunks.find((x) => x.anchor === "fig:40");
    expect(c).toMatchObject({ kind: "figure", path: "5 > 5.6 > 5.6.6", figureIds: ["40"] });
  });
});

describe("a caption beside a table of the text", () => {
  const tables = [
    "## 8 États <!-- § 8 -->",
    "",
    "![Figure 2 – Écran](figures/fig-2.png) <!-- fig 2 -->",
    "",
    "| **Etat** | Consigné | Invalide |",
    "| --- | --- | --- |",
    "| **Couleur** | Violet | Magenta |",
    "",
    "Figure 17 – Couleurs des sous-sections <!-- fig 17 -->",
    "",
    "Figure 18 – Liste des symboles <!-- fig 18 -->",
    "",
    "| Symbole | Sens |",
    "| --- | --- |",
    "| C | Coupé |",
    "",
    "Texte.",
    "",
    "Figure 19 – Image perdue <!-- fig 19 -->",
  ].join("\n");

  it("is a figure that is that table, the rows above it first, else the rows below", () => {
    const figs = docFigures(tables, []);
    expect(figs.find((f) => f.n === "17")?.table).toBe(
      "| **Etat** | Consigné | Invalide |\n| --- | --- | --- |\n| **Couleur** | Violet | Magenta |",
    );
    expect(figs.find((f) => f.n === "18")?.table).toBe("| Symbole | Sens |\n| --- | --- |\n| C | Coupé |");
    expect(figs.find((f) => f.n === "19")).not.toHaveProperty("table");
    expect(figs.find((f) => f.n === "2")).not.toHaveProperty("table");
  });

  it("keeps its table under a figures.json entry with no file, and the figures come in reading order", () => {
    const entry = { file: "", anchor: "fig:17", caption: "Figure 17 – Couleurs des sous-sections", description: "" };
    const figs = docFigures(tables, [entry]);
    expect(figs.find((f) => f.n === "17")?.table).toContain("Violet");
    expect(figs.map((f) => f.n)).toEqual(["2", "17", "18", "19"]);
  });
});
