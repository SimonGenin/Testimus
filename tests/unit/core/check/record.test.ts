import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import type { ClaudeSpawn } from "../../../../src/core/env.ts";
import { readCheck, readTest } from "../../../../src/core/lib/store.ts";
import { dir, fake, isCheck, line, recordLine, result, setReviewLine, tool } from "../claude/run-fakes.ts";

describe("no check_record, no pass", () => {
  it("a semantic run that answered without recording leaves the draft a draft, with a warning", async () => {
    setReviewLine("local-3f9a12c0", "draft");
    fake(() => ({ lines: () => [result("I could not read the test, sorry.")] }));
    const out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as {
      tests: { ok: boolean; review: string }[];
      failed: string[];
    };
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft" });
    expect(out.failed).toEqual(["local-3f9a12c0"]);
    expect(readCheck(dir, "local-3f9a12c0")?.findings.at(-1)).toMatchObject({ kind: "other", pass: "semantic" });
  });

  it("a check_record for another test, or one that failed, does not count", async () => {
    setReviewLine("local-3f9a12c0", "draft");
    type Out = { tests: { ok: boolean; review: string }[] };
    fake(() => ({ lines: () => [recordLine("LFRPS12-1420"), result("0")] }));
    let out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as Out;
    expect(out.tests[0]).toMatchObject({ ok: false, review: "draft" });
    const bad = JSON.parse(
      line({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "r1", is_error: true, content: "boom" }] },
      }),
    );
    fake(() => ({
      lines: () => [tool("mcp__testimus__check_record", { id: "local-3f9a12c0" }, "r1"), line(bad), result("0")],
    }));
    out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as Out;
    expect(out.tests[0].ok).toBe(false);
    fake(() => ({ lines: () => [recordLine("local-3f9a12c0"), result("0")] }));
    out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as Out;
    expect(out.tests[0]).toMatchObject({ ok: true, review: "draft" });
  });
});

describe("review.fix sends the fixed test back to draft; its message says when the re-check did not finish", () => {
  const fixEdit = (s: ClaudeSpawn) => {
    const f = join(s.cwd, "tests", "local-3f9a12c0", "test.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("Le menu contextuel s'ouvre.", "Seul Propriétés est proposé."));
  };

  it("re-check failed → draft, with a message", async () => {
    fake((s) =>
      isCheck(s)
        ? { lines: () => [result("529 overloaded", true)], out: { code: 1 } }
        : { during: fixEdit, lines: () => [result("fixed")] },
    );
    const out = (await invoke("review.fix", { id: "local-3f9a12c0" }, { project: dir })) as {
      review: string;
      message?: string;
    };
    expect(out.review).toBe("draft");
    expect(out.message).toMatch(/did not finish/);
    expect(readTest(dir, "local-3f9a12c0").test.review).toBe("draft");
  });

  it("re-check skipped (semantic: false) → draft, with a message; a re-check that recorded → draft, no message", async () => {
    fake(() => ({ during: fixEdit, lines: () => [result("fixed")] }));
    let out = (await invoke("review.fix", { id: "local-3f9a12c0", semantic: false }, { project: dir })) as {
      review: string;
      message?: string;
    };
    expect(out).toMatchObject({ review: "draft" });
    expect(out.message).toMatch(/only the mechanical check/);
    fake((s) =>
      isCheck(s)
        ? { lines: () => [recordLine("local-3f9a12c0"), result("0")] }
        : { during: fixEdit, lines: () => [result("fixed")] },
    );
    out = (await invoke("review.fix", { id: "local-3f9a12c0", note: "x" }, { project: dir })) as typeof out;
    expect(out).toMatchObject({ review: "draft" });
    expect(out.message).toBeUndefined();
  });
});
