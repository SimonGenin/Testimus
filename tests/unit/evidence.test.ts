import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { chunkDoc } from "../../src/core/rag/chunk.ts";
import { convertDocx } from "../../src/core/rag/convert-docx.ts";
import {
  matricesOf,
  matrixColumns,
  matrixRows,
  statementsOf,
  tablesOf,
  tracedOf,
} from "../../src/core/rag/statements.ts";
import type { DocJson } from "../../src/core/types.ts";
import { matrixDocx } from "../fixtures/evidence/matrix-docx.ts";

const FIXTURE = new URL("../fixtures/evidence/project/", import.meta.url);
const A = "SPEC_A";
const mdOf = (id: string) => readFileSync(new URL(`docs/${id}/doc.md`, FIXTURE), "utf8");
const docOf = (id: string) => JSON.parse(readFileSync(new URL(`docs/${id}/doc.json`, FIXTURE), "utf8")) as DocJson;
const table = (...rows: string[]) => tablesOf(rows.join("\n"))[0];

describe("requirement statements (SPEC-RAG §3.1)", () => {
  const st = statementsOf(A, mdOf(A));

  it("an id alone in bold takes the following blocks up to the next marker", () => {
    const s = st.get("EXI_MOP_SPF_100_A_10")!;
    expect(s).toMatchObject({ source: "body", section: "§2.1", traced: ["§2.1"] });
    expect(s.text).toMatch(/^\*\*EXI_MOP_SPF_100_A_10\*\*\n\nLa vue ligne affiche/);
    expect(s.text).toContain("- les postes hors service sont en gris");
    expect(s.text).not.toContain("EXI_MOP_SPF_100_A_20");
  });

  it("an id inside its sentence is that paragraph; a figure stops nothing it does not follow", () => {
    expect(st.get("EXI_MOP_SPF_100_A_20")).toMatchObject({
      source: "body",
      section: "§2.1",
      text: "EXI_MOP_SPF_100_A_20 : La vue ligne se rafraîchit toutes les secondes.",
      traced: ["§2"],
    });
  });

  it("an id alone with nothing after it takes its matrix row, never the id alone", () => {
    expect(st.get("EXI_MOP_SPF_100_A_30")).toMatchObject({
      source: "matrix",
      section: "§2.2",
      text: "EXI_MOP_SPF_100_A_30 — La vue détaillée affiche l'état du poste sélectionné. (section 2.2)",
    });
    expect(st.get("EXI_MOP_SPF_100_A_40")?.text).toContain("La vue détaillée s'ouvre par un double clic sur le poste.");
  });

  it("an id only in the matrix is its row, rendered ID — Objet (section x.y)", () => {
    expect(st.get("EXI_MOP_SPF_900_A_1")).toMatchObject({
      source: "matrix",
      section: "§6.1",
      anchor: "req:EXI_MOP_SPF_900_A_1@matrix",
      text: "EXI_MOP_SPF_900_A_1 — Le simulateur enregistre chaque commande de l'opérateur. (section 3.2)",
      traced: ["§3.2"],
    });
    expect(st.get("EXI_MOP_SPF_900_A_2")).toMatchObject({
      text: "EXI_MOP_SPF_900_A_2 — Les commandes refusées sont signalées à l'opérateur.",
      traced: [],
    });
  });

  it("every id has a statement longer than the id", () => {
    expect([...st.keys()].sort()).toEqual([
      "EXI_MOP_SPF_100_A_10",
      "EXI_MOP_SPF_100_A_20",
      "EXI_MOP_SPF_100_A_30",
      "EXI_MOP_SPF_100_A_40",
      "EXI_MOP_SPF_900_A_1",
      "EXI_MOP_SPF_900_A_2",
    ]);
    for (const s of st.values()) expect(s.text.length).toBeGreaterThan(s.id.length + 5);
  });

  it("a table that is not a matrix gives the row holding the id", () => {
    const md =
      "## 1 T <!-- § 1 -->\n\n<!-- req EXI_A_1 -->\n| Exigence | Texte |\n| --- | --- |\n| EXI_A_1 | La fenêtre \\| état |";
    expect(statementsOf("D", md).get("EXI_A_1")).toMatchObject({ source: "body", text: "EXI_A_1 | La fenêtre | état" });
  });
});

describe("matrix detection (SPEC-RAG §3.2)", () => {
  it("finds ids, sections and the text column by RATP headers, case and accents ignored", () => {
    const t = table(
      "| **Code exigences** | **Objet** | **CHAPITRE** |",
      "| --- | --- | --- |",
      "| EXI_X_1 | Un texte. | 3.2 |",
      "| EXI_X_2 | Un autre. | À compléter |",
    );
    expect(matrixColumns(t)).toEqual({ id: 0, section: 2, text: 1 });
    expect(matrixColumns(table("| Objet | § | Id |", "|---|---|---|", "| a | §2.3 | EXI_X_1 |"))).toEqual({
      id: 2,
      section: 1,
      text: 0,
    });
  });

  it("finds the section column by its numbers when the header says nothing, and reads a header-less part", () => {
    const t = table(
      "| EXI_X_1 | Un texte. | 3.2.4 |",
      "| --- | --- | --- |",
      "| EXI_X_2 | Un autre. | §2.3 |",
      "| EXI_X_3 | Encore. | 4.1, 4.2 |",
    );
    expect(matrixColumns(t)).toEqual({ id: 0, section: 2, text: 1 });
    const md = ["| EXI_X_1 | Un texte. | 3.2.4 |", "| --- | --- | --- |", "| EXI_X_3 | Encore. | 4.1, 4.2 |"].join(
      "\n",
    );
    expect(matrixRows(md).map((r) => [r.id, r.traced])).toEqual([
      ["EXI_X_1", ["3.2.4"]],
      ["EXI_X_3", ["4.1", "4.2"]],
    ]);
  });

  it("is not a matrix without ids on most rows, ids only in the text, or without a section column", () => {
    expect(
      matrixColumns(
        table(
          "| Code Exigence | Objet | Section |",
          "|---|---|---|",
          "| a | b | 1 |",
          "| c | d | 2 |",
          "| EXI_X_1 | e | 3 |",
        ),
      ),
    ).toBeNull();
    expect(matrixColumns(table("| Objet | Section |", "|---|---|", "| voir EXI_X_1 ici | 1.2 |"))).toBeNull();
    expect(matrixColumns(table("| **ID Exigence** | **Source** |", "|---|---|", "| EXI_X_1 | SPF 510 |"))).toBeNull();
  });

  it("uses project patterns and project.json.requirementMatrix", () => {
    const t = table(
      "| Ref | Libellé | Où |",
      "|---|---|---|",
      "| EXI STB F-11 | Texte | 2.3 |",
      "| EXI STB F-12 | Texte | 2.4 |",
    );
    expect(matrixColumns(t)).toBeNull();
    const opts = { patterns: [String.raw`\bEXI STB [A-Z]-\d+`] };
    expect(matrixColumns(t, opts)).toEqual({ id: 0, section: 2, text: 1 });
    expect(
      matrixColumns(t, { ...opts, matrix: { idColumn: "Ref", sectionColumn: "Où", textColumn: "Libellé" } }),
    ).toEqual({
      id: 0,
      section: 2,
      text: 1,
    });
    expect(matrixColumns(t, { ...opts, matrix: { idColumn: "Nope", sectionColumn: "Où" } })).toBeNull();
  });

  it("reads section numbers out of a cell", () => {
    expect(tracedOf("§ 3.2.4")).toEqual(["3.2.4"]);
    expect(tracedOf("À compléter")).toEqual([]);
    expect(tracedOf("**4.1** <br> 4.2")).toEqual(["4.1", "4.2"]);
  });

  it("numbers repeated rows of the same id", () => {
    const md = "| Code Exigence | Objet | Section |\n|---|---|---|\n| EXI_X_1 | a | 1 |\n| EXI_X_1 | b | 2 |";
    expect(matrixRows(md).map((r) => r.anchor)).toEqual(["req:EXI_X_1@matrix", "req:EXI_X_1@matrix~2"]);
  });
});

describe("matrix rows as chunks (F3)", () => {
  it("one matrix-row chunk per row with its traced section; the matrix leaves the section chunks", () => {
    const chunks = chunkDoc(docOf(A), mdOf(A), []);
    const rows = chunks.filter((c) => c.kind === "matrix-row");
    expect(rows.map((c) => c.id)).toEqual([
      `${A}#req:EXI_MOP_SPF_100_A_10@matrix`,
      `${A}#req:EXI_MOP_SPF_100_A_20@matrix`,
      `${A}#req:EXI_MOP_SPF_100_A_30@matrix`,
      `${A}#req:EXI_MOP_SPF_100_A_40@matrix`,
      `${A}#req:EXI_MOP_SPF_900_A_1@matrix`,
      `${A}#req:EXI_MOP_SPF_900_A_2@matrix`,
    ]);
    expect(rows[0]).toMatchObject({
      anchor: "req:EXI_MOP_SPF_100_A_10@matrix",
      path: "2 > 2.1",
      reqIds: ["EXI_MOP_SPF_100_A_10"],
      header: `${A} Spécification A — 2 > 2.1 Vue ligne`,
      text: "EXI_MOP_SPF_100_A_10 | La vue ligne affiche tous les postes de redressement de la ligne. | 2.1",
    });
    expect(rows[4].path).toBe("3 > 3.2");
    expect(rows[5].path).toBe("6 > 6.1");
    const s61 = chunks.filter((c) => c.anchor === "§6.1");
    expect(s61).toHaveLength(1);
    expect(s61[0]).toMatchObject({ text: "Ce document répond aux exigences suivantes :", reqIds: [] });
    expect(chunks.find((c) => c.anchor === "§2.1")?.reqIds).toEqual(["EXI_MOP_SPF_100_A_10", "EXI_MOP_SPF_100_A_20"]);
  });
});

describe("conversion keeps the evidence stable", () => {
  it("a .docx matrix converts to rows, and anchors, rows and statements are identical on reconversion", async () => {
    const a = await convertDocx(matrixDocx(), { code: "M" });
    const b = await convertDocx(matrixDocx({ extraParagraph: "Un paragraphe ajouté en 01.02." }), { code: "M" });
    expect(matricesOf(a.md)).toHaveLength(1);
    const rows = (md: string) => matrixRows(md).map((r) => [r.anchor, r.statement]);
    expect(rows(a.md)).toEqual([
      ["req:EXI_MOP_SPF_100_A_10@matrix", "EXI_MOP_SPF_100_A_10 — La vue ligne affiche tous les postes. (section 2.1)"],
      [
        "req:EXI_MOP_SPF_900_A_1@matrix",
        "EXI_MOP_SPF_900_A_1 — Le simulateur enregistre chaque commande. (section 2.1)",
      ],
    ]);
    expect(rows(b.md)).toEqual(rows(a.md));
    const ids = (md: string) => [...statementsOf("M", md).values()].map((s) => [s.anchor, s.source, s.section]);
    expect(ids(b.md)).toEqual(ids(a.md));
    expect(statementsOf("M", a.md).get("EXI_MOP_SPF_100_A_10")?.text).toContain(
      "La vue ligne affiche tous les postes de",
    );
  });
});

describe("docs.show reports a traced section that is not the defining one", () => {
  let project = "";
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "testimus-evidence-"));
    cpSync(FIXTURE, project, { recursive: true });
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  it("info names the requirement, both sections, and stays quiet for the defining section or an ancestor", async () => {
    const out = (await invoke("docs.show", { id: A }, { project })) as {
      info: { req: string; defined: string; traced: string[]; message: string }[];
    };
    expect(out.info).toEqual([
      {
        req: "EXI_MOP_SPF_100_A_40",
        defined: "§2.2",
        traced: ["§3.2"],
        message: "EXI_MOP_SPF_100_A_40 is defined in §2.2 but the matrix traces it to §3.2.",
      },
    ]);
    const file = join(project, "docs", A, "doc.md");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("s'ouvre par un double clic. | 3.2 |", "s'ouvre par un double clic. | 9.9 |"),
    );
    const again = (await invoke("docs.show", { id: A }, { project })) as { info: { message: string }[] };
    expect(again.info[0].message).toMatch(/traces it to §9\.9, which this document does not have/);
  });
});
