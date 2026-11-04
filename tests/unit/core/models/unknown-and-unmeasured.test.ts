import { describe, expect, it } from "vitest";
import { needEntry } from "../../../../src/core/lib/models-install.ts";
import { suggestPack } from "../../../../src/core/lib/models-packs.ts";

describe("a model the catalog does not have", () => {
  it("is refused with where the catalog ids are listed", () => {
    expect(() => needEntry("no-such-model")).toThrow("Unknown model no-such-model.");
  });
});

describe("the pack suggested for a machine", () => {
  it("is the light one when the machine could not be measured, or its memory is unknown", () => {
    expect(suggestPack(null)).toBe("light");
    expect(suggestPack({ ramTotalMB: 0 } as Parameters<typeof suggestPack>[0])).toBe("light");
  });
});
