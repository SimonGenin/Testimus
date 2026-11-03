import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docEdges } from "../../src/core/rag/graph.ts";
import type { DocJson, Edge, EdgeKind } from "../../src/core/types.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/evidence/project/", import.meta.url));
const read = (id: string) => ({
  doc: JSON.parse(readFileSync(`${FIXTURE}docs/${id}/doc.json`, "utf8")) as DocJson,
  md: readFileSync(`${FIXTURE}docs/${id}/doc.md`, "utf8"),
});
const edgesOf = (id: string) => {
  const { doc, md } = read(id);
  return docEdges(FIXTURE, doc, md, []);
};
const of = (edges: Edge[], kind: EdgeKind) =>
  edges
    .filter((e) => e.kind === kind)
    .map((e) => `${e.from} -> ${e.to}`)
    .sort();

const A = "SPEC_A";
const a = (anchor: string) => `${A}#${anchor}`;

describe("document graph (SPEC-RAG §3.3)", () => {
  const edges = edgesOf(A);

  it("every edge is a full reference and carries its document", () => {
    for (const e of edges) {
      expect(e.docId).toBe(A);
      expect(e.from).toMatch(/^[^#]+#.+$/);
      expect(e.to).toMatch(/^[^#]+#.+$/);
    }
  });

  it("refers: § x, cf. x, voir le chapitre x in the same document; <code> §x in another", () => {
    expect(of(edges, "refers")).toEqual(
      [
        `${a("§1")} -> ${a("§2.1")}`,
        `${a("§1")} -> ${a("§3.2")}`,
        `${a("§2.2")} -> ${a("§2.1")}`,
        `${a("§2.2")} -> SPEC_B#§4.1`,
      ].sort(),
    );
  });

  it("parent and sibling from the section numbers", () => {
    expect(of(edges, "parent")).toEqual(
      [
        `${a("§1.1")} -> ${a("§1")}`,
        `${a("§2.1")} -> ${a("§2")}`,
        `${a("§2.2")} -> ${a("§2")}`,
        `${a("§3.2")} -> ${a("§3")}`,
        `${a("§6.1")} -> ${a("§6")}`,
      ].sort(),
    );
    const s = of(edges, "sibling");
    expect(s).toContain(`${a("§2.1")} -> ${a("§2.2")}`);
    expect(s).toContain(`${a("§2.2")} -> ${a("§2.1")}`);
    expect(s).toContain(`${a("§1")} -> ${a("§6")}`);
    expect(s).not.toContain(`${a("§1.1")} -> ${a("§2.1")}`);
    expect(s).toHaveLength(4 * 3 + 2);
  });

  it("shows: section → the figures marked in it", () => {
    expect(of(edges, "shows")).toEqual([`${a("§2.1")} -> ${a("fig:1")}`]);
  });

  it("amends: document level from doc.json.amends, section level when the amending text names the section", () => {
    const pa = edgesOf("PA1_SPEC_A");
    expect(of(pa, "amends")).toEqual(["PA1_SPEC_A -> SPEC_A", `PA1_SPEC_A#§commentaires-majeurs -> ${a("§2.1")}`]);
    expect(of(pa, "refers")).toEqual([]);
  });

  it("no edge for a document without structure, and the same edges twice", () => {
    expect(docEdges(FIXTURE, { id: "X", code: "X" } as DocJson, "Rien.", [])).toEqual([]);
    expect(edgesOf(A)).toEqual(edges);
  });
});
