import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "../../../src/core/commands/index.ts";

const CORE = join(import.meta.dirname, "..", "core");

// ponytail: a ratchet like the architecture guards — it may only go down, and at 0 it blocks (GOAL-V3 N6, wave 5)
const LIMIT = 18;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.test\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
  );
}

function namesCalled(): Set<string> {
  const seen = new Set<string>();
  const call = /\b(?:invoke|call)(?:<[^>("]*>)?\(\s*"([\w]+\.[\w]+)"/g;
  for (const f of files(CORE)) for (const m of readFileSync(f, "utf8").matchAll(call)) seen.add(m[1]);
  return seen;
}

describe("every command has a unit test through the registry (GOAL-V3 N6, audit M-K2)", () => {
  it(`commands never called by invoke("…") or call("…") under tests/unit/core: at most ${LIMIT}`, () => {
    const called = namesCalled();
    const missing = registry.map((c) => c.name).filter((n) => !called.has(n));
    expect(missing.length, `${missing.length} without a registry test:\n${missing.join("\n")}`).toBeLessThanOrEqual(
      LIMIT,
    );
  });

  it("names only commands that exist", () => {
    const known = new Set<string>(registry.map((c) => c.name));
    expect([...namesCalled()].filter((n) => !known.has(n))).toEqual([]);
  });
});
