import { writeZip } from "../../../src/core/lib/zip.ts";
import { encodePng } from "../../../src/core/rag/convert-png.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS = `${W} ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (t: string, bold = false) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const p = (t: string, style?: string, extra = "") =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${run(t)}</w:p>`;
const h = (level: number, t: string, unnumbered = false) =>
  p(t, `Heading${level}`, unnumbered ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>' : "");

const image = (rid: string) =>
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const cell = (t: string) => `<w:tc><w:p>${run(t)}</w:p></w:tc>`;

export const SAMPLE_PNG = encodePng(2, 2, 3, new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]));

export function sampleDocx(variant: { extraParagraph?: string } = {}): Uint8Array {
  const body = [
    p("Projet SOSIE_NG Système"),
    p("Spécification fonctionnelle – Traction"),
    p("Version 01.01 du 12/06/2026"),
    p("1 Généralités 3", "TOC1"),
    h(1, "Généralités"),
    h(2, "Objet"),
    p("Ce document décrit la traction."),
    h(1, "Description"),
    h(1, "Simulation"),
    h(1, "Archivage"),
    h(1, "Présentation des vues"),
    h(2, "Principes"),
    h(2, "Image ligne"),
    h(2, "Image section"),
    h(2, "Image terminus"),
    h(2, "Image TCO"),
    h(2, "Liste des objets de traction"),
    h(3, "Section élémentaire"),
    h(3, "DHT"),
    h(3, "SIt"),
    h(3, "AA-HS"),
    h(3, "AA actionné"),
    h(3, "Sectionneur (S)"),
    h(4, "EXI_MOP_SPF_511_A_1650", true),
    p("Le sectionneur est représenté par le symbole de la Figure 40."),
    image("rIdImg1"),
    p("Figure 40 – Représentation graphique sectionneur", "Caption"),
    `<w:p>${run("EXI_MOP_SPF_511_A_1670 : Le menu contextuel d'un sectionneur sans TK propose ")}${run("Propriétés", true)}${run(".")}<w:r><w:commentReference w:id="0"/></w:r></w:p>`,
    `<w:tbl><w:tr>${cell("Exigence")}${cell("Texte")}</w:tr><w:tr>${cell("EXI_MOP_SPF_511_A_1680")}${cell("La fenêtre Propriétés | état")}</w:tr></w:tbl>`,
    p("État contrôlé Aspect Commentaire Confirmé ouvert Rouge fixe Figure 41 – Représentation graphique disjoncteur"),
    `<w:p><w:r><w:drawing><wp:anchor><wps:wsp><wps:txbx><w:txbxContent>${p("Label")}</w:txbxContent></wps:txbx></wps:wsp></wp:anchor></w:drawing></w:r></w:p>`,
    ...(variant.extraParagraph ? [p(variant.extraParagraph)] : []),
    h(3, "Disjoncteur (D)"),
    p("Le disjoncteur se ferme, voir EXI_MOP_SPF_511_A_1650."),
    h(1, "Annexe", true),
    p("Texte de l'annexe."),
  ].join("");

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[1, 2, 3, 4]
  .map(
    (l) =>
      `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="${l - 1}"/><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="${l - 1}"/></w:pPr></w:style>`,
  )
  .join("\n")}
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>`;

  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">${[0, 1, 2, 3]
    .map(
      (i) =>
        `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading${i + 1}"/><w:lvlText w:val="${Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join(".")}"/></w:lvl>`,
    )
    .join("")}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Id="rId1"/><Relationship Target="numbering.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Id="rId2"/><Relationship Target="media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Id="rIdImg1"/><Relationship Target="comments.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Id="rId3"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    "word/styles.xml": styles,
    "word/numbering.xml": numbering,
    "word/comments.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${W}><w:comment w:id="0" w:author="RATP"><w:p>${run("À préciser")}</w:p></w:comment></w:comments>`,
    "word/media/image1.png": SAMPLE_PNG,
  };
  const enc = new TextEncoder();
  return writeZip(
    Object.entries(files).map(([name, data]) => ({ name, data: typeof data === "string" ? enc.encode(data) : data })),
  );
}
