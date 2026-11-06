import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "../../../../src/core/commands/index.ts";

const GROUPS = new Set(["claude", "chat", "check", "gen", "review", "actions"]);
const ALSO = new Set(["docs.describeFigures"]);

type Schema = {
  description?: string;
  type?: string;
  anyOf?: Schema[];
  oneOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  additionalProperties?: Schema | boolean;
};

function undescribed(s: Schema | undefined, path: string, out: string[], depth = 0): void {
  if (!s || depth > 8) return;
  for (const alt of [...(s.anyOf ?? []), ...(s.oneOf ?? [])]) undescribed(alt, path, out, depth + 1);
  if (s.items) undescribed(s.items, `${path}[]`, out, depth + 1);
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const p = path ? `${path}.${k}` : k;
    if (!v.description && !(v.anyOf ?? v.oneOf)?.some((a) => a.description)) out.push(p);
    undescribed(v, p, out, depth + 1);
  }
  if (s.additionalProperties && typeof s.additionalProperties === "object")
    undescribed(s.additionalProperties, `${path}{}`, out, depth + 1);
}

const mine = registry.filter((c) => (GROUPS.has(c.name.split(".")[0]) || ALSO.has(c.name)) && c.name !== "gen.bench");

describe("the commands that start Claude describe every field", () => {
  it("covers the zone's commands", () => {
    expect(mine.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "claude.run",
        "chat.ask",
        "check.run",
        "gen.tests",
        "review.fix",
        "actions.triageFailed",
      ]),
    );
  });

  for (const c of mine)
    it(`${c.name}: every input and output field has a description`, () => {
      const missing: string[] = [];
      undescribed(z.toJSONSchema(c.input, { io: "input", unrepresentable: "any" }) as Schema, "in", missing);
      undescribed(z.toJSONSchema(c.output, { io: "output", unrepresentable: "any" }) as Schema, "out", missing);
      expect(missing).toEqual([]);
    });
});
