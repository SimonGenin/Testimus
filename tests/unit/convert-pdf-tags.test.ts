import { describe, expect, it } from "vitest";
import { convertPdf, pdfFigures } from "../../src/core/rag/convert-pdf.ts";
import { taggedPdf } from "../fixtures/pdf/tagged.ts";

describe("convertPdf over a tagged PDF (Word's « Save as PDF »)", () => {
  it("reads headings, lists, tables and figures from the tags, numbered from the bookmarks", async () => {
    const c = await convertPdf(taggedPdf({ outline: true }), { code: "SPEC" });
    expect(c.convertedWith).toMatch(/tagged PDF/);
    expect(c.md).toContain("## 1 Generalites <!-- § 1 -->");
    expect(c.md).toContain("### 1.1 Objet <!-- § 1.1 -->");
    expect(c.md).toContain("### 1.2 Exigences <!-- § 1.2 -->");
    expect(c.md).toContain("- premier point");
    expect(c.md).toContain("| Etat | Aspect |\n| --- | --- |\n| Ouvert | Rouge |\n| Ferme | Vert |");
    expect(c.md).toContain("La regle s'applique quand le texte continue sur la page suivante.");
    expect(c.md).toContain("![Figure 3 - Schema de principe](figures/fig-3.png) <!-- fig 3 -->");
    expect(c.md.match(/<!-- fig 3 -->/g)).toHaveLength(1);
    expect(c.md).toContain("Le bouton ferme le dialogue. Figure 3 - Schema de principe\n");
    expect(c.md).not.toContain("Entete du projet");
    expect(c.md).toContain("<!-- page 3 -->");
    expect(c.figures.map((f) => f.key)).toEqual(["3"]);
    expect([...c.figures[0].data.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(c.warnings).toEqual([
      "Figure 9: captioned or named in the text, but nothing is drawn there in the PDF — the original lost these pictures (a drawing pasted as text, or never inserted)",
    ]);
  });

  it("never guesses a heading number that is only drawn: the title anchors it, and the warning says so", async () => {
    const c = await convertPdf(taggedPdf(), { code: "SPEC" });
    expect(c.md).toContain("## Generalites <!-- § generalites -->");
    expect(c.md).toContain("### Objet <!-- § objet -->");
    expect(c.md).toContain("### Exigences <!-- § exigences -->");
    expect(c.warnings).toContain(
      "3 heading numbers are drawn on the page but missing from the PDF text: those headings are anchored by their titles — add the .docx of the same document, or read the numbers on the pages and give them to docs.convert (conversion numbers)",
    );
  });

  it("gives a docx the captioned figures it rendered", async () => {
    const figs = await pdfFigures(taggedPdf({ outline: true }));
    expect(figs.map((f) => [f.key, f.caption])).toEqual([["3", "Figure 3 - Schema de principe"]]);
  });
});

describe("convertPdf over a page without text", () => {
  it("keeps the page as a picture and says it cannot be quoted", async () => {
    const body = "0 0 1 rg 72 72 400 600 re f";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    ];
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const c = await convertPdf(
      Uint8Array.from(out, (ch) => ch.charCodeAt(0)),
      { code: "SCAN" },
    );
    expect(c.figures.map((f) => f.key)).toEqual(["p1"]);
    expect(c.md).toContain("![](figures/fig-p1.png) <!-- fig p1 -->");
    expect(c.warnings).toEqual([
      "1 of 1 pages carry no text (a scan, or text drawn as pictures): kept as page pictures that Claude reads when it describes the figures, but nothing on them can be quoted — ask for the source document",
    ]);
  });
});
