import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proposeGenActions } from "../../../../src/core/claude/gen-actions.ts";
import { listActions, stampOf } from "../../../../src/core/lib/actions.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const SKIPPED = [{ item: "a", category: "No source", why: "w" }];
const BY = { runId: "r1", model: "opus", effort: "high" as const };
let dir: string;

const ledger = (generation: string, o: Record<string, unknown>) => {
  mkdirSync(join(dir, ".testimus", "gen"), { recursive: true });
  writeFileSync(
    join(dir, ".testimus", "gen", `${generation}.json`),
    JSON.stringify({ consulted: [], searched: [], input: { request: "r" }, ...o }),
  );
};

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-gen-actions-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
});

afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("the actions the core proposes after a generation", () => {
  it("a generation that wrote no test still leaves its « Write the skipped » action, and nothing fails", () => {
    ledger("job-x", { tests: [], skipped: SKIPPED });
    const logs: string[] = [];
    proposeGenActions(dir, "job-x", { tests: [], skipped: SKIPPED, by: BY }, (_, m) => logs.push(m));
    expect(logs).toEqual([]);
    expect(listActions(dir).map((a) => a.title)).toEqual(["Write the 1 test skipped for « No source »"]);
  });

  it("an action that cannot be proposed is a warning, never a throw", () => {
    const logs: string[] = [];
    expect(() =>
      proposeGenActions(dir, "no-ledger", { tests: [], skipped: SKIPPED, by: BY }, (level, m) =>
        logs.push(`${level}: ${m}`),
      ),
    ).not.toThrow();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^warn: No Claude action for « Write the 1 test skipped for « No source » »/);
  });

  it("a generation's stamp is its ledger and its skipped items: deleting one of its tests does not move it", () => {
    ledger("job-y", { tests: ["local-0000aaaa", "local-0000bbbb"], skipped: SKIPPED });
    const stamp = stampOf(dir, "gen:job-y");
    expect(stamp).not.toBe("gone");
    ledger("job-y", { tests: ["local-0000aaaa"], skipped: SKIPPED });
    expect(stampOf(dir, "gen:job-y")).toBe(stamp);
    ledger("job-y", { tests: ["local-0000aaaa"], skipped: [] });
    expect(stampOf(dir, "gen:job-y")).not.toBe(stamp);
    expect(stampOf(dir, "gen:nope")).toBe("gone");
  });
});
