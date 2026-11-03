import { describe, expect, it } from "vitest";
import { parseSections } from "../../src/core/rag/chunk.ts";
import { idRegex, sectionByNumber, tablesOf } from "../../src/core/rag/statements.ts";
import { matrixColumns, matrixRows, statementsOf } from "./ratp.ts";

const table = (rows: string[]) => tablesOf(rows.join("\n"))[0];

describe("idRegex", () => {
  it("drops a project pattern that is not a regular expression", () => {
    const re = idRegex({ patterns: ["(", String.raw`REQ-\d+`] });
    expect("EXI_A_1 REQ-7".match(re)).toEqual(["REQ-7"]);
  });

  it("matches nothing when the project tracks no requirement ids", () => {
    expect("EXI_A_1 REQ-7".match(idRegex())).toBeNull();
    expect("EXI_A_1".match(idRegex({ patterns: ["("] }))).toBeNull();
  });
});

describe("matrixColumns", () => {
  it("refuses a named section column the table does not have", () => {
    const t = table(["| Exigence | Section |", "| --- | --- |", "| EXI_A_1 | 1.2 |"]);
    expect(matrixColumns(t, { matrix: { idColumn: "Exigence", sectionColumn: "Chapitre" } })).toBeNull();
    expect(matrixColumns(t, { matrix: { idColumn: "Exigence", sectionColumn: "Section" } })).toMatchObject({
      id: 0,
      section: 1,
    });
  });

  it("finds an unnamed section column by its numbers, rows shorter than the header included", () => {
    const t = table([
      "| Code | Où | Objet | Note |",
      "| --- | --- | --- | --- |",
      "| EXI_A_1 | 1.2 | La règle | x |",
      "| EXI_A_2 | 3 |",
      "| EXI_A_3 | 4.1 | Une autre règle |",
    ]);
    expect(matrixColumns(t)).toEqual({ id: 0, section: 1, text: 2 });
  });

  it("prefers a named id column among columns with as many ids, and picks the longest text otherwise", () => {
    const t = table([
      "| Ref | Exigence | Section | A | B |",
      "| --- | --- | --- | --- | --- |",
      "| EXI_A_1 | EXI_A_1 | 1 | court | un texte bien plus long |",
      "| EXI_A_2 | EXI_A_2 | 2 | court | un autre texte long |",
    ]);
    expect(matrixColumns(t)).toEqual({ id: 1, section: 2, text: 4 });
  });

  it("is not a matrix without a section column", () => {
    const t = table(["| Exigence | Objet |", "| --- | --- |", "| EXI_A_1 | texte |"]);
    expect(matrixColumns(t)).toBeNull();
  });
});

describe("matrixRows", () => {
  it("a header that is itself a requirement row is read as a row, and missing cells are empty", () => {
    const md = ["| EXI_A_1 | 1 | Première |", "| --- | --- | --- |", "| EXI_A_2 | 2 |", "| EXI_A_1 | 3 | Bis |"].join(
      "\n",
    );
    const rows = matrixRows(md);
    expect(rows.map((r) => r.anchor)).toEqual(["req:EXI_A_1@matrix", "req:EXI_A_2@matrix", "req:EXI_A_1@matrix~2"]);
    expect(rows[1].statement).toBe("EXI_A_2 —  (section 2)");
    expect(rows[0].line).toBe(0);
  });
});

describe("statementsOf — the less common shapes", () => {
  it("a marker right before a heading or at the end is the id alone", () => {
    const md = ["<!-- req EXI_H_1 -->", "## 1 Titre <!-- § 1 -->", "", "texte", "", "<!-- req EXI_END_1 -->"].join(
      "\n",
    );
    const s = statementsOf("D", md);
    expect(s.get("EXI_H_1")).toMatchObject({ text: "EXI_H_1", section: "", source: "body" });
    expect(s.get("EXI_END_1")).toMatchObject({ text: "EXI_END_1", section: "§1" });
  });

  it("a bold id alone stops at a paragraph holding a figure marker", () => {
    const md = [
      "## 1 Titre <!-- § 1 -->",
      "<!-- req EXI_F_1 -->",
      "**EXI_F_1**",
      "",
      "La règle avant la figure.",
      "",
      "Un schéma <!-- fig 3 --> en ligne",
      "",
      "Après la figure.",
    ].join("\n");
    expect(statementsOf("D", md).get("EXI_F_1")?.text).toBe(
      "**EXI_F_1**\n\nLa règle avant la figure.\n\nUn schéma en ligne",
    );
  });

  it("a marker before a table whose header holds the id takes the header row", () => {
    const md = ["## 1 T <!-- § 1 -->", "<!-- req EXI_T_1 -->", "| EXI_T_1 | x |", "| --- | --- |", "| a | b |"].join(
      "\n",
    );
    expect(statementsOf("D", md).get("EXI_T_1")).toMatchObject({ text: "EXI_T_1 | x", start: 2 });
  });

  it("a matrix row without a marker is still a statement, in its section", () => {
    const md = [
      "## 2 Matrice <!-- § 2 -->",
      "",
      "| Exigence | Section | Objet |",
      "| --- | --- | --- |",
      "| EXI_M_1 | 4 | La règle |",
    ].join("\n");
    expect(statementsOf("D", md).get("EXI_M_1")).toMatchObject({ source: "matrix", section: "§2", traced: ["§4"] });
    expect(statementsOf("D", "| Exigence | Section |\n| --- | --- |\n| EXI_M_2 | 1 |").get("EXI_M_2")?.section).toBe(
      "",
    );
  });
});

describe("sectionByNumber", () => {
  it("finds a numbered section or nothing", () => {
    const sections = parseSections("## 1 A <!-- § 1 -->\n\n## 2 B <!-- § 2 -->\n");
    expect(sectionByNumber(sections, "2")?.title).toBe("B");
    expect(sectionByNumber(sections, "9")).toBeUndefined();
  });
});
