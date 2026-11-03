import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { readCheck, readTest } from "../../../../src/core/lib/store.ts";
import type { JobEvent } from "../../../../src/core/types.ts";
import { dir, fake, idIn, isCheck, recordLine, result, seen, testFile, tool, toolResult } from "../claude/run-fakes.ts";

describe("generation claims only the tests its own run wrote", () => {
  const NEW = (summary: string, extra = "") =>
    `---\nsummary: ${summary}\nfolder: /\nlabels: []\nreview: validated\n${extra}---\n\n## Step 1\n\n### Action\n\nA\n\n### Expected Result\n\nB\n`;

  it("a test made by hand during the run is not stamped, not reset, not deleted by Revert", async () => {
    const own = "local-0000aaaa";
    const hand = "local-0000bbbb";
    const other = "local-0000cccc";
    fake(() => ({
      during: (s) => {
        for (const [id, md] of [
          [own, NEW("mine")],
          [hand, NEW("by hand")],
          [other, NEW("other gen", "generated_by: generate-11111111\n")],
        ]) {
          mkdirSync(join(s.cwd, "tests", id), { recursive: true });
          writeFileSync(join(s.cwd, "tests", id, "test.md"), md);
        }
      },
      lines: (s) => [
        tool("mcp__testimus__tests_create", { summary: "mine" }, "c1"),
        toolResult("c1", JSON.stringify({ id: own })),
        tool("Write", { file_path: join(s.cwd, "tests", other, "test.md") }),
        result("done"),
      ],
    }));
    const handBefore = NEW("by hand");
    const r = (await invoke("gen.tests", { request: "x", check: false }, { project: dir })) as {
      tests: string[];
      runId: string;
    };
    expect(r.tests).toEqual([own]);
    expect(readTest(dir, own).test.review).toBe("draft");
    expect(readFileSync(testFile(hand), "utf8")).toBe(handBefore);
    expect(readTest(dir, other).test.generatedBy).toBe("generate-11111111");
    expect(readTest(dir, other).test.review).toBe("validated");
    const rev = (await invoke("claude.revert", { runId: r.runId }, { project: dir })) as { reverted: string[] };
    expect(rev.reverted.sort()).toEqual([other, own].sort());
    expect(existsSync(testFile(hand))).toBe(true);
    expect(existsSync(testFile(own))).toBe(false);
  });

  it("an existing test changed during the run but not by it is not reported as changed by the generation", async () => {
    fake(() => ({
      during: (s) => writeFileSync(join(s.cwd, "tests", "LFRPS12-1398", "test.md"), "user\n"),
      lines: () => [result("nothing")],
    }));
    const r = (await invoke("gen.tests", { request: "x", check: false }, { project: dir })) as { changed: string[] };
    expect(r.changed).toEqual([]);
  });
});

describe("gen.tests checks what it wrote, inside its job", () => {
  it("mechanical + check-test on the new tests; a recorded clean pass makes them checked", async () => {
    const id = "local-0000dddd";
    fake((s) =>
      isCheck(s)
        ? { lines: () => [recordLine(idIn(s)), result("0")] }
        : {
            during: () => {
              mkdirSync(join(s.cwd, "tests", id), { recursive: true });
              writeFileSync(
                join(s.cwd, "tests", id, "test.md"),
                "---\nsummary: x\n---\n\n## Step 1\n\n### Action\n\nA\n",
              );
            },
            lines: () => [tool("Write", { file_path: `tests/${id}/test.md` }), result("done")],
          },
    );
    const events: JobEvent[] = [];
    const off = subscribe((e) => events.push(e));
    const r = (await invoke("gen.tests", { request: "x" }, { project: dir })) as {
      tests: string[];
      checks: { id: string; ok: boolean; review: string }[];
    };
    off();
    expect(r.tests).toEqual([id]);
    expect(seen).toHaveLength(2);
    expect(seen[1].stdin).toContain(`Use the check-test skill on the test ${id}.`);
    expect(r.checks).toEqual([expect.objectContaining({ id, ok: true, review: "checked" })]);
    expect(readTest(dir, id).test.review).toBe("checked");
    expect(readCheck(dir, id)).not.toBeNull();
  });
});
