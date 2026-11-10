import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import type { ClaudeSpawn } from "../../../../src/core/env.ts";
import { readCheck, readTest } from "../../../../src/core/lib/store.ts";
import { recordCheck } from "../../helpers/fake-check.ts";
import {
  checked,
  dir,
  fake,
  isCheck,
  line,
  recordLine,
  result,
  seen,
  setReviewLine,
  tool,
} from "../claude/run-fakes.ts";

const ID = "local-3f9a12c0";
const NOT_RECORDED = `The semantic check did not finish (Claude did not record the check of ${ID} (check_record was not called with a verdict per step).): run the check again.`;

describe("no check_record, no pass", () => {
  it("a semantic run that answered without recording is asked again once, then leaves the draft a draft, with a warning", async () => {
    setReviewLine(ID, "draft");
    fake(() => ({ lines: () => [result("I could not read the test, sorry.")] }));
    const out = (await invoke("check.run", { ids: [ID] }, { project: dir })) as {
      tests: { ok: boolean; review: string; summary?: string }[];
      failed: string[];
    };
    expect(seen).toHaveLength(2);
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft" });
    expect(out.tests[0].summary).toBe(
      `Claude did not record the check of ${ID} (check_record was not called with a verdict per step).`,
    );
    expect(out.failed).toEqual([ID]);
    expect(readCheck(dir, ID)?.findings.at(-1)).toMatchObject({
      kind: "other",
      severity: "warning",
      pass: "semantic",
      message: NOT_RECORDED,
    });
    expect(readCheck(dir, ID)?.verdicts).toBeUndefined();
  });

  it("a check_record for another test, one that failed, or one that recorded no verdict does not count", async () => {
    setReviewLine(ID, "draft");
    type Out = { tests: { ok: boolean; review: string }[] };
    fake(() => ({ lines: () => [recordLine("LFRPS12-1420"), result("0")] }));
    let out = (await invoke("check.run", { ids: [ID] }, { project: dir })) as Out;
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft" });
    const bad = JSON.parse(
      line({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "r1", is_error: true, content: "boom" }] },
      }),
    );
    fake(() => ({
      lines: () => [tool("mcp__testimus__check_record", { id: ID }, "r1"), line(bad), result("0")],
    }));
    out = (await invoke("check.run", { ids: [ID] }, { project: dir })) as Out;
    expect(out.tests[0].ok).toBe(false);
    fake(() => ({ lines: () => [recordLine(ID), result("0")] }));
    out = (await invoke("check.run", { ids: [ID] }, { project: dir })) as Out;
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft" });
    fake((s) => ({ during: () => recordCheck(s.cwd, ID).then(() => {}), lines: () => [result("0")] }));
    out = (await invoke("check.run", { ids: [ID] }, { project: dir })) as Out;
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft" });
    expect(readCheck(dir, ID)?.verdicts).toBeUndefined();
    fake(() => checked());
    out = (await invoke("check.run", { ids: [ID] }, { project: dir })) as Out;
    expect(out.tests[0]).toMatchObject({ ok: true, review: "draft" });
    expect(readCheck(dir, ID)?.findings).toEqual([]);
    expect(readCheck(dir, ID)?.verdicts).toEqual([
      { step: 1, verdict: "supported", read: ["SOSIE_211_D401-1_3#§5.6.6"], opened: true },
      { step: 2, verdict: "supported", read: ["SOSIE_211_D401-1_3#§5.6.6"], opened: true },
    ]);
  });
});

describe("review.fix sends the fixed test back to draft; its message says when the re-check did not finish", () => {
  const fixEdit = (s: ClaudeSpawn) => {
    const f = join(s.cwd, "tests", ID, "test.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("Le menu contextuel s'ouvre.", "Seul Propriétés est proposé."));
  };

  it("re-check failed → draft, with a message", async () => {
    fake((s) =>
      isCheck(s)
        ? { lines: () => [result("529 overloaded", true)], out: { code: 1 } }
        : { during: fixEdit, lines: () => [result("fixed")] },
    );
    const out = (await invoke("review.fix", { id: ID }, { project: dir })) as {
      review: string;
      message?: string;
    };
    expect(out.review).toBe("draft");
    expect(out.message).toMatch(/did not finish/);
    expect(readTest(dir, ID).test.review).toBe("draft");
    expect(seen.filter(isCheck)).toHaveLength(1);
  });

  it("re-check skipped (semantic: false) → draft, with a message; a re-check that recorded → draft, no message", async () => {
    fake(() => ({ during: fixEdit, lines: () => [result("fixed")] }));
    let out = (await invoke("review.fix", { id: ID, semantic: false }, { project: dir })) as {
      review: string;
      message?: string;
    };
    expect(out).toMatchObject({ review: "draft" });
    expect(out.message).toMatch(/only the mechanical check/);
    fake((s) => (isCheck(s) ? checked() : { during: fixEdit, lines: () => [result("fixed")] }));
    out = (await invoke("review.fix", { id: ID, note: "x" }, { project: dir })) as typeof out;
    expect(out).toMatchObject({ review: "draft" });
    expect(out.message).toBeUndefined();
  });
});
