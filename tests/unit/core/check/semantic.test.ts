import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let P = "";
let seen: ClaudeSpawn[] = [];

type Out = { semantic: "done" | "skipped"; why?: string; tests: { id: string; ok: boolean }[]; failed: string[] };

function claude(present: boolean) {
  env.spawnClaude = async (s) => {
    seen.push(s);
    if (!present) throw new Error("spawn claude ENOENT");
    if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    const id = /skill on the test ([\w.-]+)\./.exec(s.stdin)?.[1];
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t", name: "mcp__testimus__check_record", input: { id } }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "0 findings", session_id: "s" }),
    ];
    for (const l of lines) s.onLine?.(l);
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  };
}

const runs = () => seen.filter((s) => !s.args.includes("--version"));

beforeEach(() => {
  P = fixtureCopy("check-semantic");
  seen = [];
  resetProbe();
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "claude" } });
});
afterEach(() => {
  env.spawnClaude = real;
  delete process.env.TESTIMUS_IN_CLAUDE;
  resetProbe();
});

describe("check.run decides the semantic pass itself (GOAL-V3 N1)", () => {
  it("with Claude connected, runs the check-test skill and says so", async () => {
    claude(true);
    const out = await call<Out>("check.run", { ids: ["LFRPS12-1420"] }, P);
    expect(out.semantic).toBe("done");
    expect(out.why).toBeUndefined();
    expect(runs()).toHaveLength(1);
    expect(out.failed).toEqual([]);
  });

  it("without Claude, falls back to the mechanical pass and says why — nothing fails", async () => {
    claude(false);
    const out = await call<Out>("check.run", { ids: ["LFRPS12-1420"] }, P);
    expect(out).toMatchObject({ semantic: "skipped", why: "Claude Code is not connected: mechanical pass only." });
    expect(out.failed).toEqual([]);
    expect(out.tests[0].ok).toBe(true);
    expect(runs()).toEqual([]);
  });

  it("semantic: false is the mechanical pass only, without asking Claude anything", async () => {
    claude(true);
    const out = await call<Out>("check.run", { ids: ["LFRPS12-1420"], semantic: false }, P);
    expect(out).toMatchObject({ semantic: "skipped", why: "Mechanical pass only, as asked." });
    expect(seen).toEqual([]);
  });

  it("semantic: true runs the skill even when Claude is missing: each test says its check did not finish", async () => {
    claude(false);
    const out = await call<Out>("check.run", { ids: ["LFRPS12-1420"], semantic: true }, P);
    expect(out.semantic).toBe("done");
    expect(out.failed).toEqual(["LFRPS12-1420"]);
  });

  it("called from inside a Claude run, Claude is the semantic checker: mechanical pass only", async () => {
    claude(true);
    process.env.TESTIMUS_IN_CLAUDE = "1";
    const out = await call<Out>("check.run", { ids: ["LFRPS12-1420"] }, P);
    expect(out).toMatchObject({ semantic: "skipped", why: "Called from a Claude run: mechanical pass only." });
    expect(seen).toEqual([]);
  });
});
