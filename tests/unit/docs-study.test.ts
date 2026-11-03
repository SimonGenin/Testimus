import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpAccess } from "../../src/core/claude/run.ts";
import { conversionOf, parseConversion, sameConversion } from "../../src/core/claude/study.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../src/core/env.ts";
import { DEFAULT_SETTINGS, readJson, writeSettings } from "../../src/core/lib/project.ts";
import { convertPdf } from "../../src/core/rag/convert-pdf.ts";
import { hintsOf, inspectDocx, inspectPdf } from "../../src/core/rag/inspect.ts";
import type { DocJson } from "../../src/core/types.ts";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { taggedPdf } from "../fixtures/pdf/tagged.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const NUMBERS = [
  { number: "1", title: "Generalites" },
  { number: "1.1", title: "Objet" },
  { number: "1.2", title: "Exigences" },
];
const real = env.spawnClaude;
let root: string;
let dir: string;
let prompts: string[];

function scanPdf(): Uint8Array {
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
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

// ponytail: the faked Claude answers the study and the check from the prompt's first words, like the real one
function claude(answers: { study?: string; check?: string }) {
  env.spawnClaude = async (s: ClaudeSpawn): Promise<ClaudeOut> => {
    prompts.push(s.stdin);
    const text = s.stdin.startsWith("Testimus study") ? (answers.study ?? "") : (answers.check ?? "No difference.");
    const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 5 });
    s.onLine?.(l);
    return { code: 0, stdout: `${l}\n`, stderr: "" };
  };
}
const block = (o: unknown) => ["```conversion", JSON.stringify(o), "```"].join("\n");

function original(name: string, data: Uint8Array): string {
  const file = join(root, "client", name);
  writeFileSync(file, data);
  return file;
}

const doc = (id: string) => readJson<DocJson>(join(dir, "docs", id, "doc.json"), {} as DocJson);
const md = (id: string) => readFileSync(join(dir, "docs", id, "doc.md"), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-study-"));
  dir = join(root, "project");
  cpSync(FIXTURE, dir, { recursive: true });
  mkdirSync(join(root, "client"));
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  prompts = [];
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(root, { recursive: true, force: true });
});

describe("the inspection of an original", () => {
  it("profiles a tagged PDF whose heading numbers are only drawn, and says nothing gives them back", async () => {
    const p = await inspectPdf(taggedPdf());
    expect(p).toMatchObject({
      pages: 3,
      tagged: true,
      tagShare: 1,
      reader: "tagged",
      headings: 3,
      headingsNumbered: 0,
      bookmarks: 0,
      tables: 2,
      figureTags: 1,
      textless: [],
    });
    expect(p.captions[0]).toMatchObject({ style: "Figure N - …", figure: true });
    const hints = hintsOf({ pdf: p, converts: "pdf" });
    expect(hints).toContain(
      "3 headings carry no number in the PDF text; neither bookmarks nor a numbered table of contents give them back: if the pages show numbers, read them (docs_page) and give them as conversion.numbers, or attach the .docx.",
    );
  });

  it("knows numbered bookmarks give the numbers back", async () => {
    const p = await inspectPdf(taggedPdf({ outline: true }));
    expect(p).toMatchObject({ bookmarks: 3, bookmarksNumbered: 3 });
    expect(hintsOf({ pdf: p, converts: "pdf" }).join("\n")).toContain("numbered bookmarks give them back");
  });

  it("sees a page without text as a scan", async () => {
    const p = await inspectPdf(scanPdf());
    expect(p).toMatchObject({ tagged: false, tagShare: null, reader: "layout", textless: [1] });
    expect(hintsOf({ pdf: p, converts: "pdf" }).join("\n")).toMatch(/1 of 1 pages carry no text: a scan/);
  });

  it("profiles a .docx: heading styles and numbering, shapes, comments, captions, EMF beside its PDF", () => {
    const d = inspectDocx(sampleDocx());
    expect(d.headings).toBeGreaterThan(15);
    expect(d.headingsNumbered).toBe(d.headings - 2);
    expect(d.headingStyles[0]).toMatchObject({ style: "heading 1", level: 1, numbered: true });
    expect(d).toMatchObject({ tables: 1, shapes: 1, comments: 1, media: { png: 1 } });
    expect(d.captions.map((c) => c.style)).toContain("Figure N – …");
    const hints = hintsOf({
      docx: { ...d, media: { emf: 2 } },
      pdf: undefined,
      twin: "C:/client/X.pdf",
      converts: "docx",
    });
    expect(hints).toContain("2 EMF/WMF pictures: add the .pdf rendering of the same document to get them.");
    expect(hints).toContain(
      "The original's other copy sits beside it, not attached yet: C:/client/X.pdf (docs_convert pdf).",
    );
  });
});

describe("conversion options", () => {
  it("number the drawn headings from numbers read on the page, and pick the reader", async () => {
    const c = await convertPdf(taggedPdf(), { code: "SPEC", numbers: NUMBERS });
    expect(c.md).toContain("## 1 Generalites <!-- § 1 -->");
    expect(c.md).toContain("### 1.2 Exigences <!-- § 1.2 -->");
    expect(c.warnings.join("\n")).not.toMatch(/heading number/);
    const layout = await convertPdf(taggedPdf(), { code: "SPEC", reader: "layout", numbers: NUMBERS });
    expect(layout.convertedWith).not.toMatch(/tagged/);
  });

  it("read only the converter's own options from Claude's reply", () => {
    expect(
      conversionOf({
        from: "pdf",
        reader: "ocr",
        numbers: [{ number: "2.1.", title: " Objet  du  document " }, { number: "deux", title: "X" }, { title: "Y" }],
        notes: "  Figure N – …  ",
        extra: true,
      }),
    ).toEqual({ from: "pdf", numbers: [{ number: "2.1", title: "Objet du document" }], notes: "Figure N – …" });
    expect(parseConversion(`Here:\n${block({ reader: "layout" })}\nDone.`)).toEqual({ reader: "layout" });
    expect(parseConversion("```json\n{}\n```")).toBeNull();
    expect(parseConversion("No change.")).toBeNull();
    expect(sameConversion({ reader: "tagged", notes: "a" }, { reader: "tagged" })).toBe(true);
    expect(sameConversion({ reader: "tagged" }, {})).toBe(false);
  });

  it("let a study and check run see the pages and the profile, propose actions, and change nothing", async () => {
    const { allow, deny } = await mcpAccess("study");
    expect(allow).toEqual(
      expect.arrayContaining([
        "mcp__testimus__docs_inspect",
        "mcp__testimus__docs_page",
        "mcp__testimus__docs_show",
        "mcp__testimus__actions_propose",
      ]),
    );
    expect(deny).toEqual(expect.arrayContaining(["mcp__testimus__docs_convert", "mcp__testimus__docs_set"]));
  });
});

describe("docs.add and docs.convert with study", () => {
  it("convert as Claude chose before, keep the choice, and every reconversion follows it", async () => {
    claude({ study: block({ numbers: NUMBERS, notes: "Numbers drawn by Word." }) });
    const file = original("SPEC-TAGS_01.00.pdf", taggedPdf());
    const added = (await invoke(
      "docs.add",
      { file, study: true, describeFigures: false },
      { project: dir },
    )) as DocJson;
    expect(added.id).toBe("SPEC-TAGS");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toMatch(/^Testimus study of the document SPEC-TAGS/);
    expect(prompts[0]).toContain("study-document skill");
    expect(prompts[0]).toContain("3 headings carry no number in the PDF text");
    expect(prompts[1]).toMatch(/^Testimus conversion check of the document SPEC-TAGS/);
    expect(prompts[1]).toContain('Options: {"numbers":');
    expect(doc("SPEC-TAGS").conversion).toEqual({ numbers: NUMBERS, notes: "Numbers drawn by Word." });
    expect(md("SPEC-TAGS")).toContain("## 1 Generalites <!-- § 1 -->");

    prompts = [];
    await invoke("docs.convert", { id: "SPEC-TAGS", describeFigures: false }, { project: dir });
    expect(prompts).toHaveLength(0);
    expect(md("SPEC-TAGS")).toContain("### 1.1 Objet <!-- § 1.1 -->");
  });

  it("convert once more when the check finds better options, and keep its notes otherwise", async () => {
    original("SPEC-TAGS_01.00.pdf", taggedPdf());
    await invoke("docs.add", { file: join(root, "client", "SPEC-TAGS_01.00.pdf"), convert: false }, { project: dir });
    claude({ study: block({ notes: "first" }), check: `${block({ numbers: NUMBERS })}\nThe numbers are printed.` });
    const r = (await invoke(
      "docs.convert",
      { id: "SPEC-TAGS", study: true, describeFigures: false },
      { project: dir },
    )) as DocJson;
    expect(prompts).toHaveLength(2);
    expect(r.conversion).toEqual({ numbers: NUMBERS });
    expect(md("SPEC-TAGS")).toContain("## 1 Generalites <!-- § 1 -->");

    prompts = [];
    claude({ study: block({ numbers: NUMBERS }), check: block({ numbers: NUMBERS, notes: "Looks right." }) });
    await invoke("docs.convert", { id: "SPEC-TAGS", study: true, describeFigures: false }, { project: dir });
    expect(prompts).toHaveLength(2);
    expect(doc("SPEC-TAGS").conversion).toEqual({ numbers: NUMBERS, notes: "Looks right." });
  });

  it("take options from the team, clear them with {}, and never fail on a Claude that answers nothing", async () => {
    const file = original("SPEC-TAGS_01.00.pdf", taggedPdf());
    await invoke("docs.add", { file, conversion: { reader: "layout" }, describeFigures: false }, { project: dir });
    expect(doc("SPEC-TAGS").converted?.with).not.toMatch(/tagged/);
    await invoke("docs.convert", { id: "SPEC-TAGS", conversion: {}, describeFigures: false }, { project: dir });
    expect(doc("SPEC-TAGS").conversion).toBeUndefined();
    expect(doc("SPEC-TAGS").converted?.with).toMatch(/tagged/);
    claude({ study: "I could not open the pages.", check: "Nothing to say." });
    const r = (await invoke(
      "docs.convert",
      { id: "SPEC-TAGS", study: true, describeFigures: false },
      { project: dir },
    )) as DocJson;
    expect(r.conversion).toBeUndefined();
    expect(prompts).toHaveLength(2);
  });

  it("skip Claude for a document with no PDF to look at", async () => {
    claude({});
    const file = original("SPEC-WORD_01.00.docx", sampleDocx());
    const r = (await invoke("docs.add", { file, study: true, describeFigures: false }, { project: dir })) as DocJson;
    expect(prompts).toHaveLength(0);
    expect(r.converted?.with).toMatch(/^mammoth/);
  });

  it("attach the .docx of a document added from its .pdf: it becomes the source", async () => {
    const pdf = original("SPEC-TAGS_01.00.pdf", taggedPdf());
    await invoke("docs.add", { file: pdf, describeFigures: false }, { project: dir });
    const docx = join(root, "SPEC-TAGS_01.00.docx");
    writeFileSync(docx, sampleDocx());
    const r = (await invoke(
      "docs.convert",
      { id: "SPEC-TAGS", docx, describeFigures: false },
      { project: dir },
    )) as DocJson;
    expect(r.source.file).toBe("source.docx");
    expect(r.converted?.with).toMatch(/^mammoth/);
    expect(existsSync(join(dir, "docs", "SPEC-TAGS", "source.pdf"))).toBe(true);
    await invoke(
      "docs.convert",
      { id: "SPEC-TAGS", conversion: { from: "pdf" }, describeFigures: false },
      { project: dir },
    );
    expect(doc("SPEC-TAGS").converted?.with).toMatch(/tagged PDF/);
  });
});

describe("docs.inspect and docs.page", () => {
  it("inspect an added document and the copy left beside its original", async () => {
    const pdf = original("SPEC-TAGS_01.00.pdf", taggedPdf());
    writeFileSync(join(root, "client", "SPEC-TAGS_01.00.docx"), sampleDocx());
    await invoke("docs.add", { file: pdf, convert: false }, { project: dir });
    const twin = join(root, "client", "SPEC-TAGS_01.00.docx");
    expect(existsSync(join(dir, "docs", "SPEC-TAGS", "source.docx"))).toBe(true);
    const r = (await invoke("docs.inspect", { id: "SPEC-TAGS" }, { project: dir })) as {
      files: Record<string, string>;
      converts: string;
      twin: string | null;
      pdf?: unknown;
      docx?: unknown;
    };
    expect(r.files).toEqual({ docx: "docs/SPEC-TAGS/source.docx", pdf: "docs/SPEC-TAGS/source.pdf" });
    expect(r.converts).toBe("docx");
    expect(r.twin).toBeNull();
    expect(r.pdf).toBeDefined();
    const f = (await invoke("docs.inspect", { file: pdf }, { project: dir })) as typeof r;
    expect(f.files).toEqual({ pdf, docx: twin });
    expect(f.converts).toBe("docx");
  });

  it("draw a page or a part of it as a PNG under .testimus/pages", async () => {
    const pdf = original("SPEC-TAGS_01.00.pdf", taggedPdf());
    await invoke("docs.add", { file: pdf, convert: false }, { project: dir });
    const r = (await invoke("docs.page", { id: "SPEC-TAGS", page: 1 }, { project: dir })) as {
      file: string;
      pages: number;
      width: number;
      height: number;
    };
    expect(r.file).toBe(join(dir, ".testimus", "pages", "SPEC-TAGS", "p1.png"));
    expect([...readFileSync(r.file).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(r.pages).toBe(3);
    expect(Math.round(r.width / 10)).toBe(160);
    const part = (await invoke(
      "docs.page",
      { id: "SPEC-TAGS", page: 1, region: [0, 0, 0.5, 0.25] },
      { project: dir },
    )) as { file: string; width: number; height: number };
    expect(part.file).toMatch(/p1-0-0-50-25\.png$/);
    expect(Math.round(part.width / 10)).toBe(160);
    await expect(invoke("docs.page", { id: "SPEC-TAGS", page: 9 }, { project: dir })).rejects.toThrow(
      "Page 9 is outside 1–3.",
    );
    await expect(
      invoke("docs.page", { id: "SPEC-TAGS", page: 1, region: [0.5, 0, 0.5, 1] }, { project: dir }),
    ).rejects.toThrow("The region is empty.");
  });

  it("say a .docx alone has no page to draw", async () => {
    const file = original("SPEC-WORD_01.00.docx", sampleDocx());
    await invoke("docs.add", { file, convert: false }, { project: dir });
    await expect(invoke("docs.page", { id: "SPEC-WORD", page: 1 }, { project: dir })).rejects.toThrow(
      "SPEC-WORD has no PDF copy to draw.",
    );
  });
});
