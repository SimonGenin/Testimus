import { describe, expect, it } from "vitest";
import { convertPdf, pdfFigures } from "../../src/core/rag/convert-pdf.ts";

type E = { s: string; page?: number; mcid?: number; kids?: E[]; attr?: string };

const text = (tag: string, mcid: number, size: number, x: number, y: number, s: string) =>
  `/${tag} <</MCID ${mcid}>> BDC BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET EMC`;

const PAGES = [
  [
    "/Artifact BMC BT /F1 9 Tf 72 815 Td (Entete du projet) Tj ET EMC",
    text("H1", 0, 16, 100, 780, "Generalites"),
    text("P", 1, 11, 72, 760, "Ce document decrit la traction."),
    text("Lbl", 2, 11, 80, 740, "\\225"),
    text("LBody", 3, 11, 92, 740, "premier point"),
    "/Figure <</MCID 4>> BDC 0 0 1 rg 72 520 300 120 re f EMC",
    text("Caption", 5, 10, 72, 505, "Figure 3 - Schema de principe"),
    text("H2", 6, 13, 100, 470, "Objet"),
    text("TH", 7, 11, 72, 440, "Etat"),
    text("TH", 8, 11, 200, 440, "Aspect"),
    text("TD", 9, 11, 72, 425, "Ouvert"),
    text("TD", 10, 11, 200, 425, "Rouge"),
  ],
  [
    "/Artifact BMC BT /F1 9 Tf 72 815 Td (Entete du projet) Tj ET EMC",
    text("TD", 0, 11, 72, 780, "Ferme"),
    text("TD", 1, 11, 200, 780, "Vert"),
    text("P", 2, 11, 72, 740, "La regle s'applique quand le texte"),
  ],
  [
    text("P", 0, 11, 72, 780, "continue sur la page suivante."),
    text("H2", 1, 13, 100, 750, "Exigences"),
    text("P", 2, 11, 72, 730, "Le bouton ferme le dialogue. Figure 3 - Schema de principe"),
    text("Caption", 3, 10, 72, 600, "Figure 9 - Schema perdu"),
  ],
];

const TREE: E = {
  s: "Document",
  kids: [
    { s: "H1", page: 0, mcid: 0 },
    { s: "P", page: 0, mcid: 1 },
    {
      s: "L",
      kids: [
        {
          s: "LI",
          kids: [
            { s: "Lbl", page: 0, mcid: 2 },
            { s: "LBody", page: 0, mcid: 3 },
          ],
        },
      ],
    },
    { s: "Figure", page: 0, mcid: 4, attr: "/A << /O /Layout /BBox [72 520 372 640] >>" },
    { s: "Caption", page: 0, mcid: 5 },
    { s: "H2", page: 0, mcid: 6 },
    {
      s: "Table",
      kids: [
        {
          s: "TR",
          kids: [
            { s: "TH", page: 0, mcid: 7 },
            { s: "TH", page: 0, mcid: 8 },
          ],
        },
        {
          s: "TR",
          kids: [
            { s: "TD", page: 0, mcid: 9 },
            { s: "TD", page: 0, mcid: 10 },
          ],
        },
      ],
    },
    {
      s: "Table",
      kids: [
        {
          s: "TR",
          kids: [
            { s: "TD", page: 1, mcid: 0 },
            { s: "TD", page: 1, mcid: 1 },
          ],
        },
      ],
    },
    { s: "P", page: 1, mcid: 2 },
    { s: "P", page: 2, mcid: 0 },
    { s: "H2", page: 2, mcid: 1 },
    { s: "P", page: 2, mcid: 2 },
    { s: "Caption", page: 2, mcid: 3 },
  ],
};

function taggedPdf(o: { outline?: boolean } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (s = "") => objs.push(s);
  const catalog = add();
  const pages = add();
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const root = add();
  const parentTree = add();
  const pageRefs = PAGES.map(() => add());
  const byMcid: number[][] = PAGES.map(() => []);
  const elem = (e: E, parent: number): number => {
    const n = add();
    const kids = (e.kids ?? []).map((k) => elem(k, n));
    if (e.page !== undefined) byMcid[e.page][e.mcid!] = n;
    const k =
      e.page !== undefined
        ? `/Pg ${pageRefs[e.page]} 0 R /K ${e.mcid}`
        : `/K [${kids.map((x) => `${x} 0 R`).join(" ")}]`;
    objs[n - 1] = `<< /Type /StructElem /S /${e.s} /P ${parent} 0 R ${k} ${e.attr ?? ""} >>`;
    return n;
  };
  const doc = elem(TREE, root);
  objs[root - 1] = `<< /Type /StructTreeRoot /K [${doc} 0 R] /ParentTree ${parentTree} 0 R >>`;
  objs[parentTree - 1] =
    `<< /Nums [${byMcid.map((refs, i) => `${i} [${refs.map((r) => `${r} 0 R`).join(" ")}]`).join(" ")}] >>`;
  PAGES.forEach((lines, i) => {
    const body = lines.join("\n");
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    objs[pageRefs[i] - 1] =
      `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /StructParents ${i} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`;
  });
  let outlines = "";
  if (o.outline) {
    const top = add();
    const g = add();
    const b = add();
    const c = add();
    objs[top - 1] = `<< /Type /Outlines /First ${g} 0 R /Last ${g} 0 R /Count 3 >>`;
    objs[g - 1] = `<< /Title (1   Generalites) /Parent ${top} 0 R /First ${b} 0 R /Last ${c} 0 R /Count 2 >>`;
    objs[b - 1] = `<< /Title (1.1   Objet) /Parent ${g} 0 R /Next ${c} 0 R >>`;
    objs[c - 1] = `<< /Title (1.2   Exigences) /Parent ${g} 0 R /Prev ${b} 0 R >>`;
    outlines = ` /Outlines ${top} 0 R`;
  }
  objs[catalog - 1] =
    `<< /Type /Catalog /Pages ${pages} 0 R /MarkInfo << /Marked true >> /StructTreeRoot ${root} 0 R${outlines} >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objs.forEach((s, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${s}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0));
}

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
      "3 heading numbers are drawn on the page but missing from the PDF text: those headings are anchored by their titles — add the .docx of the same document to get the numbers",
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
