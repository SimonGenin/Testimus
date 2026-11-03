import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { revert, takeSnapshot } from "../../../../src/core/claude/snapshot.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { dir, fake, idIn, recordLine, result, testFile, tool } from "./run-fakes.ts";

describe("a run never destroys a user edit", () => {
  it("an edit made by the user while the check runs is kept (the check did not write it)", async () => {
    const f = testFile("LFRPS12-1398");
    const mine = `${readFileSync(f, "utf8")}\nmy edit\n`;
    const logs: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "log") logs.push(e.message);
    });
    fake((s) => ({ during: () => writeFileSync(f, mine), lines: () => [recordLine(idIn(s)), result("0")] }));
    await invoke("check.run", { ids: ["LFRPS12-1398"] }, { project: dir });
    off();
    expect(readFileSync(f, "utf8")).toBe(mine);
    expect(logs.join("\n")).toMatch(/changed while LFRPS12-1398 was being checked/);
  });

  it("claude.revert refuses when the test changed after the run (naming it), force discards", async () => {
    const f = testFile("LFRPS12-1420");
    const before = readFileSync(f, "utf8");
    fake(() => ({
      during: () => writeFileSync(f, before.replace("Clic droit sur le sectionneur S 12", "Clic droit sur S 12")),
      lines: () => [tool("Edit", { file_path: f }), result("ok")],
    }));
    const r = (await invoke(
      "claude.run",
      { scope: { kind: "test", testId: "LFRPS12-1420" }, prompt: "x" },
      { project: dir },
    )) as { runId: string; written: string[] };
    expect(r.written).toEqual(["LFRPS12-1420"]);
    const later = `${readFileSync(f, "utf8")}\nlater edit\n`;
    writeFileSync(f, later);
    await expect(invoke("claude.revert", { runId: r.runId }, { project: dir })).rejects.toThrow(
      /LFRPS12-1420 changed after the Claude run/,
    );
    await expect(invoke("claude.revert", { runId: r.runId }, { project: dir })).rejects.toMatchObject({
      code: "edited-after-run",
    });
    expect(readFileSync(f, "utf8")).toBe(later);
    expect(await invoke("claude.revert", { runId: r.runId, force: true }, { project: dir })).toEqual({
      reverted: ["LFRPS12-1420"],
      files: [],
    });
    expect(readFileSync(f, "utf8")).toBe(before);
  });
});

describe("scope ids follow the store's id rule", () => {
  it("refuses .. and separators in a scope, before any snapshot", async () => {
    for (const testId of ["..", "a/b", "..\\x", "../tests"])
      await expect(
        invoke("claude.run", { scope: { kind: "test", testId }, prompt: "x" }, { project: dir }),
      ).rejects.toThrow();
    expect(() => takeSnapshot(dir, "run-x", { kind: "tests", testIds: ["ok-1", ".."] })).toThrow(/not a test id/);
    expect(() => revert(dir, "../../x")).toThrow(/No Claude run/);
  });
});
