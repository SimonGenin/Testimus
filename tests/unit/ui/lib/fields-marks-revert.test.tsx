// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setProject } from "../../../../src/ui/api.ts";
import { useApp } from "../../../../src/ui/lib/app.ts";
import { DEFAULT_LAYOUT, fieldViews, parseSourceRef, sourceLabel } from "../../../../src/ui/lib/fields.ts";
import { addedSteps } from "../../../../src/ui/lib/marks.ts";
import { editedAfterRun } from "../../../../src/ui/lib/revert.ts";
import { fakeNet } from "../../cov-uishell-helpers.tsx";
import { layoutOf } from "../../layout-helpers.ts";
import { noDesktop } from "../../ui-desktop-helpers.tsx";

beforeEach(() => fakeNet());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("fields, marks, revert, app context", () => {
  it("orders the step fields, adding the step's own and showing hidden ones that hold text", () => {
    const x = layoutOf(DEFAULT_LAYOUT.fields, { order: ["Expected Result", "Gone"], hidden: ["Data"] });
    const folded = layoutOf(DEFAULT_LAYOUT.fields, { collapsed: ["Data"] });
    expect(fieldViews(folded).find((v) => v.name === "Data")).toEqual({ name: "Data", collapsed: true });
    expect(fieldViews(x).map((v) => v.name)).toEqual(["Expected Result", "Action"]);
    const step = { fields: { Data: "  x ", Exigence: "REQ-1" }, sources: [], images: [] };
    expect(fieldViews(x, step)).toEqual([
      { name: "Expected Result", collapsed: false },
      { name: "Action", collapsed: false },
      { name: "Data", collapsed: false },
      { name: "Exigence", collapsed: false },
    ]);
  });

  it("labels sources", () => {
    expect(sourceLabel({ docId: "D", anchor: "fig:3" })).toBe("D Figure 3");
    expect(sourceLabel({ docId: "D", anchor: "§1.2" })).toBe("D §1.2");
    expect(parseSourceRef('D#§1 "a quote"')).toEqual({ docId: "D", anchor: "§1", quote: "a quote" });
    expect(parseSourceRef("D#§1")).toEqual({ docId: "D", anchor: "§1", quote: "" });
    expect(parseSourceRef("no anchor")).toBeNull();
  });

  it("marks added steps only with a known before-count", () => {
    expect([...addedSteps([1, 4, 5], null)]).toEqual([]);
    expect([...addedSteps([1, 4, 5], 3)]).toEqual([4, 5]);
  });

  it("recognises the refusal of a revert after later edits", () => {
    expect(
      editedAfterRun(new ApiError("The test changed after the Claude run", undefined, 409, "edited-after-run")),
    ).toBe(true);
    expect(editedAfterRun(new Error("The test changed after the Claude run"))).toBe(false);
    expect(editedAfterRun("other")).toBe(false);
  });

  it("refuses useApp outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useApp())).toThrow("useApp outside AppContext");
  });
});
