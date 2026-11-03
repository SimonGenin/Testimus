import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type Block, type HNode, parseHtml, renderBlocks } from "../../../../src/core/rag/convert-html.ts";
import { encodePng } from "../../../../src/core/rag/convert-png.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { LETTERED_PAGE, layoutPdf, textlessPdf } from "../../../fixtures/pdf/layout.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";

// ponytail: every converter run over the fixture documents gives, byte for byte, the doc.md, figures.json, pictures
// and doc.json kept in tests/fixtures/convert-golden/ — anchors and quotable text never move with a rewrite.
// TESTIMUS_GOLDEN_OUT=<dir> writes the outputs there instead of comparing (to make or refresh the reference).
const GOLDEN = resolve(import.meta.dirname, "../../../fixtures/convert-golden");
const OUT = process.env.TESTIMUS_GOLDEN_OUT;

const root = mkdtempSync(join(tmpdir(), "testimus-golden-"));
const project = join(root, "project");
mkdirSync(join(project, "docs"), { recursive: true });
writeFileSync(join(project, "project.json"), JSON.stringify({ name: "golden", language: "fr" }));
mkdirSync(join(root, "client"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const client = (name: string, data: Uint8Array) => {
  const file = join(root, "client", name);
  writeFileSync(file, data);
  return file;
};

const run = (name: string, input: Record<string, unknown>) =>
  invoke(name, { describeFigures: false, ...input }, { project }) as Promise<{ id: string }>;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function outputs(id: string): Record<string, string> {
  const dir = join(project, "docs", id);
  const doc = JSON.parse(readFileSync(join(dir, "doc.json"), "utf8"));
  doc.source.name = "<client>";
  if (doc.converted) doc.converted.at = "<at>";
  const figs = existsSync(join(dir, "figures"))
    ? Object.fromEntries(
        readdirSync(join(dir, "figures"))
          .sort()
          .map((f) => [f, sha(readFileSync(join(dir, "figures", f)))]),
      )
    : {};
  return {
    "doc.md": readFileSync(join(dir, "doc.md"), "utf8"),
    "figures.json": readFileSync(join(dir, "figures.json"), "utf8"),
    "pictures.json": `${JSON.stringify(figs, null, 2)}\n`,
    "doc.json": `${JSON.stringify(doc, null, 2)}\n`,
  };
}

function same(name: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    if (OUT) {
      mkdirSync(join(OUT, name), { recursive: true });
      writeFileSync(join(OUT, name, file), text);
      continue;
    }
    expect(text, `${name}/${file}`).toBe(readFileSync(join(GOLDEN, name, file), "utf8"));
  }
}

const CASES: { name: string; add: () => Promise<{ id: string }> }[] = [
  { name: "docx", add: () => run("docs.add", { file: client("SPEC_DOCX_01.01.docx", sampleDocx()) }) },
  {
    name: "docx-skipped-level",
    add: () => run("docs.add", { file: client("SPEC_SKIP_01.01.docx", sampleDocx({ skippedLevel: true })) }),
  },
  {
    name: "docx-with-pdf",
    add: () =>
      run("docs.add", {
        file: client("SPEC_PAIR_02.00.docx", sampleDocx({ extraParagraph: "Paragraphe ajouté." })),
        pdf: client("SPEC_PAIR_02.00.pdf", layoutPdf()),
      }),
  },
  {
    name: "pdf-tagged-outline",
    add: () => run("docs.add", { file: client("TAG_OUT.pdf", taggedPdf({ outline: true })) }),
  },
  { name: "pdf-tagged", add: () => run("docs.add", { file: client("TAG_PLAIN.pdf", taggedPdf()) }) },
  {
    name: "pdf-tagged-numbers",
    add: async () => {
      const doc = await run("docs.add", { file: client("TAG_NUM.pdf", taggedPdf()), convert: false });
      return run("docs.convert", {
        id: doc.id,
        conversion: {
          numbers: [
            { number: "1", title: "Generalites" },
            { number: "1.1", title: "Objet" },
            { number: "1.2", title: "Exigences" },
          ],
        },
      });
    },
  },
  {
    name: "pdf-tagged-layout-reader",
    add: async () => {
      const doc = await run("docs.add", { file: client("TAG_LAY.pdf", taggedPdf({ outline: true })), convert: false });
      return run("docs.convert", { id: doc.id, conversion: { reader: "layout" } });
    },
  },
  { name: "pdf-layout", add: () => run("docs.add", { file: client("LAY_01.pdf", layoutPdf()) }) },
  { name: "pdf-lettered", add: () => run("docs.add", { file: client("ROI_01.pdf", layoutPdf(LETTERED_PAGE)) }) },
  { name: "pdf-textless", add: () => run("docs.add", { file: client("SCAN_01.pdf", textlessPdf()) }) },
];

describe("the converters give the reference outputs", () => {
  for (const c of CASES)
    it(`${c.name}: doc.md, figures.json, pictures and doc.json`, async () => {
      const doc = await c.add();
      same(c.name, outputs(doc.id));
    });

  it("a second conversion of a document gives the same files", async () => {
    const doc = await run("docs.add", { file: client("SPEC_AGAIN_01.01.docx", sampleDocx()) });
    const first = outputs(doc.id);
    await run("docs.convert", { id: doc.id });
    const again = outputs(doc.id);
    expect(again["doc.md"]).toBe(first["doc.md"]);
    expect(again["figures.json"]).toBe(first["figures.json"]);
    expect(again["pictures.json"]).toBe(first["pictures.json"]);
  });

  it("html: paragraphs, lists, tables, headings and images", () => {
    const html =
      '<p>Le <strong>sectionneur </strong>est <em>ouvert</em> &amp; fermé&nbsp;: <a href="https://x.fr">lien</a></p>' +
      "<ul><li>un<ul><li>deux</li></ul></li><li>trois</li></ul><ol><li>a</li><li>b</li></ol>" +
      '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td colspan="2"><p>x</p><p>y</p></td><td rowspan="2">z|w</td></tr>' +
      '<tr><td>1</td><td>2</td></tr></table><h3>titre</h3><p><img src="a.png" alt="cap" /></p>';
    const blocks: Block[] = renderBlocks(parseHtml(html).children, {
      image: (n: HNode) => `![${n.attrs.alt ?? ""}](${n.attrs.src})`,
      heading: (_n: HNode, level: number) => ({ kind: "heading", md: `${"#".repeat(level)} x`, text: "x" }),
    });
    same("html", { "doc.md": `${blocks.map((b) => b.md).join("\n\n")}\n` });
  });

  it("png: gray, RGB and RGBA pictures", () => {
    const pngs = {
      gray: sha(encodePng(2, 1, 1, new Uint8Array([0, 255]))),
      rgb: sha(encodePng(2, 2, 3, new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))),
      rgba: sha(encodePng(1, 1, 4, new Uint8Array([1, 2, 3, 4]))),
    };
    same("png", { "pictures.json": `${JSON.stringify(pngs, null, 2)}\n` });
  });
});
