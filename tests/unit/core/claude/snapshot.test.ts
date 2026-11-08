import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
    expect(logs.join("\n")).toMatch(/changed while « Disjoncteur — ouverture à distance » was being checked/);
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

describe("claude.before: the test before the run that still stands", () => {
  const ID = "LFRPS12-1420";
  const runOn = async (edit: (md: string) => string) => {
    const f = testFile(ID);
    fake(() => ({
      during: () => writeFileSync(f, edit(readFileSync(f, "utf8"))),
      lines: () => [tool("Edit", { file_path: f }), result("ok")],
    }));
    return (await invoke("claude.run", { scope: { kind: "test", testId: ID }, prompt: "x" }, { project: dir })) as {
      runId: string;
    };
  };
  const standing = (testId = ID) =>
    invoke("claude.before", { testId }, { project: dir }) as Promise<Record<string, unknown> | null>;

  it("the latest run that changed the test, as the test was before it; a reverted one gives way to the one before", async () => {
    const md0 = readFileSync(testFile(ID), "utf8");
    const a = await runOn((md) => md.replace("Clic droit sur le sectionneur S 12", "Clic droit sur S 12"));
    const md1 = readFileSync(testFile(ID), "utf8");
    const b = await runOn((md) => `${md}\nencore\n`);
    const got = await standing();
    expect(got).toMatchObject({ runId: b.runId, steps: expect.any(Array), untouched: true });
    expect(JSON.stringify(got?.test)).toContain("Clic droit sur S 12");
    await invoke("claude.revert", { runId: b.runId }, { project: dir });
    expect(readFileSync(testFile(ID), "utf8")).toBe(md1);
    const back = await standing();
    expect(back?.runId).toBe(a.runId);
    expect(JSON.stringify(back?.test)).toContain("Clic droit sur le sectionneur S 12");
    await invoke("claude.revert", { runId: a.runId }, { project: dir });
    expect(readFileSync(testFile(ID), "utf8")).toBe(md0);
  });

  it("an edit after the run keeps it, no longer untouched; a sync after the run ends it", async () => {
    await runOn((md) => `${md}\nplus\n`);
    writeFileSync(testFile(ID), `${readFileSync(testFile(ID), "utf8")}\nmine\n`);
    expect(await standing()).toMatchObject({ untouched: false });
    const remote = testFile(ID).replace(/test\.md$/, ".remote.md");
    const had = existsSync(remote) ? readFileSync(remote, "utf8") : null;
    writeFileSync(remote, had ?? "");
    utimesSync(remote, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
    expect(await standing()).toBeNull();
    if (had === null) rmSync(remote);
    else writeFileSync(remote, had);
    expect(await standing("LFRPS12-1398")).toBeNull();
    expect(await standing("..")).toBeNull();
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
