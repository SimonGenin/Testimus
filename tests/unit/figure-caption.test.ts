import { describe, expect, it } from "vitest";
import { chunkDoc, docFigures } from "../../src/core/rag/chunk.ts";
import type { DocJson } from "../../src/core/types.ts";

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
