import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "../../../../src/core/lib/zip.ts";
import { anchorsOf, guessDate, guessFromName, sameCaption } from "../../../../src/core/rag/convert.ts";
import { convertDocx } from "../../../../src/core/rag/convert-docx.ts";
import { SAMPLE_PNG, sampleDocx } from "../../../fixtures/docx/sample.ts";

describe("zip", () => {
  it("reads back what it writes", () => {
    const data = new TextEncoder().encode("bonjour ".repeat(50));
    const files = readZip(writeZip([{ name: "a/b.txt", data }]));
    expect(new TextDecoder().decode(files.get("a/b.txt"))).toBe("bonjour ".repeat(50));
  });
});

describe("file name and first page guesses", () => {
  it("reads code and version from RATP file names", () => {
    expect(guessFromName("C:/x/SOSIE_211_D401-1_3_01.01.docx")).toEqual({
      code: "SOSIE_211_D401-1_3",
      version: "01.01",
    });
    expect(guessFromName("SOSIE_211_D401-1_4_01_01_TC.docx")).toEqual({ code: "SOSIE_211_D401-1_4", version: "01.01" });
    expect(guessFromName("SOSIE_6_D401-1_01.00.pdf")).toEqual({ code: "SOSIE_6_D401-1", version: "01.00" });
    expect(guessFromName("Notes de réunion.docx").version).toBe("");
  });

  it("reads a French date", () => {
    expect(guessDate("Version 01.01 du 9/10/2026")).toBe("2026-10-09");
  });

  it("compares captions by number-free text", () => {
    expect(
      sameCaption("Figure 40 – Représentation graphique", "Figure 40 - Representation graphique sectionneur"),
    ).toBe(true);
    expect(sameCaption("Figure 40 – Représentation graphique", "Figure 40 – Visualisation des états")).toBe(false);
  });
});

describe("convertDocx", () => {
  it("anchors computed section numbers and figures; ids in the text are plain text", async () => {
    const c = await convertDocx(sampleDocx(), { code: "SOSIE_211_D401-1_3" });
    expect(c.md.startsWith("# SOSIE_211_D401-1_3 — Spécification fonctionnelle – Traction\n")).toBe(true);
    expect(c.md).toContain("#### 5.6.6 Sectionneur (S) <!-- § 5.6.6 -->");
    expect(c.md).toContain("#### 5.6.7 Disjoncteur (D) <!-- § 5.6.7 -->");
    expect(c.md).toContain("### 1.1 Objet <!-- § 1.1 -->");
    expect(c.md).toContain("## Annexe <!-- § annexe -->");
    expect(c.md).toContain("##### EXI_MOP_SPF_511_A_1650 <!-- § exi-mop-spf-511-a-1650 -->");
    expect(c.md).toContain(
      "\n\nEXI_MOP_SPF_511_A_1670 : Le menu contextuel d'un sectionneur sans TK propose **Propriétés**.",
    );
    expect(c.md).toContain("\n\n| Exigence | Texte |");
    expect(c.md).toContain("| EXI_MOP_SPF_511_A_1680 | La fenêtre Propriétés \\| état |");
    expect(c.md).toContain("![Figure 40 – Représentation graphique sectionneur](figures/fig-40.png) <!-- fig 40 -->");
    expect(c.md).not.toMatch(/\n\nFigure 40 – Représentation graphique sectionneur\n/);
    expect(c.md).toContain("Figure 41 – Représentation graphique disjoncteur <!-- fig 41 -->");
    expect(c.md).not.toContain("Généralités 3");
    expect(c.md).not.toContain("<!-- req ");

    const a = anchorsOf(c.md);
    expect(a.sections).toEqual([
      "1",
      "1.1",
      "2",
      "3",
      "4",
      "5",
      "5.1",
      "5.2",
      "5.3",
      "5.4",
      "5.5",
      "5.6",
      "5.6.1",
      "5.6.2",
      "5.6.3",
      "5.6.4",
      "5.6.5",
      "5.6.6",
      "exi-mop-spf-511-a-1650",
      "5.6.7",
      "annexe",
    ]);

    expect(c.figures).toHaveLength(1);
    expect(c.figures[0]).toMatchObject({
      key: "40",
      ext: "png",
      caption: "Figure 40 – Représentation graphique sectionneur",
    });
    expect([...c.figures[0].data]).toEqual([...SAMPLE_PNG]);
    expect(c.meta).toEqual({ title: "Spécification fonctionnelle – Traction", date: "2026-06-12" });
    expect(c.warnings).toEqual([
      "1 Word comment was dropped",
      "1 shape drawn in Word: the drawing is lost, only text labels can survive",
      expect.stringMatching(/^Figure 41: caption without a picture in the \.docx/),
    ]);
    expect(c.convertedWith).toMatch(/^mammoth \d/);
  });

  it("keeps anchors stable when the document is converted again or text is added", async () => {
    const a = await convertDocx(sampleDocx(), { code: "X" });
    const b = await convertDocx(sampleDocx(), { code: "X" });
    expect(b.md).toBe(a.md);
    const c = await convertDocx(sampleDocx({ extraParagraph: "Un paragraphe ajouté en 01.02." }), { code: "X" });
    expect(anchorsOf(c.md)).toEqual(anchorsOf(a.md));
  });

  it("numbers a heading that skips a level like Word: the skipped level is 1 and the next one is 2", async () => {
    const c = await convertDocx(sampleDocx({ skippedLevel: true }), { code: "X" });
    expect(anchorsOf(c.md).sections.slice(2, 7)).toEqual(["2", "2.1.1", "2.2", "2.3", "3"]);
  });

  it("takes a missing picture from the PDF figures when the caption matches", async () => {
    const pdfFigure = {
      key: "41",
      caption: "Figure 41 - Représentation graphique disjoncteur",
      ext: "png",
      data: SAMPLE_PNG,
    };
    const c = await convertDocx(sampleDocx(), { code: "X", pdfFigures: [pdfFigure] });
    expect(c.md).toContain(
      "Figure 41 – Représentation graphique disjoncteur\n\n![Figure 41 – Représentation graphique disjoncteur](figures/fig-41.png) <!-- fig 41 -->",
    );
    expect(c.figures.map((f) => f.key)).toEqual(["40", "41"]);
    expect(c.warnings.some((w) => w.includes("Figure 41"))).toBe(false);
  });

  it("takes the picture drawn from a PDF page for a caption without one, before the PDF figures", async () => {
    const crop = { key: "41", caption: "", ext: "png", data: new Uint8Array([1, 2, 3]) };
    const pdfFigure = {
      key: "41",
      caption: "Figure 41 - Représentation graphique disjoncteur",
      ext: "png",
      data: SAMPLE_PNG,
    };
    const c = await convertDocx(sampleDocx(), { code: "X", pdfFigures: [pdfFigure], crops: new Map([["41", crop]]) });
    expect(c.md).toContain("](figures/fig-41.png) <!-- fig 41 -->");
    const fig = c.figures.find((f) => f.key === "41");
    expect(fig?.data).toBe(crop.data);
    expect(fig?.caption).toMatch(/^Figure 41/);
    expect(c.warnings.join("\n")).not.toMatch(/Figure 41:/);
  });

  it("refuses a file that is not a Word document", async () => {
    const zip = writeZip([{ name: "hello.txt", data: new TextEncoder().encode("hi") }]);
    await expect(convertDocx(zip, { code: "X" })).rejects.toThrow(/Not a Word document/);
  });
});
