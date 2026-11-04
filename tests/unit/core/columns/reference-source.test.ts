import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { loadCorpus, mechanicalCheck, mechanicalFindings } from "../../../../src/core/lib/check.ts";
import { columnGuidance, readColumns, saveColumn, stepColumns } from "../../../../src/core/lib/columns.ts";
import { writeXray } from "../../../../src/core/lib/project.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { formatSource, parseSource, parseTest, serializeTest } from "../../../../src/core/lib/testfile.ts";
import type { Source, Step, Test, XrayJson } from "../../../../src/core/types.ts";
import { itemLinks, referencesSources, stepSources } from "../../../../src/ui/lib/fields.ts";
import { layoutOf } from "../../helpers/layout.ts";

let dir = "";
const write = (rel: string, text: string) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
};
const XRAY: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf1", name: "Exigence", type: "text", builtin: false },
  ],
};
const DOC = [
  "# Sectionneurs <!-- § 4.2 -->",
  "",
  "EXI_A_1650 : le sectionneur avec TK est représenté sur la schématique de traction.",
  "EXI_A_1670 : un sectionneur avec TK ne propose que Propriétés dans son menu.",
].join("\n");
const Q1 = "le sectionneur avec TK est représenté sur la schématique de traction";
const Q2 = "un sectionneur avec TK ne propose que Propriétés dans son menu";
const src = (quote: string, more: Partial<Source> = {}): Source => ({ docId: "SPF", anchor: "§4.2", quote, ...more });
const step = (fields: Record<string, string>, sources: Source[]): Step => ({ fields, sources, images: [] });
const testOf = (steps: Step[]) => ({ project: "T", summary: "s", steps }) as unknown as Test;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-colsrc-"));
  write("project.json", JSON.stringify({ name: "t", jiraProject: "T" }));
  writeXray(dir, XRAY);
  write("docs/SPF/doc.md", DOC);
  write("docs/SPF/doc.json", JSON.stringify({ id: "SPF", code: "SPF", title: "Spec", status: "validated" }));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a source line that backs an item of a column", () => {
  it('reads and writes @<column> "<item>" after the quote, and a column alone', () => {
    expect(parseSource(`- SPF#§4.2 "${Q1}" @Exigence "EXI_A_1650"`)).toEqual(
      src(Q1, { column: "Exigence", item: "EXI_A_1650" }),
    );
    expect(parseSource(`SPF#§4.2 "${Q1}" @Expected Result`)).toEqual(src(Q1, { column: "Expected Result" }));
    expect(parseSource(`SPF#§4.2 @Exigence "EXI_A_1650"`)).toEqual(src("", { column: "Exigence", item: "EXI_A_1650" }));
    expect(parseSource(`SPF#§4.2 "${Q1}"`)).toEqual(src(Q1));
    expect(parseSource('SPF#§4.2 "écrire à @Paul"')).toEqual(src("écrire à @Paul"));
    for (const line of [`SPF#§4.2 "${Q1}" @Exigence "EXI_A_1650"`, `SPF#§4.2 "${Q1}" @Exigence`, `SPF#§4.2 "${Q1}"`])
      expect(formatSource(parseSource(line)!)).toBe(line);
  });

  it("survives a round trip through test.md", () => {
    const md = [
      "---",
      "project: T",
      "summary: s",
      "folder: /",
      "labels: []",
      "review: draft",
      "---",
      "",
      "## Step 1",
      "",
      "### Action",
      "",
      "Ouvrir la vue.",
      "",
      "### Exigence",
      "",
      "EXI_A_1650, EXI_A_1670",
      "",
      "### Sources",
      "",
      `- SPF#§4.2 "${Q1}" @Exigence "EXI_A_1650"`,
      `- SPF#§4.2 "${Q2}" @Exigence "EXI_A_1670"`,
      "",
    ].join("\n");
    const { test, warnings } = parseTest(md, ["Action", "Exigence"]);
    expect(warnings).toEqual([]);
    expect(test.steps[0].sources.map((s) => s.item)).toEqual(["EXI_A_1650", "EXI_A_1670"]);
    expect(serializeTest(test, ["Action", "Exigence"])).toContain(`- SPF#§4.2 "${Q2}" @Exigence "EXI_A_1670"`);
  });

  it("goes through tests.edit as a source line", async () => {
    const made = (await invoke("tests.create", { summary: "s", folder: "/" }, { project: dir, wait: true })) as {
      id: string;
    };
    await invoke(
      "tests.edit",
      {
        id: made.id,
        steps: [
          { op: "add", fields: { Action: "Ouvrir", Exigence: "EXI_A_1650" } },
          { op: "remove", step: 1 },
          { op: "sources", step: 1, sources: [`SPF#§4.2 "${Q1}" @Exigence "EXI_A_1650"`] },
        ],
      },
      { project: dir, wait: true },
    );
    expect(readTest(dir, made.id).test.steps[0].sources).toEqual([src(Q1, { column: "Exigence", item: "EXI_A_1650" })]);
  });
});

describe("the Reference source option of a column", () => {
  it("is saved with the column, and a description saved alone keeps it", async () => {
    expect(stepColumns(dir).find((c) => c.name === "Exigence")?.referenceSource).toBe(false);
    await invoke("columns.save", { name: "Exigence", referenceSource: true }, { project: dir, wait: true });
    saveColumn(dir, { name: "Exigence", description: "Le code de l'exigence couverte" });
    expect(readColumns(dir).find((c) => c.name === "Exigence")).toEqual({
      name: "Exigence",
      id: "cf1",
      description: "Le code de l'exigence couverte",
      mode: "open",
      referenceSource: true,
    });
    saveColumn(dir, { name: "Exigence", referenceSource: false });
    const c = stepColumns(dir).find((x) => x.name === "Exigence");
    expect([c?.description, c?.referenceSource]).toEqual(["Le code de l'exigence couverte", false]);
  });

  it("a built-in saved with the option only keeps its default description", () => {
    saveColumn(dir, { name: "Expected Result", referenceSource: true });
    const c = stepColumns(dir).find((x) => x.name === "Expected Result");
    expect(c?.description).toMatch(/Everything the user observes/);
    expect(c?.referenceSource).toBe(true);
  });

  it("tells Claude to cite each item of the column", () => {
    saveColumn(dir, { name: "Exigence", description: "Le code de l'exigence", referenceSource: true });
    const line = columnGuidance(dir).find((l) => l.startsWith("Reference source"));
    expect(line).toContain("Exigence");
    expect(line).toContain('@Exigence "<item>"');
    saveColumn(dir, { name: "Exigence", referenceSource: false });
    expect(columnGuidance(dir).some((l) => l.startsWith("Reference source"))).toBe(false);
  });
});

describe("the check of a Reference source column", () => {
  const kinds = (steps: Step[], linked: string[]) =>
    mechanicalFindings(testOf(steps), loadCorpus(dir), linked)
      .filter((f) => f.kind === "column-unsourced" || f.kind === "item-not-found")
      .map((f) => `${f.step}:${f.kind}`);
  const base = { Action: "Ouvrir", "Expected Result": "Le sectionneur est affiché." };

  it("asks a source for a filled column, only when the option is on", () => {
    const s = step({ ...base, Exigence: "EXI_A_1650" }, [src(Q1)]);
    expect(kinds([s], ["Exigence"])).toEqual(["1:column-unsourced"]);
    expect(kinds([s], [])).toEqual([]);
    expect(kinds([step(base, [src(Q1)])], ["Exigence"])).toEqual([]);
    expect(kinds([step({ ...base, Exigence: "EXI_A_1650" }, [src(Q1, { column: "exigence" })])], ["Exigence"])).toEqual(
      [],
    );
  });

  it("reports an item the cell does not hold, whatever the option", () => {
    const s = step({ ...base, Exigence: "EXI_A_1650" }, [
      src(Q1, { column: "Exigence", item: "EXI_A_1650" }),
      src(Q2, { column: "Exigence", item: "EXI_A_1670" }),
    ]);
    expect(kinds([s], ["Exigence"])).toEqual(["1:item-not-found"]);
    expect(kinds([s], [])).toEqual(["1:item-not-found"]);
    const f = mechanicalFindings(testOf([s]), loadCorpus(dir)).find((x) => x.kind === "item-not-found");
    expect(f?.sources).toEqual(["SPF#§4.2"]);
  });

  it("mechanicalCheck reads the option from xray.json", async () => {
    const made = (await invoke("tests.create", { summary: "s", folder: "/" }, { project: dir, wait: true })) as {
      id: string;
    };
    await invoke(
      "tests.edit",
      {
        id: made.id,
        steps: [
          { op: "add", fields: { ...base, Exigence: "EXI_A_1650" } },
          { op: "remove", step: 1 },
          { op: "sources", step: 1, sources: [`SPF#§4.2 "${Q1}"`] },
        ],
      },
      { project: dir, wait: true },
    );
    const has = () => mechanicalCheck(dir, made.id).some((f) => f.kind === "column-unsourced");
    expect(has()).toBe(false);
    saveColumn(dir, { name: "Exigence", referenceSource: true });
    expect(has()).toBe(true);
  });
});

describe("item links in the editor", () => {
  const on = layoutOf(XRAY.fields, {}, [{ name: "Exigence", id: "cf1", referenceSource: true }]);
  const off = layoutOf(XRAY.fields);
  const a = src(Q1, { column: "Exigence", item: "EXI_A_1650" });
  const b = src(Q2, { column: "Exigence", item: "EXI_A_1670" });
  const c = { ...src(Q2, { column: "Exigence", item: "EXI_A_1650" }), anchor: "§4.3" };
  const plain = src(Q1);

  it("groups the sources of each item the cell holds", () => {
    const s = step({ Exigence: "EXI_A_1650,  EXI_A_1670" }, [a, b, c, plain]);
    expect(referencesSources(on, "exigence")).toBe(true);
    expect(itemLinks(on, s, "Exigence")).toEqual([
      { item: "EXI_A_1650", sources: [a, c] },
      { item: "EXI_A_1670", sources: [b] },
    ]);
    expect(stepSources(on, s, ["Action", "Exigence"])).toEqual([plain]);
  });

  it("leaves every source with the step when the option is off, the item is gone or the column is not shown", () => {
    const s = step({ Exigence: "EXI_A_1650" }, [a, b, plain]);
    expect(itemLinks(off, s, "Exigence")).toEqual([]);
    expect(stepSources(off, s, ["Exigence"])).toEqual([a, b, plain]);
    expect(stepSources(on, s, ["Exigence"])).toEqual([b, plain]);
    expect(stepSources(on, s, ["Action"])).toEqual([a, b, plain]);
    expect(itemLinks(on, step({ Exigence: "" }, [a]), "Exigence")).toEqual([]);
  });

  it("a source naming the column without an item links the whole cell", () => {
    const whole = src(Q1, { column: "Exigence" });
    expect(itemLinks(on, step({ Exigence: "EXI_A_1650" }, [whole]), "Exigence")).toEqual([
      { item: "", sources: [whole] },
    ]);
  });
});
