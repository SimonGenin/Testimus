import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpAccess, readOnlyCommands } from "../../src/core/claude/access.ts";
import { mcpServer, runClaude } from "../../src/core/claude/run.ts";
import { revert, takeSnapshot } from "../../src/core/claude/snapshot.ts";
import { claudeVersion, forShell, resetProbe } from "../../src/core/claude/status.ts";
import { invoke, registry } from "../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../src/core/env.ts";
import { subscribe } from "../../src/core/jobs.ts";
import { sha256 } from "../../src/core/lib/hash.ts";
import { DEFAULT_SETTINGS, readProject, writeProject, writeSettings } from "../../src/core/lib/project.ts";
import { readCheck, readTest } from "../../src/core/lib/store.ts";
import type { JobEvent } from "../../src/core/types.ts";
import { markIndexedInDb as markIndexed } from "./index-state-helpers.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const real = env.spawnClaude;
const win = process.platform === "win32";

let dir: string;
let seen: ClaudeSpawn[] = [];

const line = (m: unknown) => JSON.stringify(m);
const tool = (name: string, input: unknown, id = `t-${Math.random().toString(16).slice(2)}`) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string, text: string) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] },
  });
const result = (r: string, isError = false) =>
  line({ type: "result", subtype: "success", is_error: isError, result: r, session_id: "s-1", duration_ms: 5 });

type Script = { lines?: (s: ClaudeSpawn) => string[]; during?: (s: ClaudeSpawn) => void; out?: Partial<ClaudeOut> };

function fake(pick: (s: ClaudeSpawn) => Script) {
  env.spawnClaude = async (s) => {
    seen.push(s);
    const sc = pick(s);
    sc.during?.(s);
    const ls = sc.lines?.(s) ?? [result("ok")];
    for (const l of ls) s.onLine?.(l);
    return { code: 0, stdout: `${ls.join("\n")}\n`, stderr: "", ...sc.out };
  };
}

const idIn = (s: ClaudeSpawn) => /skill on the test ([\w.-]+)\./.exec(s.stdin)?.[1] ?? "";
const recordLine = (id: string) => tool("mcp__testimus__check_record", { id, findings: [] });
const isCheck = (s: ClaudeSpawn) => s.stdin.includes("Use the check-test skill");
const argOf = (s: ClaudeSpawn, flag: string) => s.args[s.args.indexOf(flag) + 1] ?? "";
const allowed = (s: ClaudeSpawn) => argOf(s, "--allowedTools").split(",");
const denied = (s: ClaudeSpawn) => argOf(s, "--disallowedTools").split(",");
const testFile = (id: string) => join(dir, "tests", id, "test.md");
const setReviewLine = (id: string, review: string) =>
  writeFileSync(testFile(id), readFileSync(testFile(id), "utf8").replace(/^review: .*$/m, `review: ${review}`));

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-s1-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  seen = [];
});
afterEach(() => {
  env.spawnClaude = real;
  delete process.env.TESTIMUS_IN_CLAUDE;
  delete process.env.TESTIMUS_HOME_BIN;
});

const NEVER = [
  "xray_push",
  "xray_pull",
  "review_set",
  "review_fix",
  "system_setup",
  "system_saveSettings",
  "project_init",
  "project_set",
  "docs_remove",
  "docs_add",
  "tests_remove",
  "gen_tests",
  "claude_run",
  "claude_revert",
  "chat_ask",
  "rag_eval",
  "rag_index",
  "jobs_cancel",
  "system_doctor",
  "claude_status",
].map((n) => `mcp__testimus__${n}`);

describe("M1 — each run kind gets its own MCP allow-list", () => {
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

describe("M2 — nothing unvalidated reaches cmd", () => {
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

describe("M12 — runs cannot write outside tests/", () => {
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

describe("M9 — no check_record, no pass", () => {
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
    fake(() => ({ lines: () => [recordLine("LFRPS12-1420"), result("0")] }));
    let out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as {
      tests: { review: string }[];
    };
    expect(out.tests[0].review).toBe("draft");
    const bad = JSON.parse(
      line({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "r1", is_error: true, content: "boom" }] },
      }),
    );
    fake(() => ({
      lines: () => [tool("mcp__testimus__check_record", { id: "local-3f9a12c0" }, "r1"), line(bad), result("0")],
    }));
    out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as { tests: { review: string }[] };
    expect(out.tests[0].review).toBe("draft");
    fake(() => ({ lines: () => [recordLine("local-3f9a12c0"), result("0")] }));
    out = (await invoke("check.run", { ids: ["local-3f9a12c0"] }, { project: dir })) as { tests: { review: string }[] };
    expect(out.tests[0].review).toBe("checked");
  });
});

describe("M10 — review.fix sets checked only after a semantic re-check that finished", () => {
  const fixEdit = (s: ClaudeSpawn) => {
    const f = join(s.cwd, "tests", "local-3f9a12c0", "test.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("Le menu contextuel s'ouvre.", "Seul Propriétés est proposé."));
  };

  it("re-check failed → the test stays to-fix, with a message", async () => {
    fake((s) =>
      isCheck(s)
        ? { lines: () => [result("529 overloaded", true)], out: { code: 1 } }
        : { during: fixEdit, lines: () => [result("fixed")] },
    );
    const out = (await invoke("review.fix", { id: "local-3f9a12c0" }, { project: dir })) as {
      review: string;
      message?: string;
    };
    expect(out.review).toBe("to-fix");
    expect(out.message).toMatch(/did not finish/);
    expect(readTest(dir, "local-3f9a12c0").test.review).toBe("to-fix");
  });

  it("re-check skipped (semantic: false) → stays to-fix; a re-check that did not record → stays to-fix", async () => {
    fake(() => ({ during: fixEdit, lines: () => [result("fixed")] }));
    let out = (await invoke("review.fix", { id: "local-3f9a12c0", semantic: false }, { project: dir })) as {
      review: string;
      message?: string;
    };
    expect(out).toMatchObject({ review: "to-fix" });
    expect(out.message).toMatch(/only the mechanical check/);
    out = (await invoke("review.fix", { id: "local-3f9a12c0" }, { project: dir })) as { review: string };
    expect(out.review).toBe("to-fix");
  });

  it("a checked test Claude changed, whose re-check failed, goes back to to-fix", async () => {
    setReviewLine("local-3f9a12c0", "checked");
    fake((s) =>
      isCheck(s)
        ? { lines: () => [result("x", true)], out: { code: 1 } }
        : { during: fixEdit, lines: () => [result("ok")] },
    );
    const out = (await invoke("review.fix", { id: "local-3f9a12c0", note: "x" }, { project: dir })) as {
      review: string;
    };
    expect(out.review).toBe("to-fix");
  });
});

describe("M4 / minor 5 — a run never destroys a user edit", () => {
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
    expect(readFileSync(f, "utf8")).toBe(later);
    expect(await invoke("claude.revert", { runId: r.runId, force: true }, { project: dir })).toEqual({
      reverted: ["LFRPS12-1420"],
      files: [],
    });
    expect(readFileSync(f, "utf8")).toBe(before);
  });
});

describe("M5 — generation claims only the tests its own run wrote", () => {
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

describe("minor 6 — scope ids follow the store's id rule", () => {
  it("refuses .. and separators in a scope, before any snapshot", async () => {
    for (const testId of ["..", "a/b", "..\\x", "../tests"])
      await expect(
        invoke("claude.run", { scope: { kind: "test", testId }, prompt: "x" }, { project: dir }),
      ).rejects.toThrow();
    expect(() => takeSnapshot(dir, "run-x", { kind: "tests", testIds: ["ok-1", ".."] })).toThrow(/not a test id/);
    expect(() => revert(dir, "../../x")).toThrow(/No Claude run/);
  });
});

describe("minor 7 — gen.tests checks what it wrote, inside its job", () => {
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

describe("minor 9 — installed: .mcp.json reaches the shim by its absolute path", () => {
  it("cmd /c <abs>\\testimus.cmd mcp, written into .mcp.json; the shim sets TESTIMUS_HOME_BIN", async () => {
    const bin = "C:\\Users\\x\\AppData\\Local\\Testimus\\";
    process.env.TESTIMUS_HOME_BIN = bin;
    const { ensureMcpJson } = await import("../../src/core/claude/run.ts");
    const j = JSON.parse(readFileSync(ensureMcpJson(dir), "utf8"));
    expect(j.mcpServers.testimus).toEqual({
      command: "cmd",
      args: ["/c", join(bin, "testimus.cmd"), "mcp"],
      env: { TESTIMUS_IN_CLAUDE: "1" },
    });
    const shim = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "testimus.cmd"), "utf8");
    expect(shim).toMatch(/^set "TESTIMUS_HOME_BIN=%~dp0"\r?$/m);
  });
});

describe("minor 12 — project.init keeps a skill the team edited", () => {
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
    known[".claude/skills/generate-tests/SKILL.md"].push(sha256(old));
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

describe("S2 follow-up — labelPrefix", () => {
  it("project.set refuses an empty or space-containing labelPrefix", async () => {
    await expect(invoke("project.set", { labelPrefix: "" }, { project: dir })).rejects.toThrow(/Not a label prefix/);
    await expect(invoke("project.set", { labelPrefix: "my team-" }, { project: dir })).rejects.toThrow(
      /Not a label prefix/,
    );
    await invoke("project.set", { labelPrefix: "tm-" }, { project: dir });
    expect(readProject(dir).labelPrefix).toBe("tm-");
  });
});
