import { describe, expect, it } from "vitest";
import { normalizeAnchor, normalizeRef, parseAnchor, splitRef } from "../../../../src/core/rag/anchors.ts";

describe("anchors — the one reading of docId#anchor", () => {
  it("reads sections, figures and pages however they are written", () => {
    expect(parseAnchor("5.6.6")).toEqual({ kind: "§", id: "5.6.6" });
    expect(parseAnchor(" § 5.6.6 ")).toEqual({ kind: "§", id: "5.6.6" });
    expect(parseAnchor("§A.2")).toEqual({ kind: "§", id: "A.2" });
    expect(parseAnchor("fig:40")).toEqual({ kind: "fig", id: "40" });
    expect(parseAnchor("fig 40")).toEqual({ kind: "fig", id: "40" });
    expect(parseAnchor("FIG: 40")).toEqual({ kind: "fig", id: "40" });
    expect(parseAnchor("page 3")).toEqual({ kind: "page", id: "3" });
    expect(parseAnchor("page:3")).toEqual({ kind: "page", id: "3" });
  });

  it("drops the docId and a chunk part", () => {
    expect(parseAnchor("DOC#§5.6.6~2")).toEqual({ kind: "§", id: "5.6.6" });
    expect(normalizeAnchor("DOC#fig 40")).toBe("fig:40");
  });

  it("does not take a word that only starts like a kind for that kind", () => {
    expect(normalizeAnchor("figure")).toBe("§figure");
    expect(normalizeAnchor("pages")).toBe("§pages");
  });

  it("normalizes a reference, and leaves a bare docId as it is", () => {
    expect(normalizeRef(" D3 # § 5.6.6 ")).toBe("D3#§5.6.6");
    expect(normalizeRef("D3#fig 40")).toBe("D3#fig:40");
    expect(normalizeRef("D3#§5.6.6~3")).toBe("D3#§5.6.6");
    expect(normalizeRef(" D3 ")).toBe("D3");
    expect(splitRef("D3")).toEqual({ docId: "D3", anchor: null });
    expect(splitRef("D3#§1")).toEqual({ docId: "D3", anchor: "§1" });
  });
});
