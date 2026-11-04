import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absRule, mcpAccess, protectedRules } from "../../../../src/core/claude/access.ts";
import { buildPrompt, EDIT_MARKER } from "../../../../src/core/claude/prompt.ts";
import { claudeArgs, ensureMcpJson, mcpServer, runClaude } from "../../../../src/core/claude/run.ts";
import { changedStepNumbers, revert, stepBlocks } from "../../../../src/core/claude/snapshot.ts";
import { forShell } from "../../../../src/core/claude/status.ts";
import { eventsOf, streamParser } from "../../../../src/core/claude/stream.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, readJson, writeSettings } from "../../../../src/core/lib/project.ts";
import type { ClaudeEvent } from "../../../../src/core/types.ts";
import { writeContextMd } from "../../helpers/context.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/project/", import.meta.url));
const EXE = "C:/bin/claude.exe";

function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-claude-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const line = (m: unknown) => JSON.stringify(m);
const init = line({ type: "system", subtype: "init", session_id: "s-1" });
const text = (t: string) => line({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
const tool = (name: string, input: unknown) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name, input }] } });
const result = (r: string, extra: Record<string, unknown> = {}) =>
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    result: r,
    session_id: "s-1",
    duration_ms: 800,
    total_cost_usd: 0.01,
    ...extra,
  });

let seen: ClaudeSpawn[] = [];
const real = env.spawnClaude;

function fake(lines: string[], out: Partial<ClaudeOut> = {}, during?: (s: ClaudeSpawn) => void) {
  env.spawnClaude = async (s) => {
    seen.push(s);
    during?.(s);
    for (const l of lines) s.onLine?.(l);
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "", ...out };
  };
}

beforeEach(() => {
  seen = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: EXE } });
});
afterEach(() => {
  env.spawnClaude = real;
});

describe("claude args (SPEC §11)", () => {
  it("builds exactly the spec flags, MCP tools allowed, contexts and resume appended", () => {
    expect(
      claudeArgs({
        model: "sonnet",
        effort: "medium",
        mcpConfig: "D:/p/.mcp.json",
        tools: ["Read", "Edit"],
        addDirs: ["D:/ctx/a", "D:/ext"],
        resume: "s-9",
      }),
    ).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "sonnet",
      "--effort",
      "medium",
      "--permission-mode",
      "acceptEdits",
      "--mcp-config",
      "D:/p/.mcp.json",
      "--strict-mcp-config",
      "--tools",
      "Read,Edit",
      "--allowedTools",
      "Read,Edit",
      "--add-dir",
      "D:/ctx/a",
      "D:/ext",
      "--resume",
      "s-9",
    ]);
  });

  it("quotes only for a .cmd shim on Windows", () => {
    expect(forShell("C:/x/claude.exe", ["a b"])).toEqual({ exe: "C:/x/claude.exe", args: ["a b"] });
    if (process.platform === "win32")
      expect(forShell("C:/x/claude.cmd", ["a b", "plain", "mcp__testimus__*"])).toEqual({
        exe: "C:/x/claude.cmd",
        args: ['"a b"', "plain", "mcp__testimus__*"],
      });
  });

  it("writes .mcp.json so the run calls back into this Testimus, keeping other servers", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-mcpjson-"));
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const file = ensureMcpJson(dir);
    const j = readJson<{ mcpServers: Record<string, { command: string; args: string[] }> }>(file, {
      mcpServers: {},
    });
    expect(j.mcpServers.other).toEqual({ command: "x" });
    expect(j.mcpServers.testimus).toEqual(mcpServer());
    expect(j.mcpServers.testimus.command).toBe("node");
    expect(j.mcpServers.testimus.args[0]).toMatch(/src\/faces\/cli\.ts$/);
    expect(j.mcpServers.testimus.args[1]).toBe("mcp");
    process.env.TESTIMUS_HOME_BIN = "C:/Users/x/AppData/Local/Testimus/bin";
    try {
      expect(mcpServer()).toEqual({
        command: "cmd",
        args: ["/c", join("C:/Users/x/AppData/Local/Testimus/bin", "testimus.cmd"), "mcp"],
        env: { TESTIMUS_IN_CLAUDE: "1" },
      });
    } finally {
      delete process.env.TESTIMUS_HOME_BIN;
    }
  });
});

describe("stream-json", () => {
  it("turns assistant text, tool calls and the result into events", () => {
    expect(eventsOf(text("Bonjour"))).toEqual([{ type: "text", text: "Bonjour" }]);
    expect(eventsOf(tool("mcp__testimus__rag_search", { query: "menu" }))).toEqual([
      { type: "tool", name: "mcp__testimus__rag_search", input: '{"query":"menu"}' },
    ]);
    expect(eventsOf(result("done"))).toEqual([
      { type: "result", ok: true, text: "done", costUsd: 0.01, sessionId: "s-1", durationMs: 800 },
    ]);
    expect(eventsOf(result("boom", { is_error: true }))[0]).toMatchObject({ ok: false });
    expect(eventsOf("not json")).toEqual([]);
    expect(eventsOf(init)).toEqual([]);
  });

  it("parses lines split across chunks and several lines per chunk", () => {
    const got: ClaudeEvent[] = [];
    const p = streamParser((e) => got.push(e));
    const a = text("one");
    const b = text("two");
    p.push(a.slice(0, 10));
    expect(got).toEqual([]);
    p.push(`${a.slice(10)}\n${b}\n${result("r").slice(0, 25)}`);
    expect(got.map((e) => e.type)).toEqual(["text", "text"]);
    p.push(result("r").slice(25));
    p.end();
    expect(got.map((e) => e.type)).toEqual(["text", "text", "result"]);
  });
});

describe("runClaude", () => {
  it("runs claude -p with the prompt on stdin in the project folder and streams events", async () => {
    const dir = copyFixture();
    fake([init, tool("Read", { file_path: "x" }), text("Done."), result("Rephrased step 2.")]);
    const events: ClaudeEvent[] = [];
    const res = await runClaude({
      kind: "run",
      project: dir,
      prompt: "PROMPT TEXT",
      model: "opus",
      effort: "high",
      scope: { kind: "test", testId: "LFRPS12-1420" },
      onEvent: (e) => events.push(e),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].exe).toBe(EXE);
    expect(seen[0].cwd).toBe(dir);
    expect(seen[0].stdin).toBe("PROMPT TEXT");
    expect(seen[0].args).toEqual(
      claudeArgs({
        model: "opus",
        effort: "high",
        mcpConfig: join(dir, ".mcp.json"),
        tools: ["Read", "Edit", "Write", "Glob", "Grep", "Skill"],
        mcpTools: (await mcpAccess("run")).allow,
        disallowedTools: [...(await mcpAccess("run")).deny, ...protectedRules()],
      }),
    );
    expect(seen[0].args).not.toContain("PROMPT TEXT");
    expect(events.map((e) => e.type)).toEqual(["tool", "text", "result"]);
    expect(res).toMatchObject({
      ok: true,
      summary: "Rephrased step 2.",
      durationMs: 800,
      costUsd: 0.01,
      sessionId: "s-1",
      changedTests: [],
    });
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
  });

  it("snapshots the scope, reports changed tests and steps, and reverts byte for byte", async () => {
    const dir = copyFixture();
    const file = join(dir, "tests", "LFRPS12-1420", "test.md");
    const before = readFileSync(file, "utf8");
    fake([init, result("ok")], {}, () =>
      writeFileSync(file, before.replace("Clic droit sur le sectionneur S 12", "Clic droit sur S 12")),
    );
    const res = await runClaude({
      kind: "run",
      project: dir,
      prompt: "p",
      model: "sonnet",
      effort: "low",
      scope: { kind: "project" },
    });
    expect(res.changedTests).toEqual(["LFRPS12-1420"]);
    expect(res.changedSteps).toEqual({ "LFRPS12-1420": [2] });
    expect(existsSync(join(dir, ".testimus", "runs", res.runId, "run.json"))).toBe(true);
    expect(await invoke("claude.revert", { runId: res.runId }, { project: dir })).toEqual({
      reverted: ["LFRPS12-1420"],
      files: [],
    });
    expect(readFileSync(file, "utf8")).toBe(before);
    await expect(invoke("claude.revert", { runId: "nope" }, { project: dir })).rejects.toThrow(/No Claude run/);
  });

  it("removes a test the run created on revert (project scope)", async () => {
    const dir = copyFixture();
    fake(
      [init, tool("Write", { file_path: join(dir, "tests", "local-new00001", "test.md") }), result("ok")],
      {},
      () => {
        mkdirSync(join(dir, "tests", "local-new00001"), { recursive: true });
        writeFileSync(join(dir, "tests", "local-new00001", "test.md"), "---\nsummary: x\n---\n\n## Step 1\n\nA\n");
      },
    );
    const res = await runClaude({
      kind: "run",
      project: dir,
      prompt: "p",
      model: "m",
      effort: "low",
      scope: { kind: "project" },
    });
    expect(res.changedTests).toEqual(["local-new00001"]);
    expect(res.changedSteps["local-new00001"]).toEqual([1]);
    revert(dir, res.runId);
    expect(existsSync(join(dir, "tests", "local-new00001"))).toBe(false);
  });

  it("a failing, garbled, missing or cancelled run comes back as ok:false with a diagnosis", async () => {
    const dir = copyFixture();
    const base = { kind: "run" as const, project: dir, prompt: "p", model: "m", effort: "low" as const };

    fake([result("Invalid API key · Please run /login", { is_error: true })], { code: 1 });
    let r = await runClaude(base);
    expect(r).toMatchObject({ ok: false, summary: "Invalid API key · Please run /login" });
    expect(r.diagnosis?.kind).toBe("login");

    fake(["not json at all"], { code: 1, stderr: "boom: no such model\n" });
    r = await runClaude(base);
    expect(r).toMatchObject({ ok: false, summary: "boom: no such model" });
    expect(r.raw).toContain("not json at all");

    fake([], { code: 1 });
    expect((await runClaude(base)).summary).toBe("claude exited with code 1");

    env.spawnClaude = async () => {
      throw new Error("spawn claude ENOENT");
    };
    r = await runClaude(base);
    expect(r).toMatchObject({ ok: false, summary: "spawn claude ENOENT" });
    expect(r.diagnosis?.kind).toBe("connect");

    const ctrl = new AbortController();
    const file = join(dir, "tests", "LFRPS12-1398", "test.md");
    fake([init], { code: 130 }, () => {
      writeFileSync(file, "half edited\n");
      ctrl.abort();
    });
    r = await runClaude({ ...base, signal: ctrl.signal, scope: { kind: "test", testId: "LFRPS12-1398" } });
    expect(r).toMatchObject({ ok: false, summary: "Cancelled", changedTests: ["LFRPS12-1398"] });
  });

  it("passes every attached context folder as --add-dir", async () => {
    const dir = copyFixture();
    const ctx = join(dir, "contexts", "ctx-a1b2c3d4");
    const ext = mkdtempSync(join(tmpdir(), "testimus-ext-"));
    const specs = mkdtempSync(join(tmpdir(), "testimus-specs-"));
    mkdirSync(join(ctx, "files"), { recursive: true });
    writeContextMd(ctx, {
      name: "Manuel",
      paths: [ext, join(specs, "srs.pdf"), "Z:/not/here"],
      notes: "Lire le chapitre 3.",
    });
    writeFileSync(join(ctx, "files", "shot.png"), "x");
    fake([result("ok")]);
    await runClaude({
      kind: "run",
      project: dir,
      prompt: "p",
      model: "m",
      effort: "low",
      contexts: ["ctx-a1b2c3d4", "ctx-gone", "../escape"],
    });
    const args = seen[0].args;
    expect(args.slice(args.indexOf("--add-dir"))).toEqual(["--add-dir", ctx, ext, specs]);
    const denied = args[args.indexOf("--disallowedTools") + 1].split(",");
    expect(denied).toContain(`Edit(${absRule(ext)}/**)`);
    expect(denied).toContain(`Write(${absRule(specs)}/**)`);
    expect(denied).not.toContain(`Edit(${absRule(ctx)}/**)`);
  });
});

describe("claude.run", () => {
  it("builds the scoped prompt and returns the run with its runId", async () => {
    const dir = copyFixture();
    fake([result("ok")]);
    const r = (await invoke(
      "claude.run",
      { scope: { kind: "step", testId: "LFRPS12-1420", step: 2 }, prompt: "Rephrase." },
      { project: dir },
    )) as { ok: boolean; runId: string };
    expect(r.ok).toBe(true);
    expect(r.runId).toMatch(/^run-/);
    expect(seen[0].stdin.split("\n").slice(0, 5)).toEqual([
      "Use the edit-test skill for the request below.",
      "Scope: step 2 of test LFRPS12-1420.",
      "Files: tests/LFRPS12-1420/test.md",
      "Only modify what the scope allows.",
      'Only edit "## Step 2" of that file (its fields and its ### Sources); do not touch other steps.',
    ]);
    expect(seen[0].args.slice(4, 8)).toEqual(["--model", "sonnet", "--effort", "medium"]);
  });

  it("names the edit-test skill on a test, not on the project, and lets it run the mechanical check", async () => {
    const dir = copyFixture();
    fake([result("ok"), result("ok")]);
    await invoke("claude.run", { scope: { kind: "test", testId: "LFRPS12-1420" }, prompt: "Relis." }, { project: dir });
    await invoke("claude.run", { scope: { kind: "project" }, prompt: "Combien de tests ?" }, { project: dir });
    expect(seen[0].stdin.startsWith(`${EDIT_MARKER}\nScope: the whole test LFRPS12-1420.`)).toBe(true);
    expect(seen[1].stdin.startsWith("Scope: the whole project")).toBe(true);
    expect((await mcpAccess("run")).allow).toContain("mcp__testimus__check_run");
  });

  it("states the scope, contexts and reply format in the prompt", () => {
    const whole = buildPrompt({ kind: "tests", testIds: ["A-1", "A-2"] }, "  ", [], "D:/p");
    expect(whole.split("\n").slice(0, 2)).toEqual([
      "Scope: the tests A-1, A-2.",
      "Files: tests/A-1/test.md, tests/A-2/test.md",
    ]);
    expect(whole.trimEnd().endsWith("anything you could not do.")).toBe(true);
    const withCtx = buildPrompt(
      { kind: "project" },
      "Do it.",
      [{ id: "c1", name: "Manuel", text: "n", paths: ["D:/x"], files: ["a.png"] }],
      "D:\\p",
    );
    expect(withCtx).toContain(
      "- Manuel — notes: D:/p/contexts/c1/context.md; files: D:/p/contexts/c1/files/a.png; also look at: D:/x",
    );
    expect(withCtx).toContain("\nDo it.\n");
  });
});

describe("step diff", () => {
  it("compares steps positionally, ignoring the number and the id", () => {
    const md = (steps: string[]) =>
      `---\nsummary: s\n---\n\n## Description\n\nd\n\n${steps.map((s, i) => `## Step ${i + 1} <!-- ${i} -->\n\n### Action\n\n${s}\n`).join("\n")}`;
    expect(stepBlocks(md(["a", "b"]))).toHaveLength(2);
    expect(changedStepNumbers(md(["a", "b", "c"]), md(["a", "B", "c", "d"]))).toEqual([2, 4]);
    expect(changedStepNumbers(md(["a", "b"]), md(["a"]))).toEqual([2]);
    expect(changedStepNumbers(null, md(["a"]))).toEqual([1]);
  });
});
