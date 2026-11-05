import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  capLines,
  figure,
  PASSAGE_MAX_CHARS,
  passage,
  passageMaxChars,
} from "../../../../src/core/rag/search/passage.ts";

describe("passages", () => {
  const FIXTURE = new URL("../../../fixtures/evidence/project/", import.meta.url);
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

  describe("rag.passage by anchor", () => {
    it("a section: its text, its path and title, its figures", () => {
      const p = passage(project, `${A}#2.1`);
      expect(p).toMatchObject({ anchor: "§2.1", path: "2 > 2.1", title: "Vue ligne" });
      expect(p.text).toContain("se rafraîchit toutes les secondes");
      expect(p.text).not.toContain("<!--");
      expect(p.truncated).toBeUndefined();
      expect(p.figures.map((f) => f.anchor)).toEqual(["fig:1"]);
      expect(p).not.toHaveProperty("focus");
    });

    it("an old requirement anchor is no anchor", () => {
      expect(() => passage(project, `${A}#req:EXI_MOP_SPF_100_A_10`)).toThrow(/no anchor/);
      expect(() => passage(project, `${A}#req:EXI_MOP_SPF_100_A_40@matrix`)).toThrow(/no anchor/);
    });
  });

  describe("passage cap (SPEC-RAG §3.4)", () => {
    it("defaults to 12,000 characters, project.json.rag.passageMaxChars overrides", () => {
      expect(passageMaxChars(project)).toBe(PASSAGE_MAX_CHARS);
      expect(PASSAGE_MAX_CHARS).toBe(12_000);
      setCap(500);
      expect(passageMaxChars(project)).toBe(500);
    });

    it("above the cap: truncated, a window around the quote with the table's header, and readMore", () => {
      setCap(300);
      const p = passage(project, `${A}#§6.1`, "Les commandes refusées sont signalées");
      expect(p.truncated).toBe(true);
      expect(p.quoteFound).toBe(true);
      expect(p.text.length).toBeLessThanOrEqual(300 + 120);
      expect(p.text).toContain("| EXI_MOP_SPF_900_A_2 |");
      expect(p.text.startsWith("| **Code Exigence** | **Objet** | **Section** |\n| --- | --- | --- |")).toBe(true);
      expect(p.readMore).toMatch(/^Read docs\/SPEC_A\/doc\.md lines \d+–\d+ for the whole section/);
      expect(p.outline).toEqual([]);
    });

    it("the outline lists the sub-sections with their size and figures", () => {
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
        { anchor: "§1.1", title: "Petit", chars: "EXI_L_1 : Une règle.".length, figureIds: [] },
        { anchor: "§1.1.1", title: "Détail", chars: expect.any(Number), figureIds: ["3"] },
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

    it("capLines never repeats a table's separator row the window already holds", () => {
      const ls = ["| Id | Texte |", "| --- | --- |", ...Array.from({ length: 10 }, (_, i) => `| R${i} | ligne ${i} |`)];
      const c = capLines(ls, 0, ls.length, 65, 3);
      expect(c).toMatchObject({ truncated: true, a: 1 });
      expect(c.text.split("\n").slice(0, 3)).toEqual(["| Id | Texte |", "| --- | --- |", "| R0 | ligne 0 |"]);
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
        JSON.stringify({ id: "LONG", code: "LONG", title: "Longue", status: "validated" }),
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
      const { invoke } = await import("../../../../src/core/commands/index.ts");
      const p = (await invoke("rag.passage", { ref: "LONG#§4", around: quote }, { project })) as {
        text: string;
        quoteFound: boolean;
      };
      expect(p.quoteFound).toBe(true);
      expect(p.text).toContain("en rouge clignotant");
    });
  });
});

describe("passages — less common inputs", () => {
  let dir = "";
  const addDoc = (id: string, md: string, json?: Record<string, unknown>) => {
    mkdirSync(join(dir, "docs", id), { recursive: true });
    writeFileSync(join(dir, "docs", id, "doc.md"), md);
    if (json) writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify(json));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "testimus-cov-search-"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t" }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("passage — the less common anchors", () => {
    const MD = [
      "<!-- fig 1 --> Figure 1 – Vue générale",
      "",
      "Un texte avant toute section.",
      "",
      "## 1 Général <!-- § 1 -->",
      "",
      "Le texte cite EXI_INLINE_1 <!-- req EXI_INLINE_1 --> dans une phrase.",
    ].join("\n");

    beforeEach(() => addDoc("P", MD));

    it("refuses a document the project does not have", () => {
      expect(() => passage(dir, "NOPE#§1")).toThrow(/No document NOPE/);
      expect(() => figure(dir, "NOPE", "1")).toThrow(/No document NOPE/);
    });

    it("a document without doc.json gets default metadata", () => {
      expect(passage(dir, "P#§1").doc).toEqual({
        code: "P",
        title: "",
        version: "",
        status: "draft",
      });
    });

    it("a figure before any section has no path, and an unknown figure is refused", () => {
      expect(passage(dir, "P#fig:1")).toMatchObject({ path: "", title: "Figure 1 – Vue générale" });
      expect(figure(dir, "P", "fig:1")).toMatchObject({ n: "1", path: "" });
      expect(() => passage(dir, "P#fig:99")).toThrow(/has no anchor fig:99/);
    });

    it("a figure that captions a table of the text, read by its anchor, carries that table; a section's figures do not", () => {
      const table = "| État | Couleur |\n| --- | --- |\n| Libre | Vert |";
      addDoc("T", `## 1 Couleurs <!-- § 1 -->\n\n${table}\n\nFigure 2 – Couleurs des états <!-- fig 2 -->\n`);
      expect(passage(dir, "T#fig:2").figures).toEqual([
        { file: "", anchor: "fig:2", caption: "Figure 2 – Couleurs des états", description: "", table },
      ]);
      const section = passage(dir, "T#§1");
      expect(section.text).toContain(table);
      expect(section.figures[0]).not.toHaveProperty("table");
    });

    it("an old requirement marker is an ordinary comment, never an anchor", () => {
      expect(passage(dir, "P#§1").text).toBe("Le texte cite EXI_INLINE_1 dans une phrase.");
      expect(() => passage(dir, "P#req:EXI_INLINE_1")).toThrow(/has no anchor/);
    });
  });
});
