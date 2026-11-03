import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { anchorsOf } from "../../src/core/rag/convert.ts";
import { convertPdf, pdfFigures } from "../../src/core/rag/convert-pdf.ts";
import { encodePng } from "../../src/core/rag/convert-png.ts";

const text = (size: number, y: number, s: string) => `BT /F1 ${size} Tf 72 ${y} Td (${s}) Tj ET`;

function samplePdf(lines?: string[]): Uint8Array {
  const page1 = (
    lines ?? [
      text(18, 780, "1 Introduction"),
      text(11, 760, "Ce document decrit la traction du simulateur."),
      text(11, 746, "Il couvre les sectionneurs et les disjoncteurs."),
      text(18, 720, "1.1 Sectionneur"),
      text(11, 700, "EXI_MOP_SPF_511_A_1650 : le sectionneur est affiche."),
      "q 100 0 0 50 72 620 cm /Im1 Do Q",
      text(11, 605, "Figure 40 - Representation graphique sectionneur"),
      text(11, 580, "- premier point"),
    ]
  ).join("\n");
  const page2 = [text(11, 780, "Suite du texte sur la page deux."), text(11, 766, "Fin du document.")].join("\n");
  const pixels = "\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\xff";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 8 0 R >>",
    `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

function pngPixels(png: Uint8Array): number[] {
  const idat = png.indexOf(0x49, 33);
  const len = new DataView(png.buffer, png.byteOffset).getUint32(idat - 4);
  return [...inflateSync(png.subarray(idat + 4, idat + 4 + len))];
}

describe("PNG encoder", () => {
  it("writes filter bytes and RGB rows", () => {
    const png = encodePng(1, 2, 3, new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(pngPixels(png)).toEqual([0, 1, 2, 3, 0, 4, 5, 6]);
  });
});

describe("convertPdf", () => {
  it("guesses headings from numbering, anchors pages and figures", async () => {
    const c = await convertPdf(samplePdf(), { code: "DOC" });
    expect(c.md).toContain("<!-- page 1 -->");
    expect(c.md).toContain("<!-- page 2 -->");
    expect(c.md).toContain("## 1 Introduction <!-- § 1 -->");
    expect(c.md).toContain("### 1.1 Sectionneur <!-- § 1.1 -->");
    expect(c.md).toContain(
      "Ce document decrit la traction du simulateur. Il couvre les sectionneurs et les disjoncteurs.",
    );
    expect(c.md).toContain("\n\nEXI_MOP_SPF_511_A_1650 : le sectionneur est affiche.");
    expect(c.md).toContain("![Figure 40 - Representation graphique sectionneur](figures/fig-40.png) <!-- fig 40 -->");
    expect(c.md).toContain("- premier point");
    expect(anchorsOf(c.md).sections).toEqual(["1", "1.1"]);
    expect(c.figures).toHaveLength(1);
    expect(pngPixels(c.figures[0].data)).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
    expect(c.convertedWith).toMatch(/^pdfjs-dist /);
  });

  it("reads lettered, dashed headings and starts a paragraph at each numbered article under them", async () => {
    const c = await convertPdf(
      samplePdf([
        text(12, 780, "S.1 \x96 LES CERCLES SPORTIFS"),
        text(12, 760, "S.1.1 -GENERALITES"),
        text(11, 740, "S.1.1.1 Un cercle sportif est une association."),
        text(11, 726, "Il est dirige par un comite."),
        text(11, 712, "S.1.1.2"),
        text(11, 698, "Les tables sont conformes, voir S.1.1.1 et S.1.1.10."),
        text(11, 684, "S.2.1 Ce numero ne suit pas la section."),
        text(11, 670, "Texte courant pour la taille du corps."),
        text(11, 656, "Encore du texte courant."),
      ]),
      { code: "ROI" },
    );
    expect(c.md).toContain("## S.1 LES CERCLES SPORTIFS <!-- § S.1 -->");
    expect(c.md).toContain("### S.1.1 GENERALITES <!-- § S.1.1 -->");
    expect(c.md).toContain("\n\nS.1.1.1 Un cercle sportif est une association. Il est dirige par un comite.\n\n");
    expect(c.md).toContain("\n\nS.1.1.2 Les tables sont conformes");
    expect(c.md).not.toContain("<!-- req ");
    expect(anchorsOf(c.md).sections).toEqual(["S.1", "S.1.1"]);
  });

  it("gives the captioned figures for a docx to borrow", async () => {
    const figs = await pdfFigures(samplePdf());
    expect(figs.map((f) => [f.key, f.caption])).toEqual([["40", "Figure 40 - Representation graphique sectionneur"]]);
  });
});
