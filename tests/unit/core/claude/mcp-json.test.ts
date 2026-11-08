import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { sha256 } from "../../../../src/core/lib/hash.ts";
import { dir } from "./run-fakes.ts";

describe("installed: .mcp.json reaches the shim by its absolute path", () => {
  it("cmd /c <abs>\\testimus.cmd mcp, written into .mcp.json; the shim sets TESTIMUS_HOME_BIN", async () => {
    const bin = "C:\\Users\\x\\AppData\\Local\\Testimus\\";
    process.env.TESTIMUS_HOME_BIN = bin;
    const { ensureMcpJson } = await import("../../../../src/core/claude/run.ts");
    const j = JSON.parse(readFileSync(ensureMcpJson(dir), "utf8"));
    expect(j.mcpServers.testimus).toEqual({
      command: "cmd",
      args: ["/c", join(bin, "testimus.cmd"), "mcp"],
      env: { TESTIMUS_IN_CLAUDE: "1" },
    });
    const shim = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "scripts", "testimus.cmd"), "utf8");
    expect(shim).toMatch(/^set "TESTIMUS_HOME_BIN=%~dp0"\r?$/m);
  });
});

describe("project.init keeps a skill the team edited", () => {
  it("an untouched skill follows the app, an edited one stays and the new one lands beside it", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "testimus-s1-init-")), "P");
    await invoke("project.init", { dir: p, jiraProject: "XX" }, { project: null });
    const gen = join(p, ".claude", "skills", "generate-tests", "SKILL.md");
    const check = join(p, ".claude", "skills", "check-test", "SKILL.md");
    const shipped = readFileSync(gen, "utf8");
    const old = "an older shipped version\n";
    writeFileSync(gen, old);
    const ledger = join(p, ".testimus", "shipped.json");
    const known = JSON.parse(readFileSync(ledger, "utf8"));
    known[".claude/skills/generate-tests/SKILL.md"].unshift(sha256(old));
    writeFileSync(ledger, JSON.stringify(known));
    writeFileSync(check, `${readFileSync(check, "utf8")}\nTeam rule: always cite the DMI.\n`);
    const edited = readFileSync(check, "utf8");
    const out = (await invoke("project.init", { dir: p }, { project: null })) as { kept: string[]; beside: string[] };
    expect(readFileSync(gen, "utf8")).toBe(shipped);
    expect(readFileSync(check, "utf8")).toBe(edited);
    expect(out.kept).toContain(".claude/skills/check-test/SKILL.md");
    expect(out.beside).toEqual([".claude/skills/check-test/SKILL.new.md"]);
    expect(existsSync(join(p, ".claude", "skills", "check-test", "SKILL.new.md"))).toBe(true);
  });
});
