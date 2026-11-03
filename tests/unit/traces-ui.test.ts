import { describe, expect, it } from "vitest";
import type { TraceView } from "../../src/core/types.ts";
import { isRequirementField, splitIds } from "../../src/ui/lib/fields.ts";
import { exampleOf, handOff, setTraces, takeHandoff, traceOfField } from "../../src/ui/lib/traces.ts";

const view = (id: string, label: string, field: string, patterns: string[]): TraceView => ({
  id,
  label,
  field,
  patterns,
  origin: "declared",
  column: "local",
  found: 0,
  docs: 0,
});

describe("tracked ids in the UI", () => {
  it("keeps an id that holds a space whole, and splits ids written with spaces only when each word is one", () => {
    expect(splitIds("Figure 40, Figure 41")).toEqual(["Figure 40", "Figure 41"]);
    expect(splitIds("EXI_A EXI_B; UC-12")).toEqual(["EXI_A", "EXI_B", "UC-12"]);
    expect(splitIds("UC 12")).toEqual(["UC 12"]);
  });

  it("knows a tracked column by its name, and falls back to the requirement words when nothing is loaded", () => {
    setTraces(null);
    expect(isRequirementField("Exigence")).toBe(true);
    expect(isRequirementField("Figure")).toBe(false);
    setTraces([view("figure", "Figure", "Figure", [String.raw`\bFigure \d+`])]);
    expect(isRequirementField("figure ")).toBe(true);
    expect(isRequirementField("Exigence")).toBe(false);
    expect(traceOfField("FIGURE")?.id).toBe("figure");
    setTraces([]);
    expect(isRequirementField("Exigence")).toBe(false);
    setTraces(null);
  });

  it("hands the missing ids to Generate once", () => {
    expect(takeHandoff()).toEqual({});
    handOff("figure", ["Figure 40"]);
    expect(takeHandoff()).toEqual({ figure: ["Figure 40"] });
    expect(takeHandoff()).toEqual({});
  });

  it("shows an id's beginning as the placeholder", () => {
    expect(exampleOf({ label: "Exigence", patterns: [String.raw`\bEXI_[A-Z0-9_]*[A-Z0-9]`] })).toBe("EXI_…");
    expect(exampleOf({ label: "Alarme", patterns: [String.raw`\d+`] })).toBe("Alarme");
  });
});
