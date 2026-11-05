import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveColumn, stepColumns } from "../../../../src/core/lib/columns.ts";
import { writeXray } from "../../../../src/core/lib/project.ts";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-columns-alias-"));
  writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "t", jiraProject: "T" }));
  writeXray(dir, {
    fields: [
      { id: "action", name: "Action", type: "text", builtin: true },
      { id: "result", name: "Expected Result", type: "text", builtin: true },
    ],
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a local column test.md would read as another field", () => {
  it("is refused: « Expected results » would melt into Expected Result on the next read", () => {
    expect(() => saveColumn(dir, { name: "Expected results", description: "x" })).toThrow("section of test.md");
    expect(() => saveColumn(dir, { name: "EXPECTED RESULTS", description: "x" })).toThrow("section of test.md");
    expect(stepColumns(dir).map((c) => c.name)).toEqual(["Action", "Expected Result"]);
  });

  it("a name no alias reads differently is still a column", () => {
    saveColumn(dir, { name: "Résultat attendu détaillé", description: "x" });
    expect(stepColumns(dir).map((c) => c.name)).toContain("Résultat attendu détaillé");
  });
});
