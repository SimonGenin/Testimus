import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listDocs, readContext, readDoc, readDocMd, writeContext, writeDoc } from "../../../../src/core/lib/docs.ts";
import { addDoc, convertSource, reconvertDoc } from "../../../../src/core/lib/docs-convert.ts";
import { parseAnchor } from "../../../../src/core/rag/anchors.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";

const text = (size: number, y: number, s: string) => `BT /F1 ${size} Tf 72 ${y} Td (${s}) Tj ET`;

const SAMPLE = [
  text(18, 780, "1 Introduction"),
  text(11, 760, "Ce document decrit la traction du simulateur."),
  text(18, 720, "1.1 Sectionneur"),
  text(11, 700, "EXI_MOP_SPF_511_A_1650 : le sectionneur est affiche."),
];

function samplePdf(lines: string[] = SAMPLE): Uint8Array {
  const page = lines.join("\n");
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

let root = "";
let project = "";
const client = (name: string, data: Uint8Array | string) => {
  const file = join(root, "client", name);
  writeFileSync(file, data);
  return file;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-cov-docs-"));
  project = join(root, "project");
  mkdirSync(project);
  mkdirSync(join(root, "client"));
  writeFileSync(join(project, "project.json"), JSON.stringify({ name: "t" }));
});

describe("listDocs and the small readers", () => {
  it("an empty project has no documents, no context and no doc.md", () => {
    expect(listDocs(project)).toEqual([]);
    mkdirSync(join(project, "docs", "D1"), { recursive: true });
    mkdirSync(join(project, "docs", "_bad id"), { recursive: true });
    expect(listDocs(project)).toEqual([]);
    expect(readContext(project, "D1")).toBe("");
    expect(readDocMd(project, "D1")).toBe("");
  });

  it("writes a context with a final newline, and an empty one as is", () => {
    mkdirSync(join(project, "docs", "D1"), { recursive: true });
    writeContext(project, "D1", "glossaire");
    expect(readContext(project, "D1")).toBe("glossaire\n");
    writeContext(project, "D1", "deja\n");
    expect(readContext(project, "D1")).toBe("deja\n");
    writeContext(project, "D1", "");
    expect(readContext(project, "D1")).toBe("");
  });

  it("an anchor without a §, fig or page prefix is taken as a section name", () => {
    expect(parseAnchor("DOC#annexe-b")).toEqual({ kind: "§", id: "annexe-b" });
    expect(parseAnchor("DOC#req:EXI_A_1")).toEqual({ kind: "§", id: "req:EXI_A_1" });
  });
});

describe("convertSource", () => {
  it("converts a pdf and refuses another extension", async () => {
    const c = await convertSource(client("x.pdf", samplePdf()), { code: "X" });
    expect(c.md).toContain("Sectionneur");
    await expect(convertSource(client("x.xlsx", "t"), { code: "X" })).rejects.toThrow(/Cannot convert \.xlsx/);
    expect((await convertSource(client("x.txt", "t"), { code: "X" })).md).toBe("# X <!-- § x -->\n\nt\n");
    await expect(convertSource(client("noext", "t"), { code: "X" })).rejects.toThrow(
      /Cannot convert a file without extension/,
    );
  });
});

describe("addDoc", () => {
  it("refuses a missing file, a file without extension and a --pdf that is not a pdf", async () => {
    await expect(addDoc(project, { file: join(root, "client", "absent.docx") })).rejects.toThrow(/File not found/);
    await expect(addDoc(project, { file: client("README", "x") })).rejects.toThrow(
      /Cannot add a file without extension/,
    );
    const docx = client("DOC_A_01.00.docx", sampleDocx());
    await expect(addDoc(project, { file: docx, pdf: client("render.txt", "x") })).rejects.toThrow(
      /--pdf must be a \.pdf file/,
    );
  });

  it("refuses a --pdf that is already inside the docs folder", async () => {
    const docx = client("DOC_A_01.00.docx", sampleDocx());
    mkdirSync(join(project, "docs", "OTHER"), { recursive: true });
    const inside = join(project, "docs", "OTHER", "source.pdf");
    writeFileSync(inside, samplePdf());
    await expect(addDoc(project, { file: docx, pdf: inside })).rejects.toThrow(/already a copy inside/);
  });

  it("adds a docx with its pdf rendering, as the given kind, then reconverts it with the pdf", async () => {
    const docx = client("DOC_A_01.00.docx", sampleDocx());
    const pdf = client("DOC_A_01.00.pdf", samplePdf());
    const steps: string[] = [];
    const doc = await addDoc(project, { file: docx, pdf, kind: "amendment" as never }, undefined, (m) => steps.push(m));
    expect(doc.kind).toBe("amendment");
    expect(existsSync(join(project, "docs", doc.id, "source.pdf"))).toBe(true);
    expect(steps).toEqual(["Copying the original", "Converting docx", "Writing doc.md and figures"]);
    const again = await reconvertDoc(project, doc.id);
    expect(again.source.sha256).toBe(doc.source.sha256);
  });

  it("adds a pdf whose title falls back to the code, with the default progress", async () => {
    const doc = await addDoc(project, { file: client("DOC_P_02.00.pdf", samplePdf([text(11, 780, "ab")])) });
    expect(doc).toMatchObject({ id: "DOC_P", title: "DOC_P", source: { file: "source.pdf" } });
    expect(listDocs(project).map((d) => [d.id, d.indexed])).toEqual([["DOC_P", "missing"]]);
  });

  it("a cancelled conversion leaves no folder behind", async () => {
    const ctl = new AbortController();
    const docx = client("DOC_C_01.00.docx", sampleDocx());
    await expect(
      addDoc(project, { file: docx }, ctl.signal, (m) => {
        if (m.startsWith("Converting")) ctl.abort();
      }),
    ).rejects.toThrow(/Cancelled/);
    expect(existsSync(join(project, "docs", "DOC_C"))).toBe(false);
  });
});

describe("reconvertDoc", () => {
  it("refuses when the copy of the original is missing or unnamed", async () => {
    const doc = await addDoc(project, { file: client("DOC_R_01.00.pdf", samplePdf()) });
    rmSync(join(project, "docs", doc.id, "source.pdf"));
    await expect(reconvertDoc(project, doc.id)).rejects.toThrow(/copy of the original is missing/);
    writeDoc(project, { ...doc, source: { ...doc.source, file: "" } });
    await expect(reconvertDoc(project, doc.id)).rejects.toThrow(/copy of the original is missing/);
  });

  it("a cancelled reconversion of a docx keeps the previous doc.json", async () => {
    const doc = await addDoc(project, { file: client("DOC_D_01.00.docx", sampleDocx()) });
    const ctl = new AbortController();
    await expect(
      reconvertDoc(project, doc.id, ctl.signal, (m) => {
        if (m.startsWith("Converting")) ctl.abort();
      }),
    ).rejects.toThrow(/Cancelled/);
    expect(readDoc(project, doc.id)).toEqual(doc);
  });

  it("reconverts a pdf with the default progress, and stops when cancelled", async () => {
    const doc = await addDoc(project, { file: client("DOC_S_01.00.pdf", samplePdf()) });
    const next = await reconvertDoc(project, doc.id);
    expect(next.id).toBe(doc.id);
    const ctl = new AbortController();
    await expect(
      reconvertDoc(project, doc.id, ctl.signal, (m) => {
        if (m.startsWith("Converting")) ctl.abort();
      }),
    ).rejects.toThrow(/Cancelled/);
    expect(readDoc(project, doc.id).id).toBe(doc.id);
    expect(readFileSync(join(project, "docs", doc.id, "doc.md"), "utf8")).toContain("Sectionneur");
  });
});
