export const line = (size: number, y: number, s: string) => `BT /F1 ${size} Tf 72 ${y} Td (${s}) Tj ET`;

export const LAYOUT_PAGE = [
  line(18, 780, "1 Introduction"),
  line(11, 760, "Ce document decrit la traction du simulateur."),
  line(11, 746, "Il couvre les sectionneurs et les disjoncteurs."),
  line(18, 720, "1.1 Sectionneur"),
  line(11, 700, "EXI_MOP_SPF_511_A_1650 : le sectionneur est affiche."),
  "q 100 0 0 50 72 620 cm /Im1 Do Q",
  line(11, 605, "Figure 40 - Representation graphique sectionneur"),
  line(11, 580, "- premier point"),
];

export const LETTERED_PAGE = [
  line(12, 780, "S.1 \x96 LES CERCLES SPORTIFS"),
  line(12, 760, "S.1.1 -GENERALITES"),
  line(11, 740, "S.1.1.1 Un cercle sportif est une association."),
  line(11, 726, "Il est dirige par un comite."),
  line(11, 712, "S.1.1.2"),
  line(11, 698, "Les tables sont conformes, voir S.1.1.1 et S.1.1.10."),
  line(11, 684, "S.2.1 Ce numero ne suit pas la section."),
  line(11, 670, "Texte courant pour la taille du corps."),
  line(11, 656, "Encore du texte courant."),
];

function pdfOf(objects: string[]): Uint8Array {
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

// ponytail: an untagged PDF read by its layout — page one has headings by font size, a picture and its caption
export function layoutPdf(lines: string[] = LAYOUT_PAGE): Uint8Array {
  const page1 = lines.join("\n");
  const page2 = [line(11, 780, "Suite du texte sur la page deux."), line(11, 766, "Fin du document.")].join("\n");
  const pixels = "\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\xff";
  return pdfOf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 8 0 R >>",
    `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`,
  ]);
}

// ponytail: one page with only a painted rectangle — a scan as far as the converter can tell
export function textlessPdf(): Uint8Array {
  const body = "0 0 1 rg 72 72 400 600 re f";
  return pdfOf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
  ]);
}
