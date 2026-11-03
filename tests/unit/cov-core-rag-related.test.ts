import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refInfo, related, statementOf } from "../../src/core/rag/related.ts";

let dir = "";
const LONG = `EXI_PRE_1 ${"le texte de cette exigence est volontairement très long ".repeat(4)}`.trim();
const SPEC = [
  "# SPEC — Spécification",
  "",
  "<!-- fig 1 --> Figure 1 – Vue avant toute section",
  "",
  "<!-- req EXI_PRE_1 -->",
  LONG,
  "",
  "## 1 Général <!-- § 1 -->",
  "",
  "<!-- req EXI_G_1 -->",
  "La règle générale s'applique partout.",
  "",
  "### 1.1 Détail <!-- § 1.1 -->",
  "",
  "Le détail de la règle cite EXI_MEN_7.",
  "",
  "## 2 Matrice <!-- § 2 -->",
  "",
  "| Exigence | Section | Objet |",
  "| --- | --- | --- |",
  "| EXI_G_1 | 1.1, 5 | La règle générale |",
].join("\n");

const addDoc = (id: string, md: string, json: Record<string, unknown>) => {
  mkdirSync(join(dir, "docs", id), { recursive: true });
  writeFileSync(join(dir, "docs", id, "doc.md"), md);
  writeFileSync(join(dir, "docs", id, "doc.json"), JSON.stringify({ id, code: id, status: "validated", ...json }));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-related-"));
  writeFileSync(join(dir, "project.json"), "{}");
  addDoc("SPEC", SPEC, { title: "Spécification" });
  addDoc("AMD", "# AMD\n\n## 1 Remarque <!-- § 1 -->\n\nVoir SPEC §1 pour la règle.\n", { amends: ["SPEC"] });
  addDoc("OLD", "# OLD\n\n## 1 Ancien <!-- § 1 -->\n\nAncienne règle.\n", {});
  mkdirSync(join(dir, "requirements"));
  writeFileSync(join(dir, "requirements", "requirements.csv"), "id,doc,chapter\nEXI_CSV_9,SPEC,1\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("refInfo", () => {
  it("unknown documents, bare documents, unknown anchors and pages have no title", () => {
    expect(refInfo(dir, "NOPE#§1")).toEqual({ title: "", path: "" });
    expect(refInfo(dir, "SPEC")).toEqual({ title: "Spécification", path: "" });
    expect(refInfo(dir, "OLD")).toEqual({ title: "", path: "" });
    expect(refInfo(dir, "SPEC#§9")).toEqual({ title: "", path: "" });
    expect(refInfo(dir, "SPEC#fig:9")).toEqual({ title: "", path: "" });
    expect(refInfo(dir, "SPEC#page:1")).toEqual({ title: "", path: "" });
  });

  it("a figure and a requirement before any section have no path; a requirement without statement is its id", () => {
    expect(refInfo(dir, "SPEC#fig:1")).toEqual({ title: "Figure 1 – Vue avant toute section", path: "" });
    const pre = refInfo(dir, "SPEC#req:EXI_PRE_1");
    expect(pre.path).toBe("");
    expect(pre.title).toHaveLength(118);
    expect(pre.title.endsWith("…")).toBe(true);
    expect(refInfo(dir, "SPEC#req:EXI_NONE_1")).toEqual({ title: "EXI_NONE_1", path: "" });
  });
});

describe("related — the less common origins", () => {
  it("a bare document id: its amendments", () => {
    const r = related(dir, { ref: "SPEC" });
    expect(r.ref).toBe("SPEC");
    expect(r.neighbours.map((n) => `${n.kind} ${n.direction} ${n.ref}`)).toContain("amends in AMD");
  });

  it("a sub-section is reached by the amendment of its parent section", () => {
    const r = related(dir, { ref: "SPEC#§1.1" });
    expect(r.neighbours.filter((n) => n.kind === "amends").map((n) => n.ref)).toEqual(["AMD", "AMD#§1"]);
  });

  it("a requirement known only from requirements.csv exists through its trace", () => {
    const r = related(dir, { ref: "SPEC#req:EXI_CSV_9" });
    expect(r.statement).toBeUndefined();
    expect(r.neighbours.map((n) => `${n.kind} ${n.ref}`)).toContain("traces SPEC#§1");
    expect(() => related(dir, { ref: "SPEC#page:1" })).toThrow(/No anchor §page:1 in SPEC/);
  });

  it("a requirement only mentioned in a section exists through the mention", () => {
    const r = related(dir, { ref: "SPEC#req:EXI_MEN_7" });
    expect(r.neighbours.map((n) => `${n.kind} ${n.direction} ${n.ref}`)).toContain("mentions in SPEC#§1.1");
  });

  it("warns about a matrix trace to a sub-section and to a section the document lacks", () => {
    expect(related(dir, { ref: "SPEC#req:EXI_G_1" }).warnings).toEqual([
      "EXI_G_1: traced to SPEC#§1.1 but defined in SPEC#§1 — the matrix and the body may disagree.",
      "EXI_G_1: traced to §5 by the matrix, a section SPEC does not have (defined in SPEC#§1).",
    ]);
  });
});

describe("statementOf", () => {
  it("finds a statement, and one outside any section is headed by its doc", () => {
    expect(statementOf(dir, "EXI_G_1")).toMatchObject({ docId: "SPEC", section: "§1", path: "1" });
    expect(statementOf(dir, "EXI_PRE_1")).toMatchObject({
      docId: "SPEC",
      section: "",
      path: "",
      header: "SPEC Spécification —",
    });
    expect(statementOf(dir, "EXI_CSV_9")).toBeNull();
    expect(statementOf(dir, "EXI_NONE_1")).toBeNull();
  });
});
