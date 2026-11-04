import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

// ponytail: the fake claude and the fixture copy the Claude-run tests share (one project per test)
export const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
export const real = env.spawnClaude;
export const win = process.platform === "win32";

export let dir: string;
export let seen: ClaudeSpawn[] = [];

export const line = (m: unknown) => JSON.stringify(m);
export const tool = (name: string, input: unknown, id = `t-${Math.random().toString(16).slice(2)}`) =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
export const toolResult = (id: string, text: string) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] },
  });
export const result = (r: string, isError = false) =>
  line({ type: "result", subtype: "success", is_error: isError, result: r, session_id: "s-1", duration_ms: 5 });

export type Script = {
  lines?: (s: ClaudeSpawn) => string[];
  during?: (s: ClaudeSpawn) => void;
  out?: Partial<ClaudeOut>;
};

export function fake(pick: (s: ClaudeSpawn) => Script) {
  env.spawnClaude = async (s) => {
    if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    seen.push(s);
    const sc = pick(s);
    sc.during?.(s);
    const ls = sc.lines?.(s) ?? [result("ok")];
    for (const l of ls) s.onLine?.(l);
    return { code: 0, stdout: `${ls.join("\n")}\n`, stderr: "", ...sc.out };
  };
}

export const idIn = (s: ClaudeSpawn) => /skill on the test ([\w.-]+)\./.exec(s.stdin)?.[1] ?? "";
export const recordLine = (id: string) => tool("mcp__testimus__check_record", { id, findings: [] });
export const isCheck = (s: ClaudeSpawn) => s.stdin.includes("Use the check-test skill");
export const argOf = (s: ClaudeSpawn, flag: string) => s.args[s.args.indexOf(flag) + 1] ?? "";
export const allowed = (s: ClaudeSpawn) => argOf(s, "--allowedTools").split(",");
export const denied = (s: ClaudeSpawn) => argOf(s, "--disallowedTools").split(",");
export const testFile = (id: string) => join(dir, "tests", id, "test.md");
export const setReviewLine = (id: string, review: string) =>
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

export const NEVER = [
  "xray_push",
  "xray_pull",
  "review_set",
  "review_fix",
  "system_setCredentials",
  "system_credentials",
  "system_set",
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
