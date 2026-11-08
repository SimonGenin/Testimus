import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { docRunLines } from "../../../../src/core/claude/prompt.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/docs.ts";
import { isStale, recheckMechanical, recordSemantic, testsCiting } from "../../../../src/core/lib/check.ts";
import { headingAt, sectionOf } from "../../../../src/core/lib/docs.ts";
import { sha256 } from "../../../../src/core/lib/hash.ts";
import { readCheck } from "../../../../src/core/lib/store.ts";
import { parseAnchor } from "../../../../src/core/rag/anchors.ts";
import { docContent } from "../../../../src/core/rag/indexer.ts";
import type { DocJson, DocRef, FigureEntry } from "../../../../src/core/types.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { writeContextMd } from "../../helpers/context.ts";
import { markIndexedInDb } from "../../helpers/index-state.ts";

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
      source: { name: original, sha256: sha256(before), file: "source.docx" },
      converted: { stats: { sections: 21, figures: 1 } },
    });
    expect(doc.converted?.warnings).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, "doc.json"), "utf8"))).not.toHaveProperty("id");
    expect(readFileSync(original)).toEqual(before);
    expect(readFileSync(join(dir, "source.docx"))).toEqual(before);
    const { citedBy, id: _id, ...json } = doc as DocJson & { citedBy: unknown[] };
    expect(citedBy).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "doc.json"), "utf8"))).toEqual(json);
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

  it("adds a docx without converting it, lets the team fill it in, then converts it on demand", async () => {
    const doc = await run<DocJson & { citedBy: unknown[] }>(project, "docs.add", { file: original, convert: false });
    const dir = join(project, "docs", "SOSIE_211_D401-1_3");
    expect(doc).toMatchObject({
      id: "SOSIE_211_D401-1_3",
      title: "SOSIE_211_D401-1_3_01.01",
      version: "01.01",
      date: "",
      status: "draft",
      citedBy: [],
    });
    expect(doc.converted).toBeUndefined();
    expect(existsSync(join(dir, "source.docx"))).toBe(true);
    expect(existsSync(join(dir, "doc.md"))).toBe(false);
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("missing");
    expect(await run(project, "docs.show", { id: doc.id })).toMatchObject({ toc: [], md: "" });
    await run(project, "docs.set", { id: doc.id, status: "submitted", context: "Edition for the 2024 tender" });
    expect(docRunLines(project, doc.id, { note: "Only chapter 5 matters" })).toEqual([
      "",
      "What the team knows about this document:",
      "Edition for the 2024 tender",
      "",
      "Additional context from the user for this run:",
      "Only chapter 5 matters",
    ]);
    expect((await run<{ contexts: string[] }>(project, "docs.show", { id: doc.id })).contexts).toEqual([]);
    mkdirSync(join(project, "contexts", "glossary"), { recursive: true });
    writeContextMd(join(project, "contexts", "glossary"), { name: "Glossary", notes: "TK = traction" });
    await run(project, "docs.set", { id: doc.id, contexts: ["glossary", "glossary", "gone"] });
    expect(JSON.parse(readFileSync(join(dir, "doc.json"), "utf8")).contexts).toEqual(["glossary", "gone"]);
    expect((await run<{ contexts: string[] }>(project, "docs.show", { id: doc.id })).contexts).toEqual(["glossary"]);
    expect(docRunLines(project, doc.id, { contexts: ["glossary"] }).join("\n")).toMatch(
      /What the team knows about this document:\nEdition for the 2024 tender\n\nContext to read before you start[^\n]*\n- Glossary — notes: .*\/contexts\/glossary\/context\.md$/,
    );
    await run(project, "docs.set", { id: doc.id, contexts: [] });
    expect((await run<{ contexts: string[] }>(project, "docs.show", { id: doc.id })).contexts).toEqual([]);
    const converted = await run<DocJson>(project, "docs.convert", { id: doc.id, note: "Only chapter 5 matters" });
    expect(converted).toMatchObject({
      title: "Spécification fonctionnelle – Traction",
      date: "2026-06-12",
      status: "submitted",
      converted: { stats: { sections: 21, figures: 1 } },
    });
    expect(converted.converted?.at).not.toBe("");
    expect(readFileSync(join(dir, "context.md"), "utf8")).toBe("Edition for the 2024 tender\n");
    const brief = await run<{ md: string; toc: unknown[] }>(project, "docs.show", {
      id: doc.id,
      brief: true,
    });
    expect(brief).toMatchObject({ md: "" });
    expect(brief.toc).toHaveLength(21);

    await run(project, "docs.remove", { id: doc.id });
    await run(project, "docs.add", { file: original, convert: false });
    await run(project, "docs.set", { id: doc.id, title: "Traction (team title)" });
    expect(await run(project, "docs.convert", { id: doc.id })).toMatchObject({ title: "Traction (team title)" });
  });

  it("refuses what it cannot convert and leaves no folder behind", async () => {
    const xls = join(project, "..", "notes.xlsx");
    writeFileSync(xls, "x");
    await expect(run(project, "docs.add", { file: xls })).rejects.toThrow(/Cannot add/);
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
      title: "Traction",
    });
    const figs = JSON.parse(readFileSync(join(dir, "figures.json"), "utf8")) as FigureEntry[];
    figs[0].description = "Un carré blanc sur la caténaire.";
    figs[0].labels = ["DSO", "Valider"];
    figs[0].kind = "screen";
    writeFileSync(join(dir, "figures.json"), JSON.stringify(figs));
    const doc = await run<DocJson>(project, "docs.convert", { id: "SOSIE_211_D401-1_3" });
    expect(doc).toMatchObject({ status: "validated", title: "Traction", version: "01.01" });
    expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe(md1);
    const after = JSON.parse(readFileSync(join(dir, "figures.json"), "utf8")) as FigureEntry[];
    expect(after[0]).toMatchObject({
      description: "Un carré blanc sur la caténaire.",
      labels: ["DSO", "Valider"],
      kind: "screen",
    });
  });

  it("lists documents with their index freshness", async () => {
    const doc = await run<DocJson>(project, "docs.add", { file: original });
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("missing");
    const dir = join(project, "docs", doc.id);
    markIndexedInDb(project, [doc.id], { [doc.id]: docContent(dir, doc) });
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("fresh");
    writeFileSync(join(dir, "doc.md"), `${readFileSync(join(dir, "doc.md"), "utf8")}\nReconverti.\n`);
    expect((await run<DocRef[]>(project, "docs.list", {}))[0].indexed).toBe("stale");
    expect(await run<DocRef[]>(project, "docs.list", { status: "validated" })).toEqual([]);
  });

  it("shows a document, a section and a figure; ids in the text are plain text", async () => {
    await run(project, "docs.add", { file: original });
    type Show = {
      toc: { anchor: string; title: string; level: number; line: number }[];
      md: string;
      context: string;
    };
    const all = await run<Show>(project, "docs.show", { id: "SOSIE_211_D401-1_3" });
    expect(all.toc.find((t) => t.anchor === "§5.6.6")).toEqual({
      anchor: "§5.6.6",
      title: "Sectionneur (S)",
      level: 3,
      line: all.md.split("\n").findIndex((l) => l.includes("<!-- § 5.6.6 -->")) + 1,
    });
    expect(all.md.split("\n")[all.toc[0].line - 1]).toMatch(/^#+ .*<!-- § /);
    expect(all).not.toHaveProperty("requirements");
    expect(all.md).toContain("EXI_MOP_SPF_511_A_1670");
    expect(all.md).not.toContain("<!-- req ");
    expect(all.context).toBe("");
    const sec = await run<Show>(project, "docs.show", { id: "SOSIE_211_D401-1_3", anchor: "§5.6.6" });
    expect(sec.md.startsWith("#### 5.6.6 Sectionneur (S)")).toBe(true);
    expect(sec.md).not.toContain("5.6.7");
    const parent = await run<Show>(project, "docs.show", { id: "SOSIE_211_D401-1_3", anchor: "5.6" });
    expect(parent.md).toContain("5.6.7 Disjoncteur");
    await expect(
      run(project, "docs.show", { id: "SOSIE_211_D401-1_3", anchor: "req:EXI_MOP_SPF_511_A_1670" }),
    ).rejects.toThrow(/No anchor/);
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
      status: "validated",
      context: "Remplacé par la 01.02.",
    });
    expect(old).toMatchObject({ status: "validated" });
    expect(readFileSync(join(project, "docs", "SOSIE_211_D401-1_3", "context.md"), "utf8")).toBe(
      "Remplacé par la 01.02.\n",
    );
    const v2 = await run<DocJson>(project, "docs.set", { id: "D401-1_3_v2", amends: ["SOSIE_211_D401-1_3"] });
    expect(v2.amends).toEqual(["SOSIE_211_D401-1_3"]);
    await expect(run(project, "docs.set", { id: "D401-1_3_v2", amends: ["ghost"] })).rejects.toThrow(
      /No document ghost/,
    );
    await expect(run(project, "docs.set", { id: "D401-1_3_v2", status: "superseded" })).rejects.toThrow();
    await run(project, "docs.set", { id: "SOSIE_211_D401-1_3", amends: ["D401-1_3_v2"] });
    const gone = await run<{ unlinked: string[] }>(project, "docs.remove", { id: "D401-1_3_v2" });
    expect(gone.unlinked).toEqual(["SOSIE_211_D401-1_3"]);
    expect(existsSync(join(project, "docs", "D401-1_3_v2"))).toBe(false);
    const left = await run<DocRef[]>(project, "docs.list", {});
    expect(left.map((d) => d.id)).toEqual(["SOSIE_211_D401-1_3"]);
    expect(left[0]).toMatchObject({ status: "validated" });
    expect(left[0].amends).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(project, "docs", "SOSIE_211_D401-1_3", "doc.json"), "utf8")),
    ).not.toHaveProperty("indexed");
  });

  it("removing a cited document: dryRun lists the citing tests, the removal re-checks them, re-adding frees them", async () => {
    const copy = join(mkdtempSync(join(tmpdir(), "testimus-fixture-")), "p");
    cpSync(join("tests", "fixtures", "project"), copy, { recursive: true });
    const id = "SOSIE_211_D401-1_3";
    type Out = { citedBy: { id: string; review: string; steps: number }[]; dryRun: boolean; unlinked: string[] };
    const md = (t: string) => readFileSync(join(copy, "tests", t, "test.md"), "utf8");
    const before = md("LFRPS12-1420");
    const plan = await run<Out>(copy, "docs.remove", { id, dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.citedBy.map((t) => t.id)).toEqual(["LFRPS12-1398", "LFRPS12-1420", "local-3f9a12c0"]);
    expect(plan.citedBy.every((t) => t.steps > 0)).toBe(true);
    expect(existsSync(join(copy, "docs", id, "doc.md"))).toBe(true);
    recordSemantic(copy, "LFRPS12-1420", [
      { step: 1, kind: "vague-result", severity: "warning", message: "kept", sources: [] },
    ]);

    const done = await run<Out>(copy, "docs.remove", { id });
    expect(done.dryRun).toBe(false);
    expect(done.citedBy.map((t) => t.id)).toEqual(plan.citedBy.map((t) => t.id));
    expect(existsSync(join(copy, "docs", id))).toBe(false);
    expect(md("LFRPS12-1420")).toBe(before);
    const missing = (t: string) =>
      (readCheck(copy, t)?.findings ?? []).filter((f) => f.message.includes(`cites ${id}, which is not a document`));
    for (const t of done.citedBy) {
      expect(missing(t.id).length).toBeGreaterThan(0);
      expect(isStale(copy, t.id)).toBe(false);
    }
    expect(readCheck(copy, "LFRPS12-1420")?.findings.filter((f) => f.pass === "semantic")).toMatchObject([
      { message: "kept" },
    ]);
    await expect(run(copy, "docs.remove", { id, dryRun: true })).rejects.toThrow(/No document/);

    const back = await run<Out>(copy, "docs.add", { file: original, id });
    expect(back.citedBy.map((t) => t.id)).toEqual(plan.citedBy.map((t) => t.id));
    for (const t of back.citedBy) expect(missing(t.id)).toEqual([]);
  });

  it("re-checking drops semantic findings stamped for an older test.md", async () => {
    const copy = join(mkdtempSync(join(tmpdir(), "testimus-fixture-")), "p");
    cpSync(join("tests", "fixtures", "project"), copy, { recursive: true });
    recordSemantic(copy, "LFRPS12-1398", [
      { step: 1, kind: "vague-result", severity: "warning", message: "old", sources: [] },
    ]);
    const file = join(copy, "tests", "LFRPS12-1398", "test.md");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
    expect(testsCiting(copy, { id: "nope" })).toEqual([]);
    const [check] = recheckMechanical(copy, ["LFRPS12-1398"]);
    expect(check.findings.filter((f) => f.pass === "semantic")).toEqual([]);
    expect(isStale(copy, "LFRPS12-1398")).toBe(false);
  });

  it("reads the fixture project's documents", async () => {
    const copy = join(mkdtempSync(join(tmpdir(), "testimus-fixture-")), "p");
    cpSync(join("tests", "fixtures", "project"), copy, { recursive: true });
    const list = await run<DocRef[]>(copy, "docs.list", {});
    expect(list.map((d) => [d.id, d.status, d.indexed, d.source.type ?? "docx"])).toEqual([
      ["Manoeuvre_d_un_sectionneur_au_PCC", "draft", "missing", "video"],
      ["Notes_de_reunion", "draft", "missing", "docx"],
      ["RECETTE_TCO_12-10", "draft", "missing", "images"],
      ["SOSIE_211_D401-1_3", "validated", "missing", "docx"],
      ["SOSIE_211_D401-1_4", "submitted", "missing", "docx"],
    ]);
    const s = await run<{ md: string; context: string }>(copy, "docs.show", {
      id: "SOSIE_211_D401-1_3",
      anchor: "§5.6.6",
    });
    expect(s.md).toContain("EXI_MOP_SPF_511_A_1680");
    expect(s.md).not.toContain("5.6.7");
    expect(s.context).toMatch(/ligne 92/);
    const r = await run<{ section?: string }>(copy, "docs.show", {
      id: "SOSIE_211_D401-1_3",
      anchor: "fig:40",
    });
    expect(r.section).toBe("§5.6.6");
  });
});

describe("anchors", () => {
  it("normalizes the anchor spellings sources use", () => {
    expect(parseAnchor("§5.6.6")).toEqual({ kind: "§", id: "5.6.6" });
    expect(parseAnchor("5.6.6")).toEqual({ kind: "§", id: "5.6.6" });
    expect(parseAnchor("DOC#fig:40")).toEqual({ kind: "fig", id: "40" });
    expect(parseAnchor("EXI_A_1")).toEqual({ kind: "§", id: "EXI_A_1" });
    expect(parseAnchor("fig 40")).toEqual({ kind: "fig", id: "40" });
    expect(parseAnchor("page:3")).toEqual({ kind: "page", id: "3" });
  });

  it("cuts a page out of a PDF conversion", () => {
    const md = "# T\n\n<!-- page 1 -->\n\nun\n\n<!-- page 2 -->\n\ndeux\n";
    expect(sectionOf(md, "page:1")).toBe("<!-- page 1 -->\n\nun");
  });

  it("names the section whose heading holds an anchor", () => {
    const md = [
      "# 1 Un <!-- § 1 -->",
      "![E](e.png) <!-- fig 2 -->",
      "texte",
      "## 1.2 Deux <!-- § 1.2 -->",
      "![F](f.png) <!-- fig 3 -->",
    ].join("\n");
    expect(headingAt(md, "fig:2")).toBe("§1");
    expect(headingAt(md, "fig:3")).toBe("§1.2");
    expect(headingAt(md, "§1.2")).toBe("§1.2");
    expect(headingAt(md, "fig:9")).toBeNull();
    expect(headingAt("![E](e.png) <!-- fig 2 -->\ntexte", "fig:2")).toBeNull();
  });
});
