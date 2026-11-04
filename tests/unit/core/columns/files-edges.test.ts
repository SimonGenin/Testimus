import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readColumns, stepColumns, storeXray, writeColumns } from "../../../../src/core/lib/columns.ts";
import { readXray, writeXray } from "../../../../src/core/lib/project.ts";
import type { XrayField } from "../../../../src/core/types.ts";

let dir = "";
const BUILTIN: XrayField[] = [
  { id: "action", name: "Action", type: "text", builtin: true },
  { id: "result", name: "Expected Result", type: "text", builtin: true },
];
const exigence: XrayField = { id: "cf1", name: "Exigence", type: "text", builtin: false };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-columns-edges-"));
  writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t", jiraProject: "T" }));
  writeXray(dir, { fields: [...BUILTIN, exigence] });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const names = () => stepColumns(dir).map((c) => c.name);

describe("columns.json read as it is", () => {
  it("a columns.json that is not a list counts as no entry: the columns are Xray's", () => {
    writeFileSync(join(dir, "columns.json"), JSON.stringify({ Exigence: "x" }));
    expect(readColumns(dir)).toEqual([]);
    expect(names()).toEqual(["Action", "Expected Result", "Exigence"]);
  });

  it("two entries for one Xray field, or two local columns of the same name, show once", () => {
    writeColumns(dir, [
      { name: "Exigence", id: "cf1", description: "first", mode: "open" },
      { name: "exigence", description: "second", mode: "open" },
      { name: "Remarque", description: "mine", mode: "open" },
      { name: "remarque", description: "again", mode: "open" },
    ]);
    const cols = stepColumns(dir);
    expect(cols.filter((c) => c.name.toLowerCase() === "exigence")).toHaveLength(1);
    expect(cols.find((c) => c.name === "Exigence")?.description).toBe("first");
    expect(cols.filter((c) => c.name.toLowerCase() === "remarque").map((c) => c.description)).toEqual(["mine"]);
  });
});

describe("Xray's step fields read again", () => {
  it("writes xray.json, and leaves columns.json alone when no column follows a change", () => {
    const x = storeXray(dir, [...BUILTIN, exigence], "2026-11-04T10:00:00Z");
    expect(x.fetchedAt).toBe("2026-11-04T10:00:00Z");
    expect(readXray(dir).fetchedAt).toBe("2026-11-04T10:00:00Z");
    expect(existsSync(join(dir, "columns.json"))).toBe(false);
  });

  it("a field renamed in Xray carries its column's description to the new name in columns.json", () => {
    writeColumns(dir, [{ name: "Exigence", id: "cf1", description: "The requirement the step proves", mode: "open" }]);
    storeXray(dir, [...BUILTIN, { ...exigence, name: "Requirement" }], "2026-11-04T11:00:00Z");
    const saved = JSON.parse(readFileSync(join(dir, "columns.json"), "utf8"));
    expect(saved).toEqual([
      { name: "Requirement", id: "cf1", description: "The requirement the step proves", mode: "open" },
    ]);
    expect(stepColumns(dir).find((c) => c.id === "cf1")?.name).toBe("Requirement");
  });
});
