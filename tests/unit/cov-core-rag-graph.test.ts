import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { docEdges } from "../../src/core/rag/graph.ts";
import type { DocJson } from "../../src/core/types.ts";

let dir = "";
const doc = (id: string, extra: Partial<DocJson> = {}) => ({ id, code: id, title: id, ...extra }) as DocJson;
const addDoc = (name: string, md: string, json: Record<string, unknown> | null) => {
  mkdirSync(join(dir, "docs", name), { recursive: true });
  writeFileSync(join(dir, "docs", name, "doc.md"), md);
  if (json) writeFileSync(join(dir, "docs", name, "doc.json"), JSON.stringify(json));
};
const kinds = (edges: { from: string; to: string; kind: string }[]) => edges.map((e) => `${e.kind} ${e.from} ${e.to}`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-graph-"));
  writeFileSync(join(dir, "project.json"), "{}");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("docEdges — the less common inputs", () => {
  const MD = "## 1 Un <!-- § 1 -->\n\nVoir OTHER §9 et OTHER §2.\n";

  it("a project without docs folder has no other document to point at", () => {
    expect(kinds(docEdges(dir, doc("SELF"), MD, []))).toEqual([]);
  });

  it("names another document by its folder when its doc.json has no id, and skips sections it lacks", () => {
    addDoc("OTHER", "## 2 Deux <!-- § 2 -->\n", null);
    addDoc("EMPTY", "", null);
    mkdirSync(join(dir, "docs", "NOMD"));
    writeFileSync(join(dir, "docs", "file.txt"), "x");
    expect(kinds(docEdges(dir, doc("SELF"), MD, []))).toEqual(["refers SELF#§1 OTHER#§2"]);
    expect(kinds(docEdges(dir, doc("SELF", { amends: ["OTHER"] }), MD, []))).toEqual([
      "amends SELF OTHER",
      "amends SELF#§1 OTHER#§2",
    ]);
  });

  it("ignores a requirements.csv without doc or chapter columns, and short rows", () => {
    mkdirSync(join(dir, "requirements"));
    writeFileSync(join(dir, "requirements", "requirements.csv"), "id,text\nEXI_A_1,x\n");
    expect(kinds(docEdges(dir, doc("SELF"), MD, []))).toEqual([]);
    writeFileSync(
      join(dir, "requirements", "requirements.csv"),
      "id,doc,chapter\nEXI_A_1,SELF,1\nEXI_A_2\n,SELF,1\nEXI_A_3,SELF\n",
    );
    expect(kinds(docEdges(dir, doc("SELF"), MD, []))).toEqual(["traces SELF#req:EXI_A_1 SELF#§1"]);
  });
});
