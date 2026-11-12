import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { loadCorpus, mechanicalFindings, scopeOf } from "../../../../src/core/lib/check.ts";
import { sectionOf, tocOf } from "../../../../src/core/lib/docs.ts";
import { parseTest } from "../../../../src/core/lib/testfile.ts";
import { writeZip } from "../../../../src/core/lib/zip.ts";
import { chunkDoc } from "../../../../src/core/rag/chunk.ts";
import { type Converted, wholeSection } from "../../../../src/core/rag/convert.ts";
import { passage } from "../../../../src/core/rag/search/passage.ts";
import type { DocJson } from "../../../../src/core/types.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ponytail: a Word file whose paragraphs are all Normal — no heading style anywhere, like a note typed without styles —
// unless one is named in headings (then in Heading 1)
function plainDocx(paragraphs: string[], headings: string[] = []): Uint8Array {
  const style = (t: string) => (headings.includes(t) ? `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` : "");
  const body = paragraphs
    .map((t) => `<w:p>${style(t)}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`)
    .join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
  };
  const enc = new TextEncoder();
  return writeZip(Object.entries(files).map(([name, data]) => ({ name, data: enc.encode(data) })));
}

const FILLER =
  "Les données de contact sont envoyées de Symplicy vers une fiche client SECIB lorsque le formulaire est validé par le client, puis la fiche est complétée avec les réponses du formulaire.";
const PARAGRAPHS = [
  "Symplicy & SECIB",
  "Intégration V1",
  "(Version 25 aout 2024)",
  "Objectifs de l'intégration",
  "L'intégration est unidirectionnelle, allant de Symplicy vers SECIB.",
  ...Array.from({ length: 24 }, (_, i) => `Règle ${i + 1}. ${FILLER}`),
];

const root = mkdtempSync(join(tmpdir(), "testimus-whole-"));
const project = join(root, "project");
mkdirSync(join(project, "docs"), { recursive: true });
writeFileSync(join(project, "project.json"), JSON.stringify({ name: "whole", language: "fr" }));
mkdirSync(join(root, "client"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const client = (name: string, data: Uint8Array) => {
  const file = join(root, "client", name);
  writeFileSync(file, data);
  return file;
};
const run = (name: string, input: Record<string, unknown>) =>
  invoke(name, { describeFigures: false, ...input }, { project }) as Promise<{ id: string }>;
const dirOf = (id: string) => join(project, "docs", id);
const docOf = (id: string): DocJson => ({ id, ...JSON.parse(readFileSync(join(dirOf(id), "doc.json"), "utf8")) });
const mdOf = (id: string) => readFileSync(join(dirOf(id), "doc.md"), "utf8");

describe("a Word file without any heading style", () => {
  it("is one section under the document's title, anchored by its slug, with a warning and stats.sections 1", async () => {
    const { id } = await run("docs.add", { file: client("SECIB.docx", plainDocx(PARAGRAPHS)) });
    const doc = docOf(id);
    const md = mdOf(id);
    expect(doc.title).toBe("Symplicy & SECIB");
    expect(md.split("\n")[0]).toBe("# Symplicy & SECIB <!-- § symplicy-secib -->");
    expect(md.match(/^#/gm)).toHaveLength(1);
    expect(tocOf(md)).toEqual([{ anchor: "§symplicy-secib", title: "Symplicy & SECIB", level: 0 }]);
    expect(doc.converted?.stats?.sections).toBe(1);
    expect(doc.converted?.warnings).toEqual([
      "No heading recognised in the document (no paragraph in a heading style): all its text is one section « Symplicy & SECIB » (§symplicy-secib). Apply Word's heading styles (Heading 1, Titre 1…) and convert again to get sections.",
    ]);
    expect(sectionOf(md, "§symplicy-secib")).toContain("Règle 24.");
  });

  it("is indexed like any section: cut in parts when long, and its passage is the body", async () => {
    const id = "SECIB";
    const parts = chunkDoc(docOf(id), mdOf(id), []).filter((c) => c.kind === "section");
    expect(parts.length).toBeGreaterThan(1);
    expect(new Set(parts.map((c) => c.anchor))).toEqual(new Set(["§symplicy-secib"]));
    expect(parts.map((c) => c.id)[0]).toBe("SECIB#§symplicy-secib~1");
    expect(parts.map((c) => c.text).join("\n")).toContain("unidirectionnelle");
    const p = passage(project, "SECIB#§symplicy-secib");
    expect(p.anchor).toBe("§symplicy-secib");
    expect(p.text).toContain("L'intégration est unidirectionnelle");
  });

  it("is the whole text when converted again: its scope holds every paragraph", async () => {
    const id = "SECIB";
    await run("docs.convert", { id });
    const md = mdOf(id);
    expect(tocOf(md).map((t) => t.anchor)).toEqual(["§symplicy-secib"]);
    expect(scopeOf(md, "§symplicy-secib")).toContain("Règle 24.");
    expect(sectionOf(md, "§symplicy-secib")).toContain("unidirectionnelle");
    expect(docOf(id).converted?.stats?.sections).toBe(1);
  });

  it("disappears when the document is converted again with real headings: a source citing it is source-missing", async () => {
    const id = "SECIB";
    const test = parseTest(
      `---\nproject: P\nsummary: S\n---\n\n## Description\n\nD\n\n## Step 1\n\n### Action\n\nOuvrir\n\n### Expected Result\n\nVu\n\n### Sources\n\n- ${id}#§symplicy-secib "L'intégration est unidirectionnelle, allant de Symplicy vers SECIB."\n`,
    ).test;
    expect(mechanicalFindings(test, loadCorpus(project))).toEqual([]);
    writeFileSync(join(dirOf(id), "source.docx"), plainDocx(PARAGRAPHS, ["Objectifs de l'intégration"]));
    await run("docs.convert", { id });
    expect(mdOf(id)).not.toContain("symplicy-secib");
    expect(tocOf(mdOf(id)).map((t) => t.anchor)).toEqual(["§objectifs-de-l-integration"]);
    expect(docOf(id).converted?.warnings.join("\n")).not.toContain("No heading recognised");
    const findings = mechanicalFindings(test, loadCorpus(project));
    expect(findings.map((f) => [f.kind, f.severity])).toEqual([["source-missing", "error"]]);
    expect(findings[0].message).toBe(
      `Step 1: ${id} has no anchor §symplicy-secib: cite an existing section, figure or page.`,
    );
  });
});

describe("a Word file with headings", () => {
  it("is converted as before: no section of its own, no warning", async () => {
    const { id } = await run("docs.add", { file: client("SPEC_HEAD_01.01.docx", sampleDocx()) });
    const md = mdOf(id);
    expect(md.split("\n")[0]).toBe("# SPEC_HEAD — Spécification fonctionnelle – Traction");
    expect(tocOf(md)[0]).toEqual({ anchor: "§1", title: "Généralités", level: 1 });
    expect(docOf(id).converted?.warnings.join("\n")).not.toContain("No heading recognised");
  });
});

describe("wholeSection", () => {
  const converted = (md: string): Converted => ({
    md,
    figures: [],
    warnings: [],
    meta: { title: "", date: "" },
    convertedWith: "test",
  });

  it("takes the title's slug, and says what to do for a PDF", () => {
    const c = wholeSection(converted("# X — Lot 3\n\nTexte.\n"), "Lot 3 — Signalisation", "pdf");
    expect(c.md).toBe("# Lot 3 — Signalisation <!-- § lot-3-signalisation -->\n\nTexte.\n");
    expect(c.warnings[0]).toBe(
      "No heading recognised in the document: all its text is one section « Lot 3 — Signalisation » (§lot-3-signalisation). Add its .docx, or a PDF whose headings are numbered or tagged, and convert again to get sections.",
    );
  });

  it("leaves a body with no text (a scan: page markers and pictures) and a body with sections as they are", () => {
    const scan = converted("# SCAN — SCAN\n\n<!-- page 1 -->\n\n![](figures/fig-p1.png) <!-- fig p1 -->\n");
    expect(wholeSection(scan, "SCAN", "pdf")).toBe(scan);
    const sections = converted("# D — T\n\nAvant.\n\n## 1 Un <!-- § 1 -->\n\nTexte.\n");
    expect(wholeSection(sections, "T", "docx")).toBe(sections);
  });
});
