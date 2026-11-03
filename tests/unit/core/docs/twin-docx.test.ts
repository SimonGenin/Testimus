import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addDoc } from "../../../../src/core/lib/docs-convert.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";

function onePagePdf(): Uint8Array {
  const page = "BT /F1 11 Tf 72 760 Td (Specification fonctionnelle) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
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

describe("addDoc of a .pdf with its .docx beside it", () => {
  it("converts the .docx and keeps the .pdf for its pictures", async () => {
    const root = mkdtempSync(join(tmpdir(), "testimus-twin-"));
    const project = join(root, "project");
    mkdirSync(project);
    mkdirSync(join(root, "client"));
    writeFileSync(join(project, "project.json"), JSON.stringify({ name: "t" }));
    const pdf = join(root, "client", "SOSIE_211_D401-1_3_01.01.pdf");
    writeFileSync(pdf, onePagePdf());
    writeFileSync(join(root, "client", "SOSIE_211_D401-1_3_01.01.docx"), sampleDocx());
    const doc = await addDoc(project, { file: pdf });
    expect(doc.source.file).toBe("source.docx");
    expect(doc.source.name).toMatch(/SOSIE_211_D401-1_3_01\.01\.docx$/);
    expect(doc.converted?.with).toMatch(/^mammoth/);
    expect(existsSync(join(project, "docs", doc.id, "source.pdf"))).toBe(true);
  });
});
