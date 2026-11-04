import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDoc, writeDoc } from "../../../../src/core/lib/docs.ts";
import { attachDocx, attachPdf, twinOf } from "../../../../src/core/lib/docs-convert.ts";

const FIXTURE = resolve(import.meta.dirname, "../../../fixtures/project");
const ID = "SOSIE_211_D401-1_3";
let P = "";
let outside = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-attach-"));
  outside = mkdtempSync(join(tmpdir(), "testimus-attach-src-"));
  cpSync(FIXTURE, P, { recursive: true });
});
afterEach(() => {
  rmSync(P, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const file = (name: string, text = name) => {
  const f = join(outside, name);
  writeFileSync(f, text);
  return f;
};

const fromPdf = () => {
  const doc = readDoc(P, ID);
  writeFileSync(join(P, "docs", ID, "source.pdf"), "%PDF original");
  writeDoc(P, { ...doc, source: { name: "D401.pdf", file: "source.pdf", sha256: "x" } });
};

describe("a PDF rendering added to a document from Word", () => {
  it("is copied beside the .docx and named as its twin", () => {
    attachPdf(P, ID, file("D401.pdf", "%PDF rendering"));
    expect(readFileSync(join(P, "docs", ID, "source.pdf"), "utf8")).toBe("%PDF rendering");
    expect(readDoc(P, ID).twin?.file).toBe("source.pdf");
  });

  it("is refused when it is not a .pdf, or not there", () => {
    expect(() => attachPdf(P, ID, file("D401.docx"))).toThrow(/Not a \.pdf file/);
    expect(() => attachPdf(P, ID, join(outside, "missing.pdf"))).toThrow(/Not a \.pdf file/);
    expect(existsSync(join(P, "docs", ID, "source.pdf"))).toBe(false);
  });

  it("is refused for a document added from its .pdf, which has no .docx to complete", () => {
    fromPdf();
    expect(() => attachPdf(P, ID, file("D401.pdf"))).toThrow(
      `${ID} was added from a .pdf: it has no .docx to complete.`,
    );
  });
});

describe("a Word file added to a document from its PDF", () => {
  it("becomes the source, and the .pdf stays beside it as its twin", () => {
    fromPdf();
    const docx = file("D401.docx", "PK word");
    const next = attachDocx(P, ID, docx);
    expect(next.source).toMatchObject({ name: docx, file: "source.docx" });
    expect(next.twin?.file).toBe("source.pdf");
    expect(readDoc(P, ID).source.file).toBe("source.docx");
    expect(readFileSync(join(P, "docs", ID, "source.docx"), "utf8")).toBe("PK word");
  });

  it("is refused for a document added from Word already, and when it is not a .docx", () => {
    expect(() => attachDocx(P, ID, file("D401.docx"))).toThrow(`${ID} was added from a .docx already.`);
    fromPdf();
    expect(() => attachDocx(P, ID, file("D401.txt"))).toThrow(/Not a \.docx file/);
  });
});

describe("the other copy of an original", () => {
  it("is the file of the same name with the other extension, and none for an upload", () => {
    const docx = file("Spec.docx");
    const pdf = file("Spec.pdf");
    expect(twinOf({ name: docx, file: "source.docx", sha256: "" })).toBe(pdf);
    expect(twinOf({ name: pdf, file: "source.pdf", sha256: "" })).toBe(docx);
    expect(twinOf({ name: docx, file: "source.docx", sha256: "", uploaded: true })).toBeNull();
    expect(twinOf({ name: join(outside, "Alone.docx"), file: "source.docx", sha256: "" })).toBeNull();
  });
});
