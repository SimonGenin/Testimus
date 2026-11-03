import { describe, expect, it } from "vitest";
import { call, fixtureCopy } from "../registry.ts";

type Doc = {
  id: string;
  code: string;
  version: string;
  status: string;
  converted?: { warnings: string[] };
  indexed: string;
};

describe("docs.list through the registry", () => {
  it("lists the fixture's documents with their status, warnings and index state", async () => {
    const P = fixtureCopy("docs-reg");
    const list = await call<Doc[]>("docs.list", {}, P);
    expect(list.map((d) => [d.id, d.version, d.status, d.indexed])).toEqual([
      ["SOSIE_211_D401-1_3", "01.01", "validated", "missing"],
      ["SOSIE_211_D401-1_4", "01.01", "submitted", "missing"],
    ]);
    expect(list[0].converted?.warnings).toEqual([
      "2 Word comments were dropped",
      "Figure 41 is a shape drawn in Word: only its labels survive",
    ]);
    expect(list[1].converted?.warnings).toEqual([]);
  });

  it("keeps only the documents of one status", async () => {
    const P = fixtureCopy("docs-reg");
    expect((await call<Doc[]>("docs.list", { status: "submitted" }, P)).map((d) => d.id)).toEqual([
      "SOSIE_211_D401-1_4",
    ]);
    expect(await call("docs.list", { status: "draft" }, P)).toEqual([]);
    await expect(call("docs.list", { status: "nope" }, P)).rejects.toThrow(/Invalid input for docs.list/);
    await expect(call("docs.list", {}, null)).rejects.toThrow(/No project is open/);
  });
});
