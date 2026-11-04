import { describe, expect, it } from "vitest";
import { writeZip } from "../../../../src/core/lib/zip.ts";
import { convertDocx } from "../../../../src/core/rag/convert-docx.ts";
import { SAMPLE_PNG } from "../../../fixtures/docx/sample.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS = `${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (s: string) => `<w:r><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
const pPr = (style?: string, extra = "") => `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>`;
const p = (s: string, style?: string, extra = "") => `<w:p>${pPr(style, extra)}${run(s)}</w:p>`;
const num = (numId: string, ilvl: number) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
const drawing = (rid: string, descr = "") =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1"${descr ? ` descr="${descr}"` : ""}/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const img = (rid: string, descr = "", style?: string) => `<w:p>${pPr(style)}${drawing(rid, descr)}</w:p>`;
const style = (id: string, body: string) => `<w:style w:type="paragraph" w:styleId="${id}">${body}</w:style>`;

type Build = {
  body: string;
  styles?: string;
  numbering?: string;
  comments?: string;
  core?: string;
  media?: Record<string, { file: string; data?: Uint8Array }>;
};

function docx(b: Build): Uint8Array {
  const media = b.media ?? {};
  const rels = [
    `<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdN" Type="${REL}/numbering" Target="numbering.xml"/>`,
    ...Object.entries(media).map(
      ([id, m]) => `<Relationship Id="${id}" Type="${REL}/image" Target="media/${m.file}"/>`,
    ),
  ];
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/><Default Extension="wmf" ContentType="image/x-wmf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${b.body}<w:sectPr/></w:body></w:document>`,
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>${style("Normal", '<w:name w:val="Normal"/>')}${b.styles ?? ""}</w:styles>`,
    "word/numbering.xml": `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>${b.numbering ?? ""}</w:numbering>`,
  };
  if (b.comments) files["word/comments.xml"] = b.comments;
  if (b.core) files["docProps/core.xml"] = b.core;
  for (const m of Object.values(media)) if (m.data) files[`word/media/${m.file}`] = m.data;
  const enc = new TextEncoder();
  return writeZip(
    Object.entries(files).map(([name, data]) => ({ name, data: typeof data === "string" ? enc.encode(data) : data })),
  );
}

const headingStyles = [1, 2, 3]
  .map((l) =>
    style(
      `Heading${l}`,
      `<w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${l - 1}"/></w:pPr>`,
    ),
  )
  .join("");

describe("convertDocx heading levels and numbers", () => {
  it("reads levels from names, outlines, numbering and linked lists, and numbers what Word numbers", async () => {
    const styles = [
      headingStyles,
      '<w:style w:type="paragraph"><w:name w:val="no id"/></w:style>',
      style("Bare", '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>'),
      style("Loop1", '<w:name w:val="Loop one"/><w:basedOn w:val="Loop2"/>'),
      style("Loop2", '<w:name w:val="Loop two"/><w:basedOn w:val="Loop1"/>'),
      style("Orphan", '<w:name w:val="Orphan"/><w:basedOn w:val="Missing"/>'),
      style("Numbered", `<w:name w:val="Numbered"/><w:pPr>${num("5", 1)}<w:outlineLvl w:val="0"/></w:pPr>`),
      style("Child", '<w:name w:val="Child"/><w:basedOn w:val="Numbered"/>'),
      style("Linked", `<w:name w:val="Linked"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>`),
      style("Zero", `<w:name w:val="Zero"/><w:pPr>${num("0", 0)}<w:outlineLvl w:val="2"/></w:pPr>`),
      style("TitleStyle", '<w:name w:val="Title"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>'),
      style("Cap", '<w:name w:val="caption"/>'),
      style("Deep", `<w:name w:val="Deep"/><w:pPr>${num("5", 2)}<w:outlineLvl w:val="2"/></w:pPr>`),
      style("Heading5", '<w:name w:val="Subtitle"/>'),
    ].join("");
    const numbering = `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:pStyle w:val="Linked"/></w:lvl><w:lvl w:ilvl="1"><w:pStyle w:val="Linked"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>`;
    const body = [
      p("Front matter 2026-01-02"),
      p("Le titre", "TitleStyle"),
      p("1 Écrit à la main", "Heading1"),
      p("Sans numéro", "Heading2"),
      p("Niveau nu", "Bare"),
      p("Boucle", "Loop1"),
      p("Orphelin", "Orphan"),
      p("Numéroté", "Numbered"),
      p("Enfant", "Child"),
      p("Encore", "Child"),
      p("Lié sans liste", "Linked"),
      p("Lié en liste", "Linked", num("5", 0)),
      p("Profond", "Deep"),
      p("Sous-titre", "Heading5"),
      `<w:p>${pPr("Heading5")}<w:r><w:tab/></w:r></w:p>`,
      p("Liste niveau", "Heading1", num("5", 2)),
      p("Zéro", "Zero"),
      p("Heading inconnu", "heading 3"),
      p("Inconnu", "Nope"),
      `<w:p>${pPr("Heading2")}</w:p>`,
      `<w:p>${pPr("Heading2")}<w:r><w:t>Tab</w:t><w:tab/><w:t>et</w:t><w:br/><w:t>saut</w:t></w:r></w:p>`,
      p("EXI_MOP_A_1 :", "Heading3"),
      p("Ignored TOC", "TOC2"),
      p("Ignored figures", "TableofFigures", ""),
    ].join("");
    const styles2 = `${styles}${style("TableofFigures", '<w:name w:val="table of figures"/>')}`;
    const c = await convertDocx(docx({ body, styles: styles2, numbering }), { code: "H" });
    expect(c.md).toBe(
      [
        "# H — Front matter 2026-01-02",
        "Front matter 2026-01-02",
        "Le titre",
        "## 1 Écrit à la main <!-- § 1 -->",
        "### Sans numéro <!-- § sans-numero -->",
        "### Niveau nu <!-- § niveau-nu -->",
        "Boucle",
        "Orphelin",
        "### 1.1 Numéroté <!-- § 1.1 -->",
        "### 1.2 Enfant <!-- § 1.2 -->",
        "### 1.3 Encore <!-- § 1.3 -->",
        "### 1.4 Lié sans liste <!-- § 1.4 -->",
        "## 2 Lié en liste <!-- § 2 -->",
        "#### 2.1.1 Profond <!-- § 2.1.1 -->",
        "Sous-titre",
        "## Liste niveau <!-- § liste-niveau -->",
        "#### Zéro <!-- § zero -->",
        "#### Heading inconnu <!-- § heading-inconnu -->",
        "Inconnu",
        "### Tab et saut <!-- § tab-et-saut -->",
        "#### EXI_MOP_A_1 : <!-- § exi-mop-a-1 -->\n",
      ].join("\n\n"),
    );
    expect(c.meta).toEqual({ title: "Front matter 2026-01-02", date: "2026-01-02" });
  });
});

const bullets = `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="2"/></w:num>`;
const li = (s: string, level = 0) => p(s, undefined, num("7", level));
const cellXml = (inner: string) => `<w:tc>${inner}</w:tc>`;

describe("convertDocx figures and warnings", () => {
  it("pairs pictures with captions after or before them, keeps metafiles and borrows from the PDF", async () => {
    const long = `${"Un texte très long qui décrit beaucoup de choses. ".repeat(7)}Figure 10 – Légende en fin de paragraphe`;
    const body = [
      p("Intro"),
      p("1 Chapitre", "Heading1"),
      img("rImg1"),
      p("Figure 1 – Pompe [P1]", "Cap"),
      p("Figure 2 – Vanne"),
      img("rImg2"),
      p("Texte après."),
      img("rImg3", "Texte alternatif"),
      p("Encore du texte."),
      img("rImg7"),
      `<w:p>${drawing("rImg8")}${run("Figure 6 – Avec image")}</w:p>`,
      p("Séparateur."),
      img("rEmf"),
      img("rWmf"),
      img("rGone"),
      p("Séparateur."),
      p("Figure 8 – Récupérable"),
      p("Figure 9 – Introuvable"),
      p(long),
      p("Figure 11 ........ 12"),
      li("Point un"),
      li("Sous-point", 1),
      `<w:p>${pPr(undefined, num("7", 0))}${drawing("rImg4")}</w:p>`,
      li("Figure 12 – En liste"),
      li("Figure 13 – Orpheline en liste"),
      p("Séparateur."),
      `<w:p>${pPr("Heading2")}${run("Titre illustré")}${drawing("rImg5")}</w:p>`,
      `<w:tbl><w:tr>${cellXml(img("rImg6"))}${cellXml(p("Figure 14 – Dans un tableau"))}</w:tr></w:tbl>`,
      `<w:p><w:r><w:commentReference w:id="0"/></w:r><w:r><w:commentReference w:id="1"/></w:r>${run("Commenté")}</w:p>`,
      `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wps:wsp/></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:rect/></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
      `<w:p><w:r><w:pict><v:shape/><v:oval/></w:pict></w:r></w:p>`,
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><c:chart/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><c:chart/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      `<w:p><w:r><w:object><v:shape><v:imagedata/></v:shape></w:object></w:r></w:p>`,
      `<w:p><w:r><w:object><v:shape><v:imagedata/></v:shape></w:object></w:r></w:p>`,
    ].join("");
    const media = {
      rImg1: { file: "a.png", data: SAMPLE_PNG },
      rImg2: { file: "b.png", data: SAMPLE_PNG },
      rImg3: { file: "c.png", data: SAMPLE_PNG },
      rImg4: { file: "d.png", data: SAMPLE_PNG },
      rImg5: { file: "e.png", data: SAMPLE_PNG },
      rImg6: { file: "f.png", data: SAMPLE_PNG },
      rImg7: { file: "i.png", data: SAMPLE_PNG },
      rImg8: { file: "j.png", data: SAMPLE_PNG },
      rEmf: { file: "g.emf", data: new Uint8Array([1]) },
      rWmf: { file: "h.wmf", data: new Uint8Array([2]) },
      rGone: { file: "missing.png" },
    };
    const pdfFigures = [
      { key: "9-2", caption: "Figure 9 – Rien à voir du tout", ext: "png", data: SAMPLE_PNG },
      { key: "8", caption: "Figure 8 - Recuperable", ext: "png", data: SAMPLE_PNG },
    ];
    const c = await convertDocx(
      docx({ body, styles: headingStyles + style("Cap", '<w:name w:val="caption"/>'), numbering: bullets, media }),
      {
        code: "F",
        pdfFigures,
      },
    );
    expect(c.warnings).toEqual([
      "2 Word comments were dropped",
      "3 shapes drawn in Word: the drawing is lost, only text labels can survive",
      "2 charts: not converted (no picture)",
      "2 embedded objects: only their preview picture survives",
      expect.stringMatching(/^mammoth: /),
      "2 Windows metafile pictures kept as is, not rendered to PNG: figure f6 (.emf), f7 (.wmf)",
      "Figure 8: picture missing in the .docx, taken from the .pdf",
      "Figure 9, 10, 13: caption without a picture in the .docx (drawn shape, table or pasted text) and not found in the .pdf",
    ]);
    expect(c.figures.map((f) => [f.key, f.ext])).toEqual([
      ["1", "png"],
      ["2", "png"],
      ["f3", "png"],
      ["f4", "png"],
      ["6", "png"],
      ["f6", "emf"],
      ["f7", "wmf"],
      ["8", "png"],
      ["12", "png"],
      ["f9", "png"],
      ["14", "png"],
    ]);
    const md = c.md;
    expect(md).toContain("![Figure 1 – Pompe \\[P1\\]](figures/fig-1.png) <!-- fig 1 -->\n\n![Figure 2 – Vanne]");
    expect(md).toContain(
      "![](figures/fig-f4.png) <!-- fig f4 -->\n\n![Figure 6 – Avec image](figures/fig-6.png) <!-- fig 6 -->\n\nSéparateur.",
    );
    expect(md).toContain("![Texte alternatif](figures/fig-f3.png) <!-- fig f3 -->");
    expect(md).toContain("Figure 8 – Récupérable\n\n![Figure 8 – Récupérable](figures/fig-8.png) <!-- fig 8 -->");
    expect(md).toContain("Figure 9 – Introuvable <!-- fig 9 -->");
    expect(md).toContain("Légende en fin de paragraphe <!-- fig 10 -->");
    expect(md).toContain("Figure 11 ........ 12\n");
    expect(md).toContain(
      "- Point un\n  - Sous-point\n- ![Figure 12 – En liste](figures/fig-12.png) <!-- fig 12 -->\n- Figure 12 – En liste\n- Figure 13 – Orpheline en liste <!-- fig 13 -->",
    );
    expect(md).toContain("### Titre illustré <!-- § titre-illustre -->\n\n![](figures/fig-f9.png) <!-- fig f9 -->");
    expect(md).toContain("| ![Figure 14 – Dans un tableau](figures/fig-14.png) <!-- fig 14 --> |  |");
  });

  it("says single drawings in the singular and takes title and date from the document properties", async () => {
    const body = [
      `<w:p><w:r><w:commentReference w:id="0"/></w:r>${run("ab")}</w:p>`,
      `<w:p><w:r><w:pict><v:shape/></w:pict></w:r></w:p>`,
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><c:chart/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      `<w:p><w:r><w:object><v:shape><v:imagedata/></v:shape></w:object></w:r></w:p>`,
      img("rEmf"),
      p("Figure 3 – Sans image"),
    ].join("");
    const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z"><dc:title>Titre des propriétés</dc:title><dcterms:modified xsi:type="dcterms:W3CDTF">2025-07-08T10:00:00Z</dcterms:modified></cp:coreProperties>`;
    const comments = `<w:comments ${W}><w:comment w:id="0"><w:p>${run("un")}</w:p></w:comment></w:comments>`;
    const c = await convertDocx(
      docx({ body, core, comments, media: { rEmf: { file: "g.emf", data: new Uint8Array([1]) } } }),
      { code: "S" },
    );
    expect(c.meta).toEqual({ title: "Titre des propriétés", date: "2025-07-08" });
    expect(c.md.startsWith("# S — Titre des propriétés\n")).toBe(true);
    expect(c.warnings).toEqual([
      "1 Word comment was dropped",
      "1 shape drawn in Word: the drawing is lost, only text labels can survive",
      "1 chart: not converted (no picture)",
      "1 embedded object: only their preview picture survives",
      "1 Windows metafile picture kept as is, not rendered to PNG: figure 3 (.emf)",
    ]);
  });

  it("asks for the PDF when a caption has no picture and none was given, and has no title without text", async () => {
    const c = await convertDocx(docx({ body: p("Figure 5 – Seule") }), { code: "N" });
    expect(c.warnings).toEqual([
      "Figure 5: caption without a picture in the .docx (drawn shape, table or pasted text) — add the .pdf to recover them",
    ]);
    const empty = await convertDocx(docx({ body: p("ab") }), { code: "E" });
    expect(empty.meta).toEqual({ title: "", date: "" });
    expect(empty.md.startsWith("# E — E\n")).toBe(true);
  });
});
