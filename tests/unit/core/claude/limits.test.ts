import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mcpWorker } from "../../../../src/core/claude/limits.ts";
import { isAlive, liveChildren } from "../../../../src/shared/run/process.ts";

const saved = process.env.TESTIMUS_HOME_BIN;
afterEach(() => {
  if (saved === undefined) delete process.env.TESTIMUS_HOME_BIN;
  else process.env.TESTIMUS_HOME_BIN = saved;
});

// ponytail: a stand-in for `testimus mcp` — answers every JSON-RPC request at once, or never when told to hang
function fakeServer(mode: "answer" | "exit"): string {
  const dir = mkdtempSync(join(tmpdir(), "testimus-limits-"));
  const exe = join(dir, "testimus.exe");
  const body =
    mode === "exit"
      ? "process.exit(3);"
      : `let buf = "";
process.stdin.setEncoding("utf8").on("data", (d) => {
  buf += d;
  for (let i = buf.indexOf("\\n"); i >= 0; i = buf.indexOf("\\n")) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (typeof m.id === "number") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: {} }) + "\\n");
  }
});`;
  writeFileSync(exe, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(exe, 0o755);
  return exe;
}

describe.skipIf(process.platform === "win32")("the agents probe's MCP worker (a real process)", () => {
  it("is a child of the run layer while it runs, and is gone once stopped", async () => {
    process.env.TESTIMUS_HOME_BIN = fakeServer("answer");
    const before = liveChildren();
    const w = mcpWorker(tmpdir(), 5);
    await w.ready;
    expect(w.failure()).toBeNull();
    expect(w.searches(0).length).toBeGreaterThan(0);
    const mine = liveChildren().filter((p) => !before.includes(p));
    expect(mine).toHaveLength(1);
    await w.stop();
    expect(liveChildren()).not.toContain(mine[0]);
    expect(isAlive(mine[0])).toBe(false);
  });

  it("a server that exits says so, and leaves no child behind", async () => {
    process.env.TESTIMUS_HOME_BIN = fakeServer("exit");
    const before = liveChildren();
    const w = mcpWorker(tmpdir(), 5);
    await w.ready;
    expect(w.failure()).toBe("the Testimus MCP server stopped (exit code 3)");
    expect(liveChildren().filter((p) => !before.includes(p))).toEqual([]);
  });

  it("a server that cannot start says so", async () => {
    process.env.TESTIMUS_HOME_BIN = join(tmpdir(), "no-such-dir", "testimus.exe");
    const w = mcpWorker(tmpdir(), 5);
    await w.ready;
    expect(w.failure()).toMatch(/^the Testimus MCP server did not start: /);
  });
});
