import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/docs.ts";
import { normalizeAnchor, sectionOf } from "../../src/core/lib/docs.ts";
import { sha256 } from "../../src/core/lib/hash.ts";
import type { DocJson, DocRef, FigureEntry } from "../../src/core/types.ts";
import { sampleDocx } from "../fixtures/docx/sample.ts";

async function run<T = unknown>(project: string, name: string, raw: unknown): Promise<T> {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return (await c.run(quietCtx(project), c.input.parse(raw) as never)) as T;
}

let project: string;
let original: string;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "testimus-docs-"));
  project = join(root, "project");
  mkdirSync(project);
  writeFileSync(join(project, "project.json"), JSON.stringify({ name: "t", jiraProject: "T" }));
  mkdirSync(join(root, "client"));
  original = join(root, "client", "SOSIE_211_D401-1_3_01.01.docx");
  writeFileSync(original, sampleDocx());
});

describe("docs commands", () => {
  it("adds a docx: copy, doc.md, figures, doc.json, original untouched", async () => {
    const before = readFileSync(original);
    const doc = await run<DocJson>(project, "docs.add", { file: original });
    const dir = join(project, "docs", "SOSIE_211_D401-1_3");
    expect(doc).toMatchObject({
      id: "SOSIE_211_D401-1_3",
      code: "SOSIE_211_D401-1_3",
      title: "Spécification fonctionnelle – Traction",
      version: "01.01",
      date: "2026-06-12",
      kind: "spec",
      status: "draft",
      binding: "applicable",
      source: { path: original, sha256: sha256(before), file: "source.docx" },
      stats: { sections: 20, figures: 1, requirements: 3 },
    });
    expect(doc.warnings).toHaveLength(3);
    expect(readFileSync(original)).toEqual(before);
    expect(readFileSync(join(dir, "source.docx"))).toEqual(before);
    expect(JSON.parse(readFileSync(join(dir, "doc.json"), "utf8"))).toEqual(doc);
    expect(readFileSync(join(dir, "doc.md"), "utf8")).toContain("<!-- § 5.6.6 -->");
    expect(existsSync(join(dir, "figures", "fig-40.png"))).toBe(true);
    const figs = JSON.parse(readFileSync(join(dir, "figures.json"), "utf8")) as FigureEntry[];
    expect(figs).toEqual([
      {
        file: "figures/fig-40.png",
        anchor: "fig:40",
        caption: "Figure 40 – Représentation graphique sectionneur",
        description: "",
      },
    ]);
    await expect(run(project, "docs.add", { file: original })).rejects.toThrow(/already exists/);
    await expect(run(project, "docs.add", { file: join(dir, "source.docx"), id: "other" })).rejects.toThrow(
      /already a copy inside/,
    );
  });

  it("refuses what it cannot convert and leaves no folder behind", async () => {
    const txt = join(project, "..", "notes.txt");
    writeFileSync(txt, "x");
    await expect(run(project, "docs.add", { file: txt })).rejects.toThrow(/Cannot add/);
    const bad = join(project, "..", "broken_01.00.docx");
    writeFileSync(bad, "not a zip");
    await expect(run(project, "docs.add", { file: bad })).rejects.toThrow();
    expect(existsSync(join(project, "docs", "broken"))).toBe(false);
    await expect(run(project, "docs.add", { file: original, id: "../evil" })).rejects.toThrow(/Invalid document id/);
  });

  it("reconverts with the same anchors, keeping team fields and figure descriptions", async () => {
    await run(project, "docs.add", { file: original });
    const dir = join(project, "docs", "SOSIE_211_D401-1_3");
    const md1 = readFileSync(join(dir, "doc.md"), "utf8");
    await run(project, "docs.set", {
      id: "SOSIE_211_D401-1_3",
      status: "validated",
      binding: "mandatory",
      title: "Traction",
    });
    const figs = JSON.parse(readFileSync(join(dir, "figures.json"), "utf8")) as FigureEntry[];
    figs[0].description = "Un carré blanc sur la caténaire.";
    writeFileSync(join(dir, "figures.json"), JSON.stringify(figs));
    const doc = await run<DocJson>(project, "docs.convert", { id: "SOSIE_211_D401-1_3" });
    expect(doc).toMatchObject({ status: "validated", binding: "mandatory", title: "Traction", version: "01.01" });
    expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe(md1);
    const after = JSON.parse(readFileSync(join(dir, "figures.json"), "utf8")) as FigureEntry[];
    expect(after[0].description).toBe("Un carré blanc sur la caténaire.");
  });

  it("lists documents with their index freshness", async () => {
    const doc = await run<DocJson>(project, "docs.add", { file: original });
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("missing");
    mkdirSync(join(project, "index"));
    writeFileSync(join(project, "index", "state.json"), JSON.stringify({ docs: { [doc.id]: doc.source.sha256 } }));
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("fresh");
    writeFileSync(join(project, "index", "state.json"), JSON.stringify({ docs: { [doc.id]: "old" } }));
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("stale");
    expect(await run<DocRef[]>(project, "docs.list", { status: "validated" })).toEqual([]);
  });

  it("shows a document, a section, a requirement and a figure", async () => {
    await run(project, "docs.add", { file: original });
    type Show = {
      toc: { anchor: string; title: string; level: number }[];
      requirements: string[];
      md: string;
      context: string;
    };
    const all = await run<Show>(project, "docs.show", { id: "SOSIE_211_D401-1_3" });
    expect(all.toc.find((t) => t.anchor === "§5.6.6")).toEqual({
      anchor: "§5.6.6",
      title: "Sectionneur (S)",
      level: 3,
    });
    expect(all.requirements).toEqual(["EXI_MOP_SPF_511_A_1650", "EXI_MOP_SPF_511_A_1670", "EXI_MOP_SPF_511_A_1680"]);
    expect(all.context).toBe("");
    const sec = await run<Show>(project, "docs.show", { id: "SOSIE_211_D401-1_3", anchor: "§5.6.6" });
    expect(sec.md.startsWith("#### 5.6.6 Sectionneur (S)")).toBe(true);
    expect(sec.md).not.toContain("5.6.7");
    const parent = await run<Show>(project, "docs.show", { id: "SOSIE_211_D401-1_3", anchor: "5.6" });
    expect(parent.md).toContain("5.6.7 Disjoncteur");
    const req = await run<Show>(project, "docs.show", {
      id: "SOSIE_211_D401-1_3",
      anchor: "req:EXI_MOP_SPF_511_A_1670",
    });
    expect(req.md).toBe(
      "<!-- req EXI_MOP_SPF_511_A_1670 -->\nEXI_MOP_SPF_511_A_1670 : Le menu contextuel d'un sectionneur sans TK propose **Propriétés**.",
    );
    const fig = await run<Show>(project, "docs.show", {
      id: "SOSIE_211_D401-1_3",
      anchor: "SOSIE_211_D401-1_3#fig:40",
    });
    expect(fig.md).toBe("![Figure 40 – Représentation graphique sectionneur](figures/fig-40.png) <!-- fig 40 -->");
    await expect(run(project, "docs.show", { id: "SOSIE_211_D401-1_3", anchor: "§9.9" })).rejects.toThrow(/No anchor/);
    await expect(run(project, "docs.show", { id: "nope" })).rejects.toThrow(/No document nope/);
  });

  it("sets team fields and context, then removes", async () => {
    await run(project, "docs.add", { file: original });
    writeFileSync(join(project, "..", "SOSIE_211_D401-1_3_01.02.docx"), sampleDocx());
    await run(project, "docs.add", { file: join(project, "..", "SOSIE_211_D401-1_3_01.02.docx"), id: "D401-1_3_v2" });
    const old = await run<DocJson>(project, "docs.set", {
      id: "SOSIE_211_D401-1_3",
      supersededBy: "D401-1_3_v2",
      context: "Remplacé par la 01.02.",
    });
    expect(old).toMatchObject({ status: "superseded", supersededBy: "D401-1_3_v2" });
    expect(readFileSync(join(project, "docs", "SOSIE_211_D401-1_3", "context.md"), "utf8")).toBe(
      "Remplacé par la 01.02.\n",
    );
    const v2 = await run<DocJson>(project, "docs.set", { id: "D401-1_3_v2", amends: ["SOSIE_211_D401-1_3"] });
    expect(v2.amends).toEqual(["SOSIE_211_D401-1_3"]);
    await expect(run(project, "docs.set", { id: "D401-1_3_v2", supersededBy: "ghost" })).rejects.toThrow(
      /No document ghost/,
    );
    const cleared = await run<DocJson>(project, "docs.set", {
      id: "SOSIE_211_D401-1_3",
      supersededBy: "",
      status: "validated",
    });
    expect(cleared.supersededBy).toBeUndefined();
    expect(cleared.status).toBe("validated");
    await run(project, "docs.remove", { id: "D401-1_3_v2" });
    expect(existsSync(join(project, "docs", "D401-1_3_v2"))).toBe(false);
    expect((await run<DocRef[]>(project, "docs.list", {})).map((d) => d.id)).toEqual(["SOSIE_211_D401-1_3"]);
  });

  it("reads the fixture project's documents", async () => {
    const copy = join(mkdtempSync(join(tmpdir(), "testimus-fixture-")), "p");
    cpSync(join("tests", "fixtures", "project"), copy, { recursive: true });
    const list = await run<DocRef[]>(copy, "docs.list", {});
    expect(list.map((d) => [d.id, d.status, d.indexed])).toEqual([
      ["SOSIE_211_D401-1_3", "validated", "missing"],
      ["SOSIE_211_D401-1_4", "submitted", "missing"],
    ]);
    const s = await run<{ md: string; context: string }>(copy, "docs.show", {
      id: "SOSIE_211_D401-1_3",
      anchor: "§5.6.6",
    });
    expect(s.md).toContain("EXI_MOP_SPF_511_A_1680");
    expect(s.md).not.toContain("5.6.7");
    expect(s.context).toMatch(/ligne 92/);
  });
});

describe("anchors", () => {
  it("normalizes the anchor spellings sources use", () => {
    expect(normalizeAnchor("§5.6.6")).toEqual({ kind: "§", id: "5.6.6" });
    expect(normalizeAnchor("5.6.6")).toEqual({ kind: "§", id: "5.6.6" });
    expect(normalizeAnchor("DOC#req:EXI_A_1")).toEqual({ kind: "req", id: "EXI_A_1" });
    expect(normalizeAnchor("EXI_A_1")).toEqual({ kind: "req", id: "EXI_A_1" });
    expect(normalizeAnchor("fig 40")).toEqual({ kind: "fig", id: "40" });
    expect(normalizeAnchor("page:3")).toEqual({ kind: "page", id: "3" });
  });

  it("cuts a page out of a PDF conversion", () => {
    const md = "# T\n\n<!-- page 1 -->\n\nun\n\n<!-- page 2 -->\n\ndeux\n";
    expect(sectionOf(md, "page:1")).toBe("<!-- page 1 -->\n\nun");
  });
});
