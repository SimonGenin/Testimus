import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refInfo, related } from "../../src/core/rag/related.ts";

let dir = "";
const SPEC = [
  "# SPEC — Spécification",
  "",
  "<!-- fig 1 --> Figure 1 – Vue avant toute section",
  "",
  "## 1 Général <!-- § 1 -->",
  "",
  "La règle générale s'applique partout.",
  "",
  "### 1.1 Détail <!-- § 1.1 -->",
  "",
  "Le détail de la règle.",
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

  it("a figure before any section has no path; a requirement anchor is no anchor", () => {
    expect(refInfo(dir, "SPEC#fig:1")).toEqual({ title: "Figure 1 – Vue avant toute section", path: "" });
    expect(refInfo(dir, "SPEC#req:EXI_G_1")).toEqual({ title: "", path: "" });
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

  it("refuses a page anchor", () => {
    expect(() => related(dir, { ref: "SPEC#page:1" })).toThrow(/No anchor §page:1 in SPEC/);
  });
});
