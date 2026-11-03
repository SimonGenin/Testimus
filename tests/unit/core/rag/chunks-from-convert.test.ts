import { describe, expect, it } from "vitest";
import {
  approxTokens,
  chunkDoc,
  docFigures,
  MAX_TOKENS,
  markerLine,
  sectionAt,
  sectionPath,
} from "../../../../src/core/rag/chunk.ts";
import type { DocJson } from "../../../../src/core/types.ts";

const doc = { id: "D", code: "D", title: "Doc" } as DocJson;

describe("chunks", () => {
  it("paths, token estimates and marker lookups", () => {
    expect(sectionPath("intro")).toBe("intro");
    expect(sectionPath("1.2")).toBe("1 > 1.2");
    expect(approxTokens("abcde")).toBe(2);
    expect(markerLine("a\n<!-- fig 1 -->", "1")).toBe(1);
    expect(markerLine("a\n<!-- req 1 -->", "1")).toBe(-1);
    expect(sectionAt([], -1)).toBeUndefined();
  });

  it("names figures from markers, captions without the word Figure, and figures.json entries", () => {
    const md = [
      "![Cap A](figures/fig-1.png) <!-- fig 1 -->",
      "Some pasted caption <!-- fig 2 -->",
      "Text then Figure 3 – Pompe <!-- fig 3 -->",
    ].join("\n");
    const figs = docFigures(md, [
      { anchor: "fig:1", file: "", caption: "", description: "d1" },
      { anchor: "fig:9", file: "", caption: "", description: "" },
    ]);
    expect(figs).toEqual([
      { n: "1", anchor: "fig:1", file: "figures/fig-1.png", caption: "Cap A", description: "d1" },
      { n: "2", anchor: "fig:2", file: "", caption: "Some pasted caption", description: "" },
      { n: "3", anchor: "fig:3", file: "", caption: "Figure 3 – Pompe", description: "" },
      { n: "9", anchor: "fig:9", file: "", caption: "", description: "" },
    ]);
  });

  it("cuts long lists by lines and long tables with their header repeated", () => {
    const list = Array.from({ length: 200 }, (_, i) => `- item number ${i} with a long enough text to weigh`).join(
      "\n",
    );
    const table = [
      "| A | B |",
      "| --- | --- |",
      ...Array.from({ length: 200 }, (_, i) => `| row ${i} | some cell text long enough |`),
    ].join("\n");
    const huge = `| ${"mot ".repeat(1000)}|`;
    const md = `# 1 One <!-- § 1 -->\n\n${list}\n\n# 2 Two <!-- § 2 -->\n\n${table}\n\n# 3 Three <!-- § 3 -->\n\n${huge}\n`;
    const chunks = chunkDoc(doc, md, []);
    expect(chunks.filter((c) => c.anchor === "§3").map((c) => c.text)).toEqual([huge]);
    const one = chunks.filter((c) => c.anchor === "§1");
    const two = chunks.filter((c) => c.anchor === "§2");
    expect(one.length).toBeGreaterThan(1);
    expect(two.length).toBeGreaterThan(1);
    for (const c of [...one, ...two]) expect(approxTokens(c.text)).toBeLessThanOrEqual(MAX_TOKENS + 20);
    for (const c of two) expect(c.text.startsWith("| A | B |\n| --- | --- |")).toBe(true);
  });

  it("keeps a table in its section's chunk, drops other comments from the text, and heads a figure outside sections with the doc", () => {
    const md = [
      "![Logo](figures/fig-0.png) <!-- fig 0 -->",
      "",
      "# 1 Titre <!-- § 1 -->",
      "",
      "<!-- req EXI_X_3 -->",
      "Body.",
      "",
      "| Code | Objet | Chapitre |",
      "| --- | --- | --- |",
      "| EXI_X_3 | Trois. | 1 |",
    ].join("\n");
    const chunks = chunkDoc(doc, md, []);
    expect(chunks.map((c) => [c.anchor, c.kind])).toEqual([
      ["§1", "section"],
      ["fig:0", "figure"],
    ]);
    expect(chunks[0].text).toBe("Body.\n\n| Code | Objet | Chapitre |\n| --- | --- | --- |\n| EXI_X_3 | Trois. | 1 |");
    expect(chunks.find((c) => c.anchor === "fig:0")).toMatchObject({ path: "", header: "D Doc" });
  });
});
