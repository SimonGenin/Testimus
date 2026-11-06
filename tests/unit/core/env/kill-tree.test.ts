import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeSpawnClaude } from "../../../../src/core/env.ts";
import { cancelJob, startJob } from "../../../../src/core/jobs.ts";

const root = mkdtempSync(join(tmpdir(), "testimus-kill-tree-"));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const parent = (detachGrandchild: boolean) =>
  [
    "const { spawn } = require('node:child_process');",
    `const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${detachGrandchild} });`,
    "process.stdout.write(g.pid + '\\n');",
    "setInterval(() => {}, 1000);",
  ].join("");

const leftovers: number[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0))
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
});

describe("a cancelled Claude run takes its whole process tree with it, on every platform", () => {
  for (const detached of [false, true])
    it(`kills a grandchild${detached ? " that left the process group" : ""} when the run is cancelled`, async () => {
      const ctrl = new AbortController();
      let grandchild = 0;
      const r = await nodeSpawnClaude({
        exe: process.execPath,
        args: ["-e", parent(detached)],
        cwd: root,
        stdin: "",
        signal: ctrl.signal,
        onLine: (l) => {
          grandchild = Number(l);
          leftovers.push(grandchild);
          expect(alive(grandchild)).toBe(true);
          ctrl.abort();
        },
      });
      expect(r.code).not.toBe(0);
      expect(grandchild).toBeGreaterThan(0);
      await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5000 });
    });

  it("kills the tree when the job running Claude is cancelled", async () => {
    let grandchild = 0;
    const { job, done } = startJob("claude", "kill-tree", root, (ctx) =>
      nodeSpawnClaude({
        exe: process.execPath,
        args: ["-e", parent(false)],
        cwd: root,
        stdin: "",
        signal: ctx.signal,
        onLine: (l) => {
          grandchild = Number(l);
          leftovers.push(grandchild);
        },
      }),
    );
    await vi.waitFor(() => expect(grandchild).toBeGreaterThan(0), { timeout: 5000 });
    cancelJob(job.id);
    await done.catch(() => {});
    await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5000 });
  });
});
