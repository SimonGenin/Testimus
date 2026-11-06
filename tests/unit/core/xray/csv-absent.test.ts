import { describe, expect, it } from "vitest";
import { registry } from "../../../../src/core/commands/index.ts";

describe("CSV", () => {
  it("no command imports or exports tests as CSV, as in Xray Editor", () => {
    expect(registry.map((c) => c.name).filter((n) => /csv/i.test(n))).toEqual([]);
    expect(registry.filter((c) => /\bcsv\b/i.test(c.summary)).map((c) => c.name)).toEqual([]);
  });
});
