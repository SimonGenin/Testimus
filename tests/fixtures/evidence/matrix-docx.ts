import { writeZip } from "../../../src/core/lib/zip.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (t: string, bold = false) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const p = (t: string, style?: string, bold = false) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}</w:pPr>${run(t, bold)}</w:p>`;
const h = (level: number, t: string) => p(t, `Heading${level}`);
const cell = (t: string, bold = false) => `<w:tc><w:p>${run(t, bold)}</w:p></w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;

export function matrixDocx(variant: { extraParagraph?: string } = {}): Uint8Array {
  const body = [
    p("Spécification fonctionnelle – Poste"),
    h(1, "1 Généralités"),
    p("Ce document décrit le poste de commande."),
    h(1, "2 Affichage"),
    h(2, "2.1 Vue ligne"),
    p("EXI_MOP_SPF_100_A_10", undefined, true),
    p("La vue ligne affiche tous les postes de redressement de la ligne."),
    ...(variant.extraParagraph ? [p(variant.extraParagraph)] : []),
    h(1, "6 Couverture des exigences"),
    h(2, "6.1 Exigences"),
    p("Ce document répond aux exigences suivantes :"),
    `<w:tbl>${row(cell("Code Exigence", true), cell("Objet", true), cell("Section", true))}${row(
      cell("EXI_MOP_SPF_100_A_10"),
      cell("La vue ligne affiche tous les postes."),
      cell("2.1"),
    )}${row(cell("EXI_MOP_SPF_900_A_1"), cell("Le simulateur enregistre chaque commande."), cell("2.1"))}</w:tbl>`,
  ].join("");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2]
  .map(
    (l) =>
      `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${l - 1}"/></w:pPr></w:style>`,
  )
  .join("\n")}
</w:styles>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Id="rId1"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    "word/styles.xml": styles,
  };
  const enc = new TextEncoder();
  return writeZip(Object.entries(files).map(([name, data]) => ({ name, data: enc.encode(data) })));
}
