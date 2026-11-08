import { describe, expect, it } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { testOf } from "../../../../src/ui/app/useClaudeLock.ts";
import { claudeOn, PROJECT_RUN } from "../../../../src/ui/components/claude/turns.ts";

const job = (scope: unknown) => ({ rerun: { name: "claude.run", input: { scope } } }) as unknown as Job;

describe("the test a Claude job locks", () => {
  it("a run on a test run names the run and locks no test; a test its test; the project every test", () => {
    const run = testOf(job({ kind: "run", run: "recette-j5", testId: "LFRPS12-1398" }));
    expect(run).toBe("run:recette-j5");
    expect(claudeOn(run, "LFRPS12-1398")).toBe(false);
    expect(testOf(job({ kind: "test", testId: "LFRPS12-1398" }))).toBe("LFRPS12-1398");
    expect(testOf(job({ kind: "project" }))).toBe(PROJECT_RUN);
  });
});
