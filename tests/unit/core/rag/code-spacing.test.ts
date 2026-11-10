import { describe, expect, it } from "vitest";
import { ftsOf, queryTerms, spacings } from "../../../../src/core/rag/search/lexical.ts";
import { call, fixtureCopy } from "../registry.ts";

describe("a code said « S 12 » and written « S12 »", () => {
  it("each form brings the other, for the shape of an equipment code only", () => {
    expect(spacings("S12")).toEqual(["S 12"]);
    expect(spacings("S 12")).toEqual(["S12"]);
    expect(spacings("TK 3")).toEqual(["TK3"]);
    expect(spacings("sectionneur")).toEqual([]);
    expect(spacings("2026")).toEqual([]);
    expect(spacings("REQ-EXP-012")).toEqual([]);
  });

  it("the search by words looks for both", () => {
    expect(queryTerms("S12").exact).toEqual([["s", "12"], ["s12"]]);
    const said = queryTerms("le sectionneur S 12").exact;
    expect(said).toContainEqual(["s12"]);
    expect(said).toContainEqual(["sectionneur"]);
    expect(ftsOf(queryTerms("S12"))).toContain('"s 12"');
    expect(ftsOf(queryTerms("S12"))).toContain('"s12"');
  });

  it("every mention of « S 12 » finds the passages that write S12", async () => {
    const P = fixtureCopy("code-spacing");
    const written = await call<{ total: number }>("rag.mentions", { term: "S12" }, P);
    const said = await call<{ total: number }>("rag.mentions", { term: "S 12" }, P);
    expect(written.total).toBeGreaterThan(0);
    expect(said.total).toBe(written.total);
  });
});
