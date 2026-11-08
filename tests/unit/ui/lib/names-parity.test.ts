import { describe, expect, it } from "vitest";
import { UNTITLED_TEST as CORE_UNTITLED, testNameOf } from "../../../../src/core/lib/names.ts";
import { testName, UNTITLED_TEST } from "../../../../src/ui/lib/labels.ts";

const CASES: [{ summary?: string; key?: string } | null, string][] = [
  [{ summary: "Sectionneur avec TK", key: "LFRPS12-1398" }, "LFRPS12-1398"],
  [{ summary: "  Sectionneur avec TK  " }, "local-3f9a12c0"],
  [{ summary: "", key: "LFRPS12-1398" }, "LFRPS12-1398"],
  [{ summary: "   ", key: "LFRPS12-1398" }, "LFRPS12-1398"],
  [{ summary: "" }, "local-3f9a12c0"],
  [{}, "local-3f9a12c0"],
  [{ key: "LFRPS12-7" }, "LFRPS12-7"],
  [null, "local-3f9a12c0"],
  [null, "local-zz"],
  [null, "LFRPS12-9999"],
  [null, ""],
];

describe("the page names a test as the core does", () => {
  it("same « Untitled test »", () => {
    expect(UNTITLED_TEST).toBe(CORE_UNTITLED);
  });

  it.each(CASES)("%j, %s", (t, id) => {
    expect(testName(t, id)).toBe(testNameOf(t, id));
  });
});
