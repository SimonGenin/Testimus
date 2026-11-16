import { describe, expect, it } from "vitest";
import { registry } from "../../../../src/core/commands/index.ts";

// ponytail: tests never go in or out as CSV; a .csv specification (a table of alarms, of requirements) is a document,
// added and converted by the docs commands like a .docx
describe("CSV", () => {
  it("no command imports or exports tests as CSV, as in Xray Editor", () => {
    expect(registry.map((c) => c.name).filter((n) => /csv/i.test(n))).toEqual([]);
    expect(
      registry.filter((c) => !c.name.startsWith("docs.") && /\bcsv\b/i.test(c.summary)).map((c) => c.name),
    ).toEqual([]);
  });
});
