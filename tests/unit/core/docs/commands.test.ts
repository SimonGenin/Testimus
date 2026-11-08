import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexFile, insertChunk, withDb } from "../../../../src/core/rag/db.ts";
import { SAMPLE_PNG, sampleDocx } from "../../../fixtures/docx/sample.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";
import { call, fixtureCopy } from "../registry.ts";

type Doc = {
  id: string;
  code: string;
  title: string;
  version: string;
  status: string;
  source: { name: string; file: string; uploaded?: boolean };
  twin?: { file: string };
  converted?: { warnings: string[]; stats?: { sections: number; figures: number } };
  indexed: string;
  citedBy: { id: string }[];
};

const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";

function client(P: string, name: string, data: Uint8Array): string {
  mkdirSync(join(P, "..", "client"), { recursive: true });
  const file = join(P, "..", "client", name);
  writeFileSync(file, data);
  return file;
}

describe("docs.list through the registry", () => {
  it("lists the fixture's documents with their status, warnings and index state", async () => {
    const P = fixtureCopy("docs-reg");
    const list = await call<Doc[]>("docs.list", {}, P);
    expect(list.map((d) => [d.id, d.version, d.status, d.indexed])).toEqual([
      [D3, "01.01", "validated", "missing"],
      [D4, "01.01", "submitted", "missing"],
    ]);
    expect(list[0].converted?.warnings).toEqual([
      "2 Word comments were dropped",
      "Figure 41 is a shape drawn in Word: only its labels survive",
    ]);
    expect(list[1].converted?.warnings).toEqual([]);
  });

  it("keeps only the documents of one status", async () => {
    const P = fixtureCopy("docs-reg");
    expect((await call<Doc[]>("docs.list", { status: "submitted" }, P)).map((d) => d.id)).toEqual([D4]);
    expect(await call("docs.list", { status: "draft" }, P)).toEqual([]);
    await expect(call("docs.list", { status: "nope" }, P)).rejects.toThrow(/Invalid input for docs.list/);
    await expect(call("docs.list", {}, null)).rejects.toThrow(/No project is open/);
  });
});

describe("docs.add and docs.convert through the registry", () => {
  it("adds a .docx with its .pdf, converted, and its output passes the schema", async () => {
    const P = fixtureCopy("docs-add");
    const docx = client(P, "SPEC_REG_01.01.docx", sampleDocx());
    const pdf = client(P, "SPEC_REG_01.01.pdf", taggedPdf({ outline: true }));
    const doc = await call<Doc>("docs.add", { file: docx, pdf, describeFigures: false }, P);
    expect(doc.id).toBe("SPEC_REG");
    expect(doc.source.file).toBe("source.docx");
    expect(doc.twin?.file).toBe("source.pdf");
    expect(doc.converted?.stats?.figures).toBeGreaterThan(0);
    expect(doc.citedBy).toEqual([]);
    expect(readFileSync(join(P, "docs", "SPEC_REG", "doc.md"), "utf8")).toContain("<!-- § 1 -->");
  });

  it("copies only, then converts on demand; both outputs pass the schema", async () => {
    const P = fixtureCopy("docs-conv");
    const file = client(P, "SPEC_LATER_01.01.docx", sampleDocx());
    const copied = await call<Doc>("docs.add", { file, convert: false }, P);
    expect(copied.converted).toBeUndefined();
    expect(existsSync(join(P, "docs", "SPEC_LATER", "doc.md"))).toBe(false);
    const done = await call<Doc>("docs.convert", { id: "SPEC_LATER", describeFigures: false }, P);
    expect(done.converted?.stats?.sections).toBeGreaterThan(0);
    expect(done.citedBy).toEqual([]);
  });

  it("adds an uploaded document (base64) as uploaded, under its own name", async () => {
    const P = fixtureCopy("docs-up");
    const dataBase64 = Buffer.from(sampleDocx()).toString("base64");
    const doc = await call<Doc>("docs.add", { name: "SPEC_UP_01.01.docx", dataBase64, convert: false }, P);
    expect(doc.source).toMatchObject({ name: "SPEC_UP_01.01.docx", uploaded: true });
  });
});

describe("docs.show, docs.set and docs.remove through the registry", () => {
  it("shows a document whole, one section, or only its facts", async () => {
    const P = fixtureCopy("docs-show");
    type Shown = { doc: Doc; md: string; toc: { anchor: string }[]; section?: string; figures: unknown[] };
    const whole = await call<Shown>("docs.show", { id: D3 }, P);
    expect(whole.toc.length).toBeGreaterThan(0);
    expect(whole.md.length).toBeGreaterThan(0);
    const part = await call<Shown>("docs.show", { id: D3, anchor: whole.toc[1].anchor }, P);
    expect(part.section).toBe(whole.toc[1].anchor);
    expect(part.md.length).toBeLessThan(whole.md.length);
    const brief = await call<Shown>("docs.show", { id: D3, brief: true }, P);
    expect(brief.md).toBe("");
    expect(brief.toc).toEqual(whole.toc);
    await expect(call("docs.show", { id: D3, anchor: "§99.99" }, P)).rejects.toThrow(/No anchor/);
  });

  it("gives a long doc.md a page at a time, a part with its own sections, and an outline that follows the file", async () => {
    const P = fixtureCopy("docs-pages");
    const heads = Array.from({ length: 900 }, (_, i) => [
      `## ${i + 1} Chapitre ${i + 1} <!-- § ${i + 1} -->`,
      "",
      `### ${i + 1}.1 Détail <!-- § ${i + 1}.1 -->`,
      "",
      "Le poste affiche l'état de l'équipement et son menu contextuel propose Propriétés.".repeat(2),
      "",
    ]);
    const md = ["# Long", "", ...heads.flat()].join("\n");
    writeFileSync(join(P, "docs", D4, "doc.md"), md);
    type Page = {
      md: string;
      next?: number;
      chars: number;
      lines: number;
      toc: { anchor: string; line: number }[];
      section?: string;
    };
    const pages: Page[] = [await call<Page>("docs.show", { id: D4 }, P)];
    while (pages[pages.length - 1].next !== undefined)
      pages.push(await call<Page>("docs.show", { id: D4, from: pages[pages.length - 1].next }, P));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.every((p) => p.md.length <= 60_000)).toBe(true);
    expect(pages.slice(0, -1).every((p) => p.md.endsWith("\n"))).toBe(true);
    expect(pages.map((p) => p.md).join("")).toBe(md);
    expect(pages[0]).toMatchObject({ chars: md.length, lines: md.split("\n").length });
    expect(pages[0].toc).toHaveLength(1800);
    expect(md.split("\n")[pages[0].toc[1799].line - 1]).toContain("<!-- § 900.1 -->");
    const part = await call<Page>("docs.show", { id: D4, anchor: "§450" }, P);
    expect(part.section).toBe("§450");
    expect(part.toc.map((t) => t.anchor)).toEqual(["§450", "§450.1"]);
    const brief = await call<Page>("docs.show", { id: D4, brief: true }, P);
    expect(brief).toMatchObject({ md: "", lines: md.split("\n").length });
    expect(brief.toc).toEqual(pages[0].toc);
    writeFileSync(join(P, "docs", D4, "doc.md"), `# Short\n\n## 1 Seul <!-- § 1 -->\n`);
    const after = await call<Page>("docs.show", { id: D4, brief: true }, P);
    expect(after).toMatchObject({ lines: 4, toc: [{ anchor: "§1", line: 3 }] });
  });

  it("sets the team's fields and context; the output passes the schema", async () => {
    const P = fixtureCopy("docs-set");
    const doc = await call<Doc & { amends?: string[] }>(
      "docs.set",
      { id: D4, status: "validated", amends: [D3], title: "Signalisation v2", context: "Lu par l'équipe." },
      P,
    );
    expect(doc).toMatchObject({ status: "validated", amends: [D3], title: "Signalisation v2" });
    expect(readFileSync(join(P, "docs", D4, "context.md"), "utf8")).toBe("Lu par l'équipe.\n");
  });

  it("removes a document: dryRun first, then for real", async () => {
    const P = fixtureCopy("docs-rm");
    await call("docs.set", { id: D4, amends: [D3] }, P);
    const bare = await call<{ passages: number }>("docs.remove", { id: D3, dryRun: true }, P);
    expect(bare.passages).toBe(0);
    withDb(indexFile(P), (db) => {
      for (const n of [1, 2])
        insertChunk(
          db,
          {
            id: `${D3}#p${n}`,
            docId: D3,
            anchor: `§${n}`,
            path: "",
            figureIds: [],
            header: "",
            text: "t",
            kind: "section",
          },
          `h${n}`,
        );
    });
    const plan = await call<{ dryRun: boolean; unlinked: string[]; passages: number }>(
      "docs.remove",
      { id: D3, dryRun: true },
      P,
    );
    expect(plan).toMatchObject({ dryRun: true, unlinked: [D4], passages: 2 });
    expect(existsSync(join(P, "docs", D3))).toBe(true);
    const done = await call<{ dryRun: boolean; unlinked: string[] }>("docs.remove", { id: D3 }, P);
    expect(done).toMatchObject({ dryRun: false, unlinked: [D4] });
    expect(existsSync(join(P, "docs", D3))).toBe(false);
  });
});

describe("docs.inspect and docs.page through the registry", () => {
  it("profiles an added document and a file not added yet", async () => {
    const P = fixtureCopy("docs-insp");
    const pdf = client(P, "TAGS_01.pdf", taggedPdf({ outline: true }));
    await call("docs.add", { file: pdf, convert: false }, P);
    const r = await call<{ id: string; converts: string; pdf?: { pages: number }; hints: string[] }>(
      "docs.inspect",
      { id: "TAGS_01" },
      P,
    );
    expect(r).toMatchObject({ id: "TAGS_01", converts: "pdf" });
    expect(r.pdf?.pages).toBe(3);
    const f = await call<{ files: { pdf?: string } }>("docs.inspect", { file: pdf }, P);
    expect(f.files.pdf).toBe(pdf);
    await expect(call("docs.inspect", {}, P)).rejects.toThrow(/either id or file/);
  });

  it("draws a page as a PNG", async () => {
    const P = fixtureCopy("docs-page");
    await call("docs.add", { file: client(P, "PAGE_01.pdf", taggedPdf()), convert: false }, P);
    const r = await call<{ file: string; pages: number; width: number }>("docs.page", { id: "PAGE_01", page: 1 }, P);
    expect(r.pages).toBe(3);
    expect(readFileSync(r.file).subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("tests.addImage and tests.storeImage through the registry", () => {
  it("embeds a picture file in a step, and stores a pasted one", async () => {
    const P = fixtureCopy("img-reg");
    writeFileSync(join(P, "shot.png"), SAMPLE_PNG);
    const id = "local-3f9a12c0";
    const added = await call<{ file: string; field: string; step: number }>(
      "tests.addImage",
      { id, step: 1, file: "shot.png" },
      P,
    );
    expect(added).toMatchObject({ step: 1, field: "Expected Result" });
    expect(readFileSync(join(P, "tests", id, "test.md"), "utf8")).toContain(added.file);
    const pasted = await call<{ file: string }>(
      "tests.storeImage",
      { id, dataBase64: Buffer.from(SAMPLE_PNG).toString("base64"), ext: "png" },
      P,
    );
    expect(existsSync(join(P, "tests", id, pasted.file))).toBe(true);
  });
});
