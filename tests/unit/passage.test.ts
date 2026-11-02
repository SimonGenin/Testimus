import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capLines, PASSAGE_MAX_CHARS, passage, passageMaxChars } from "../../src/core/rag/search/passage.ts";

const FIXTURE = new URL("../fixtures/evidence/project/", import.meta.url);
const A = "SPEC_A";
let project = "";

const setCap = (n: number) => {
  const file = join(project, "project.json");
  const p = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...p, rag: { ...p.rag, passageMaxChars: n } }));
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "testimus-passage-"));
  cpSync(FIXTURE, project, { recursive: true });
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("rag.passage on requirements (F1, F2)", () => {
  it("req: of a body requirement: focus is the statement, text its section", () => {
    const p = passage(project, `${A}#req:EXI_MOP_SPF_100_A_10`);
    expect(p).toMatchObject({ anchor: "req:EXI_MOP_SPF_100_A_10", path: "2 > 2.1", title: "Vue ligne" });
    expect(p.focus).toMatch(/^\*\*EXI_MOP_SPF_100_A_10\*\*\n\nLa vue ligne affiche/);
    expect(p.focus).toContain("en gris");
    expect(p.text).toContain("se rafraîchit toutes les secondes");
    expect(p.truncated).toBeUndefined();
    expect(p.figures.map((f) => f.anchor)).toEqual(["fig:1"]);
  });

  it("req: of a matrix-only requirement: focus is its row, never the whole table", () => {
    const p = passage(project, `${A}#req:EXI_MOP_SPF_900_A_1`);
    expect(p.focus).toBe(
      "EXI_MOP_SPF_900_A_1 — Le simulateur enregistre chaque commande de l'opérateur. (section 3.2)",
    );
    expect(p.path).toBe("6 > 6.1");
  });

  it("req:ID@matrix reads the row, under its traced section", () => {
    const p = passage(project, `${A}#req:EXI_MOP_SPF_100_A_40@matrix`);
    expect(p).toMatchObject({ anchor: "req:EXI_MOP_SPF_100_A_40@matrix", path: "3 > 3.2", title: "Ouverture" });
    expect(p.focus).toBe("EXI_MOP_SPF_100_A_40 — La vue détaillée s'ouvre par un double clic. (section 3.2)");
    expect(p.text.split("\n")).toEqual([
      "| **Code Exigence** | **Objet** | **Section** |",
      "| --- | --- | --- |",
      "| EXI_MOP_SPF_100_A_40 | La vue détaillée s'ouvre par un double clic. | 3.2 |",
    ]);
    expect(() => passage(project, `${A}#req:EXI_NOPE@matrix`)).toThrow(/no anchor/);
  });
});

describe("passage cap (SPEC-RAG §3.4)", () => {
  it("defaults to 12,000 characters, project.json.rag.passageMaxChars overrides", () => {
    expect(passageMaxChars(project)).toBe(PASSAGE_MAX_CHARS);
    expect(PASSAGE_MAX_CHARS).toBe(12_000);
    setCap(500);
    expect(passageMaxChars(project)).toBe(500);
  });

  it("above the cap: truncated, a window around the focus with the table's header, and readMore", () => {
    setCap(300);
    const p = passage(project, `${A}#req:EXI_MOP_SPF_900_A_2`);
    expect(p.truncated).toBe(true);
    expect(p.text.length).toBeLessThanOrEqual(300 + 120);
    expect(p.text).toContain("| EXI_MOP_SPF_900_A_2 |");
    expect(p.text.startsWith("| **Code Exigence** | **Objet** | **Section** |\n| --- | --- | --- |")).toBe(true);
    expect(p.readMore).toMatch(/^Read docs\/SPEC_A\/doc\.md lines \d+–\d+ for the whole section/);
    expect(p.outline).toEqual([]);
  });

  it("the outline lists the sub-sections with their size, requirement ids and figures", () => {
    const dir = join(project, "docs", "LONG");
    mkdirSync(dir);
    writeFileSync(join(dir, "doc.json"), JSON.stringify({ id: "LONG", code: "LONG", title: "Long" }));
    const long = Array.from({ length: 40 }, (_, i) => `Paragraphe ${i} ${"mot ".repeat(30)}`).join("\n\n");
    writeFileSync(
      join(dir, "doc.md"),
      `# LONG\n\n## 1 Long <!-- § 1 -->\n\n${long}\n\n### 1.1 Petit <!-- § 1.1 -->\n\n<!-- req EXI_L_1 -->\nEXI_L_1 : Une règle.\n\n#### 1.1.1 Détail <!-- § 1.1.1 -->\n\n![Figure 3 – Vue](figures/fig-3.png) <!-- fig 3 -->\n\n## 2 Autre <!-- § 2 -->\n\nFin.`,
    );
    setCap(1000);
    const p = passage(project, "LONG#§1");
    expect(p.truncated).toBe(true);
    expect(p.text.startsWith("Paragraphe 0")).toBe(true);
    expect(p.text.length).toBeLessThanOrEqual(1000);
    expect(p.outline).toEqual([
      { anchor: "§1.1", title: "Petit", chars: "EXI_L_1 : Une règle.".length, reqIds: ["EXI_L_1"], figureIds: [] },
      { anchor: "§1.1.1", title: "Détail", chars: expect.any(Number), figureIds: ["3"], reqIds: [] },
    ]);
    expect(p.readMore).toMatch(/lines 3–\d+ for the whole section .*this passage shows lines 4–\d+/);
    expect(passage(project, "LONG#§2").truncated).toBeUndefined();
  });

  it("capLines keeps whole lines and grows both ways from the focus", () => {
    const ls = ["a".repeat(10), "b".repeat(10), "c".repeat(10), "d".repeat(10), "e".repeat(10)];
    expect(capLines(ls, 0, 5, 100)).toMatchObject({ truncated: false, a: 0, b: 5 });
    const c = capLines(ls, 0, 5, 33, 2);
    expect(c).toMatchObject({ truncated: true, a: 1, b: 4 });
    expect(c.text).toBe(`${"b".repeat(10)}\n${"c".repeat(10)}\n${"d".repeat(10)}`);
  });
});

describe("a quote past the cap of a long section (review #16)", () => {
  const long = () => {
    const file = join(project, "docs", "LONG", "doc.md");
    mkdirSync(join(project, "docs", "LONG"), { recursive: true });
    const filler = Array.from({ length: 400 }, (_, i) => `Paragraphe ${i + 1} : la vue présente les équipements.`);
    writeFileSync(
      file,
      [
        "# LONG — Longue",
        "",
        "## 4 Vue système <!-- § 4 -->",
        "",
        ...filler.flatMap((l) => [l, ""]),
        "Le poste PR2I affiche l'état du disjoncteur",
        "de la sous-station en rouge clignotant.",
        "",
        "## 5 Suite <!-- § 5 -->",
        "",
        "Rien.",
      ].join("\n"),
    );
    writeFileSync(
      join(project, "docs", "LONG", "doc.json"),
      JSON.stringify({ id: "LONG", code: "LONG", title: "Longue", status: "validated", binding: "mandatory" }),
    );
  };
  const quote = "l'état du disjoncteur de la sous-station en rouge";

  it("around centres the capped window on the quote (even over two lines) and says it found it", () => {
    long();
    const plain = passage(project, "LONG#§4");
    expect(plain.truncated).toBe(true);
    expect(plain.text).not.toContain("en rouge clignotant");
    expect(plain.quoteFound).toBeUndefined();
    const p = passage(project, "LONG#§4", quote);
    expect(p.truncated).toBe(true);
    expect(p.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
    expect(p.text).toContain("Le poste PR2I affiche l'état du disjoncteur\nde la sous-station en rouge clignotant.");
    expect(p.quoteFound).toBe(true);
    expect(p.readMore).toMatch(/this passage shows lines \d+–\d+/);
  });

  it("a quote the section does not hold: the usual window and quoteFound false", () => {
    long();
    const p = passage(project, "LONG#§4", "une phrase absente");
    expect(p.quoteFound).toBe(false);
    expect(p.text).toBe(passage(project, "LONG#§4").text);
  });

  it("is the rag.passage around input", async () => {
    long();
    const { invoke } = await import("../../src/core/commands/index.ts");
    const p = (await invoke("rag.passage", { ref: "LONG#§4", around: quote }, { project })) as {
      text: string;
      quoteFound: boolean;
    };
    expect(p.quoteFound).toBe(true);
    expect(p.text).toContain("en rouge clignotant");
  });
});
