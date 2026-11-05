import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";
import { call, fixtureCopy } from "../registry.ts";

type Doc = { id: string; conversion?: unknown; converted?: { warnings: string[] } };

function client(P: string, name: string, data: Uint8Array): string {
  mkdirSync(join(P, "..", "client"), { recursive: true });
  const file = join(P, "..", "client", name);
  writeFileSync(file, data);
  return file;
}

const region = [0.1, 0.1, 0.9, 0.5];

describe("figures drawn from the PDF pages (conversion figures)", () => {
  it("give a caption without a picture the region of the page, kept for every reconversion", async () => {
    const P = fixtureCopy("crops");
    const docx = client(P, "CROP_01.01.docx", sampleDocx());
    const pdf = client(P, "CROP_01.01.pdf", taggedPdf());
    const { id } = await call<Doc>("docs.add", { file: docx, pdf, describeFigures: false }, P);
    const figures = [
      { key: "41", page: 1, region },
      { key: "99", page: 2, region },
      { key: "98", page: 40, region },
    ];
    const doc = await call<Doc>(
      "docs.convert",
      { id, conversion: { reader: "tagged", figures }, describeFigures: false },
      P,
    );
    expect(doc.conversion).toEqual({ reader: "tagged", figures });
    const md = readFileSync(join(P, "docs", id, "doc.md"), "utf8");
    expect(md).toContain("](figures/fig-41.png) <!-- fig 41 -->");
    expect(
      readFileSync(join(P, "docs", id, "figures", "fig-41.png"))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    const warnings = doc.converted?.warnings ?? [];
    expect(warnings.join("\n")).not.toMatch(/Figure 41:/);
    expect(warnings).toContain(
      "Figure 99: drawn from the PDF page, but no caption of that number lacks a picture — unused",
    );
    expect(warnings.some((w) => w.startsWith("Figure 98: page 40 of the PDF could not be drawn"))).toBe(true);

    const again = await call<Doc>("docs.convert", { id, describeFigures: false }, P);
    expect(again.conversion).toEqual({ reader: "tagged", figures });
    expect(existsSync(join(P, "docs", id, "figures", "fig-41.png"))).toBe(true);
  });

  it("say so when the document has no PDF copy to draw from", async () => {
    const P = fixtureCopy("crops-nopdf");
    const { id } = await call<Doc>(
      "docs.add",
      { file: client(P, "NOPDF_01.01.docx", sampleDocx()), describeFigures: false },
      P,
    );
    const doc = await call<Doc>(
      "docs.convert",
      { id, conversion: { figures: [{ key: "41", page: 1, region }] }, describeFigures: false },
      P,
    );
    expect(doc.converted?.warnings).toContain(
      "Figure 41: kept as a region of a PDF page, but the document has no PDF copy",
    );
    await expect(
      call("docs.convert", { id, conversion: { figures: [{ key: "4 1", page: 1, region }] } }, P),
    ).rejects.toThrow(/Invalid input for docs.convert/);
  });
});
