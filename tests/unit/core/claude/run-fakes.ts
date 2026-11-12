import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { GEN_MARKER } from "../../../../src/core/claude/gen-prompt.ts";
import { PLAN_TAG, REPORT_TAG } from "../../../../src/core/claude/gen-reply.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { answerCheck, type CheckAnswer, line, recordCall, resultLine, toolLine } from "../../helpers/fake-check.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

export { checkedIn, isCheck } from "../../helpers/fake-check.ts";
export { line };

// ponytail: the fake claude and the fixture copy the Claude-run tests share (one project per test)
export const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
export const real = env.spawnClaude;
export const win = process.platform === "win32";

export let dir: string;
export let seen: ClaudeSpawn[] = [];
export let probes: ClaudeSpawn[] = [];

export const tool = toolLine;
export const toolResult = (id: string, text: string) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] },
  });
export const result = resultLine;

export type Script = {
  lines?: (s: ClaudeSpawn) => string[] | Promise<string[]>;
  during?: (s: ClaudeSpawn) => void | Promise<void>;
  out?: Partial<ClaudeOut>;
};

export function fake(pick: (s: ClaudeSpawn) => Script) {
  env.spawnClaude = async (s) => {
    if (s.args.includes("--version")) {
      probes.push(s);
      return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    }
    seen.push(s);
    const sc = pick(s);
    await sc.during?.(s);
    const ls = (await sc.lines?.(s)) ?? [result("ok")];
    for (const l of ls) s.onLine?.(l);
    return { code: 0, stdout: `${ls.join("\n")}\n`, stderr: "", ...sc.out };
  };
}

/** a check request answered as the check-test skill does: every test it names recorded with a verdict per step */
export const checked = (o: CheckAnswer = {}): Script => ({ lines: (s) => answerCheck(s, o) });

export const isGen = (s: ClaudeSpawn): boolean => s.stdin.startsWith(GEN_MARKER);
/** the block a generation run ends its reply with (claude/gen-reply.ts): without one, the run is asked for it again */
export const reportBlock = (o: unknown = { tests: [], skipped: [] }): string =>
  `\`\`\`${REPORT_TAG}\n${JSON.stringify(o)}\n\`\`\``;
export const planBlock = (o: unknown): string => `\`\`\`${PLAN_TAG}\n${JSON.stringify(o)}\n\`\`\``;
/** a generation run that wrote nothing and says so */
export const reported = (o: unknown = { tests: [], skipped: [] }): Script => ({
  lines: () => [result(reportBlock(o))],
});

export const idIn = (s: ClaudeSpawn) => /skill on the test ([\w.-]+)\./.exec(s.stdin)?.[1] ?? "";
/** the stream line of a check_record call alone: nothing is recorded by it */
export const recordLine = recordCall;
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
  probes = [];
});
afterEach(() => {
  env.spawnClaude = real;
  delete process.env.TESTIMUS_IN_CLAUDE;
  delete process.env.TESTIMUS_HOME_BIN;
  delete process.env.TESTIMUS_WITHOUT_DOCS;
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
