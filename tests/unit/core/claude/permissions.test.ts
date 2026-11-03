import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mcpAccess, readOnlyCommands } from "../../../../src/core/claude/access.ts";
import { mcpServer, runClaude } from "../../../../src/core/claude/run.ts";
import { claudeVersion, forShell, resetProbe } from "../../../../src/core/claude/status.ts";
import { invoke, registry } from "../../../../src/core/commands/index.ts";
import { DEFAULT_SETTINGS, readProject, writeProject, writeSettings } from "../../../../src/core/lib/project.ts";
import { allowed, argOf, denied, dir, fake, idIn, isCheck, NEVER, recordLine, result, seen, win } from "./run-fakes.ts";

describe("each run kind gets its own MCP allow-list", () => {
  it("read-only = mutates:false, no job, nothing that starts Claude or touches the app", async () => {
    const ro = await readOnlyCommands();
    for (const n of ro) {
      const c = registry.find((x) => x.name === n);
      expect(c?.mutates, n).toBe(false);
      expect(c?.job, n).toBeUndefined();
      expect(n).not.toMatch(/^(system|project|jobs|claude)\.|^chat\.ask$|^rag\.eval$/);
    }
    expect(ro).toEqual(expect.arrayContaining(["rag.search", "rag.passage", "rag.figure", "tests.show", "tests.list"]));
  });

  it("the lists: chat/figures/headers read-only, check + check_record, generate/fix/run + test writes, triage proposes", async () => {
    const ro = (await readOnlyCommands()).map((n) => `mcp__testimus__${n.replace(".", "_")}`);
    const extra = async (k: Parameters<typeof mcpAccess>[0]) =>
      (await mcpAccess(k)).allow.filter((t) => !ro.includes(t)).sort();
    const m = (xs: string[]) => xs.map((x) => `mcp__testimus__${x}`).sort();
    expect(await extra("chat")).toEqual([]);
    expect(await extra("figures")).toEqual([]);
    expect(await extra("headers")).toEqual([]);
    expect(await extra("check")).toEqual(m(["check_record", "actions_propose"]));
    expect(await extra("generate")).toEqual(
      m(["tests_create", "tests_edit", "tests_save", "tests_addImage", "check_run", "actions_propose"]),
    );
    expect(await extra("triage")).toEqual(m(["actions_propose"]));
    expect(await extra("fix")).toEqual(m(["tests_edit", "tests_save", "tests_addImage"]));
    expect(await extra("run")).toEqual(m(["tests_edit", "tests_save", "tests_addImage", "check_run"]));
    for (const k of ["chat", "figures", "headers", "check", "generate", "fix", "run"] as const) {
      const a = await mcpAccess(k);
      for (const n of NEVER) {
        expect(a.allow, `${k} ${n}`).not.toContain(n);
        expect(a.deny, `${k} ${n}`).toContain(n);
      }
      expect(a.allow.length + a.deny.length).toBe(registry.length);
    }
  });

  it("chat.ask, claude.run, review.fix, check.run, gen.tests and describeFigures pass their list, never mcp__testimus__*", async () => {
    fake((s) => ({ lines: () => (isCheck(s) ? [recordLine(idIn(s)), result("0")] : [result("ok")]) }));
    await invoke("chat.ask", { question: "Quel menu ?" }, { project: dir });
    await invoke("claude.run", { scope: { kind: "test", testId: "LFRPS12-1420" }, prompt: "x" }, { project: dir });
    await invoke("review.fix", { id: "local-3f9a12c0" }, { project: dir });
    await invoke("gen.tests", { request: "x", check: false }, { project: dir });
    await invoke("docs.describeFigures", { docId: "SOSIE_211_D401-1_3", force: true }, { project: dir });
    const kinds = seen.map((s) => {
      const a = allowed(s);
      expect(a).not.toContain("mcp__testimus__*");
      for (const n of NEVER) expect(a).not.toContain(n);
      for (const n of NEVER) expect(denied(s)).toContain(n);
      return a;
    });
    const [chat, run, fix, check, gen] = kinds;
    expect(chat).not.toContain("mcp__testimus__tests_edit");
    expect(chat).toContain("mcp__testimus__rag_search");
    expect(run).toContain("mcp__testimus__tests_edit");
    expect(run).not.toContain("mcp__testimus__tests_create");
    expect(fix).toContain("mcp__testimus__tests_save");
    expect(check).toContain("mcp__testimus__check_record");
    expect(check).not.toContain("mcp__testimus__tests_edit");
    expect(gen).toContain("mcp__testimus__tests_create");
    expect(gen).toContain("mcp__testimus__check_run");
    const figures = seen.slice(5);
    expect(figures.length).toBeGreaterThan(0);
    for (const s of figures) {
      expect(argOf(s, "--tools")).toBe("Read");
      expect(allowed(s)).not.toContain("mcp__testimus__tests_edit");
    }
  });

  it("a headers run is read-only too", async () => {
    fake(() => ({}));
    await runClaude({ kind: "headers", project: dir, prompt: "p", model: "haiku", effort: "low" });
    expect(argOf(seen[0], "--tools")).toBe("Read");
    expect(
      allowed(seen[0])
        .filter((t) => t.startsWith("mcp__"))
        .every((t) => !/tests_(edit|save|create)/.test(t)),
    ).toBe(true);
  });

  it("check_run from inside a Claude run is mechanical only (the .mcp.json env says so)", async () => {
    process.env.TESTIMUS_IN_CLAUDE = "1";
    fake(() => ({}));
    const out = (await invoke("check.run", { ids: ["LFRPS12-1420"] }, { project: dir })) as { tests: unknown[] };
    expect(out.tests).toHaveLength(1);
    expect(seen).toEqual([]);
    expect(mcpServer().env).toEqual({ TESTIMUS_IN_CLAUDE: "1" });
  });
});

describe("nothing unvalidated reaches cmd", () => {
  it("a model or effort outside the rule is refused before anything is spawned", async () => {
    fake(() => ({}));
    const base = { kind: "run" as const, project: dir, prompt: "p", effort: "low" as const };
    await expect(runClaude({ ...base, model: 'sonnet" & echo MODEL-INJECTED & "' })).rejects.toThrow(
      /Not a model name/,
    );
    await expect(runClaude({ ...base, model: "sonnet%PATH%" })).rejects.toThrow(/Not a model name/);
    await expect(runClaude({ ...base, model: "opus", effort: "high & calc" as never })).rejects.toThrow(
      /Not an effort level/,
    );
    await expect(
      invoke(
        "claude.run",
        { scope: { kind: "test", testId: "LFRPS12-1420" }, prompt: "x", model: "a&b" },
        { project: dir },
      ),
    ).rejects.toThrow();
    const p = readProject(dir);
    writeProject(dir, { ...p, claude: { ...p.claude, model: "x|y" } });
    await expect(invoke("chat.ask", { question: "q" }, { project: dir })).rejects.toThrow(/Not a model name/);
    expect(seen).toEqual([]);
    expect(existsSync(join(dir, ".testimus", "runs"))).toBe(false);
    await runClaude({ ...base, model: "claude-opus-4-5[1m]" });
    expect(argOf(seen[0], "--model")).toBe("claude-opus-4-5[1m]");
  });

  it("forShell: plain quotes around a space for a .cmd, a metacharacter refused, an .exe untouched", () => {
    expect(forShell("C:/x/claude.exe", ['a "b" & c'])).toEqual({ exe: "C:/x/claude.exe", args: ['a "b" & c'] });
    if (!win) return;
    expect(forShell("C:/Program Files/x/claude.cmd", ["D:/my docs", "Edit(docs/**)", "opus"])).toEqual({
      exe: '"C:/Program Files/x/claude.cmd"',
      args: ['"D:/my docs"', '"Edit(docs/**)"', "opus"],
    });
    for (const bad of ['sonnet" & echo X & "', "%USERPROFILE%", "a|b", "a^b", "a!b", "a\nb"])
      expect(() => forShell("C:/x/claude.cmd", [bad])).toThrow(/cannot go through cmd/);
  });

  it("the run resolves claude first, then quotes for the shim it found", async () => {
    if (!win) return;
    const bin = join(mkdtempSync(join(tmpdir(), "testimus-s1 bin-")), "with space");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude.cmd"), "@echo off\r\n");
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: join(bin, "claude.cmd") } });
    fake(() => ({}));
    await runClaude({ kind: "chat", project: dir, prompt: "p", model: "opus", effort: "low" });
    expect(seen[0].exe).toBe(`"${join(bin, "claude.cmd")}"`);
    expect(seen[0].args.every((a) => !a.includes('\\"'))).toBe(true);
  });

  it("minor 13 — the --version probe goes through the same quoting", async () => {
    if (!win) return;
    const exe = "C:/Program Files/Claude/claude.cmd";
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe } });
    fake(() => ({ out: { stdout: "2.1.0 (Claude Code)\n" } }));
    resetProbe();
    expect(await claudeVersion(true)).toEqual({ ok: true, text: "2.1.0 (Claude Code)" });
    expect(seen[0]).toMatchObject({ exe: `"${exe}"`, args: ["--version"] });
    resetProbe();
  });
});

describe("runs cannot write outside tests/", () => {
  it("--disallowedTools names docs, index, .testimus, project.json, xray.json (Edit and Write)", async () => {
    fake(() => ({}));
    await runClaude({ kind: "fix", project: dir, prompt: "p", model: "opus", effort: "low" });
    const d = denied(seen[0]);
    for (const p of ["docs/**", "index/**", ".testimus/**", "project.json", "xray.json", ".mcp.json", ".claude/**"]) {
      expect(d).toContain(`Edit(${p})`);
      expect(d).toContain(`Write(${p})`);
    }
    expect(d.some((r) => r.includes("tests/"))).toBe(false);
  });
});
