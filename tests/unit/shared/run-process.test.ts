import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAlive,
  killChildren,
  liveChildren,
  resolveExe,
  run,
  start,
  unsafeShimArgument,
} from "../../../src/shared/run/process.ts";
import { sleep } from "../../../src/shared/run/work.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "run");
const tree = (mode: string) => [join(FIXTURES, "tree.mjs"), mode];
type Pids = { child: number; grandchild: number };

async function gone(...pids: number[]): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (pids.every((p) => !isAlive(p))) return true;
    await sleep(50);
  }
  return false;
}

function firstLine(): { onLine(line: string): void; pids: Promise<Pids> } {
  let found: (p: Pids) => void = () => {};
  const pids = new Promise<Pids>((r) => {
    found = r;
  });
  return {
    onLine: (line) => {
      if (line.startsWith("{")) found(JSON.parse(line) as Pids);
    },
    pids,
  };
}

describe("process: the whole tree goes, whatever ends it", () => {
  it("a normal end takes the grandchild with it", async () => {
    const seen = firstLine();
    const exit = await run({ exe: process.execPath, args: tree("exit"), onLine: seen.onLine });
    const { child, grandchild } = await seen.pids;
    expect(exit).toMatchObject({ code: 0, cancelled: false, timedOut: false });
    expect(await gone(child, grandchild)).toBe(true);
    expect(liveChildren()).not.toContain(child);
  });

  it("an error exit keeps its code and stderr, and leaves nothing", async () => {
    const lines: string[] = [];
    const seen = firstLine();
    const exit = await run({
      exe: process.execPath,
      args: tree("fail"),
      onLine: (l, stream) => {
        lines.push(`${stream}:${l}`);
        seen.onLine(l);
      },
    });
    const { child, grandchild } = await seen.pids;
    expect(exit.code).toBe(3);
    expect(exit.stderr).toContain("it went wrong");
    expect(lines).toContain("stderr:it went wrong");
    expect(await gone(child, grandchild)).toBe(true);
  });

  it("a cancel kills the tree and says so", async () => {
    const ctl = new AbortController();
    const seen = firstLine();
    const p = start({ exe: process.execPath, args: tree("hang"), signal: ctl.signal, onLine: seen.onLine });
    const { child, grandchild } = await seen.pids;
    expect(p.pid).toBe(child);
    expect(liveChildren()).toContain(child);
    ctl.abort();
    const exit = await p.exited;
    expect(exit.cancelled).toBe(true);
    expect(exit.code).not.toBe(0);
    expect(await gone(child, grandchild)).toBe(true);
  });

  it("a timeout kills the tree and says so", async () => {
    const seen = firstLine();
    const exit = await run({ exe: process.execPath, args: tree("hang"), timeoutMs: 1500, onLine: seen.onLine });
    const { child, grandchild } = await seen.pids;
    expect(exit).toMatchObject({ timedOut: true, cancelled: false });
    expect(await gone(child, grandchild)).toBe(true);
  });

  it("the parent's stdin closing takes every child tree it started with it", async () => {
    const seen = firstLine();
    const parent = start({
      exe: process.execPath,
      args: [join(FIXTURES, "parent.ts")],
      keepStdin: true,
      onLine: seen.onLine,
    });
    const { child, grandchild } = await seen.pids;
    expect(isAlive(grandchild)).toBe(true);
    parent.end();
    const exit = await parent.exited;
    expect(exit.code).toBe(0);
    expect(await gone(parent.pid as number, child, grandchild)).toBe(true);
  });

  it("killChildren stops every live tree", async () => {
    const seen = firstLine();
    const p = start({ exe: process.execPath, args: tree("hang"), onLine: seen.onLine });
    const { child, grandchild } = await seen.pids;
    expect(killChildren()).toContain(child);
    await p.exited;
    expect(await gone(child, grandchild)).toBe(true);
  });
});

describe("process: input, output and refusals", () => {
  it("writes stdin and reads stdout line by line, keeping stdin open when asked", async () => {
    const lines: string[] = [];
    const p = start({ exe: process.execPath, args: tree("echo"), keepStdin: true, onLine: (l) => lines.push(l) });
    p.write("one\n");
    p.write("two\n");
    p.end();
    const exit = await p.exited;
    expect(exit.code).toBe(0);
    expect(lines.slice(1)).toEqual(["echo:one", "echo:two"]);
    expect(exit.stdout).toContain("echo:two");
  });

  it("passes the prompt on stdin and closes it", async () => {
    const exit = await run({
      exe: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      stdin: "a prompt",
    });
    expect(exit.stdout).toBe("a prompt");
  });

  it("never starts a program whose signal is already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const p = start({ exe: process.execPath, args: tree("hang"), signal: ctl.signal });
    expect(p.pid).toBeUndefined();
    expect(await p.exited).toMatchObject({ code: 130, cancelled: true });
  });

  it("reports a program that cannot start", async () => {
    const exit = await run({ exe: "/nonexistent/testimus-nothing", args: [] });
    expect(exit.code).not.toBe(0);
    expect(exit.error).toMatch(/ENOENT/);
  });

  it("refuses a cmd metacharacter in an argument passed through a .cmd shim", () => {
    expect(unsafeShimArgument("C:\\bin\\claude.cmd", ["-p", "--model", "opus"])).toBeNull();
    expect(unsafeShimArgument("C:\\bin\\claude.cmd", ['"C:\\a b\\x"'])).toBeNull();
    expect(unsafeShimArgument("C:\\bin\\claude.cmd", ["a & calc"])).toBe("a & calc");
    expect(unsafeShimArgument("C:\\bin\\claude.cmd", ["100%"])).toBe("100%");
  });

  it("leaves a path or an explicit extension as it is", () => {
    expect(resolveExe("/usr/bin/env")).toBe("/usr/bin/env");
    expect(resolveExe("claude.exe")).toBe("claude.exe");
  });
});
