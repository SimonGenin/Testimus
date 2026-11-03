import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { nodeSpawnClaude } from "../../src/core/env.ts";
import { startJob } from "../../src/core/jobs.ts";
import { onParentGone, onStopSignals, shellOf, stopCore } from "../../src/core/shell.ts";
import type { JobEvent } from "../../src/core/types.ts";
import { killTreeSync as killTree, liveChildren } from "../../src/shared/run/process.ts";

const SLEEPER = "setInterval(() => {}, 1000)";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(test: () => boolean, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

function lastStatus(project: string, id: string): Extract<JobEvent, { type: "status" }>["job"] {
  const lines = readFileSync(join(project, ".testimus", "jobs", `${id}.jsonl`), "utf8")
    .trim()
    .split("\n");
  const statuses = lines.map((l) => JSON.parse(l) as JobEvent).filter((e) => e.type === "status");
  const last = statuses[statuses.length - 1];
  if (last?.type !== "status") throw new Error("no status");
  return last.job;
}

function claudeJob(project: string) {
  const before = new Set(liveChildren());
  const started = startJob("generate", "all", project, (ctx) =>
    nodeSpawnClaude({ exe: process.execPath, args: ["-e", SLEEPER], cwd: project, stdin: "", signal: ctx.signal }),
  );
  return { ...started, child: () => liveChildren().find((p) => !before.has(p)) };
}

const leftovers: number[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0)) if (alive(pid)) killTree(pid);
});

describe("shellOf", () => {
  it("names the face from TESTIMUS_SHELL", () => {
    expect(shellOf("desktop/0.2.0")).toEqual({ face: "desktop", version: "0.2.0", label: "desktop 0.2.0" });
    expect(shellOf(undefined)).toEqual({ face: "browser", label: "browser" });
    expect(shellOf("")).toEqual({ face: "browser", label: "browser" });
    expect(shellOf("not a shell; rm")).toEqual({ face: "browser", label: "browser" });
  });
});

describe("killTree", () => {
  it("kills a child and its own children", async () => {
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `const c = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(SLEEPER)}]); console.log(c.pid); ${SLEEPER}`,
      ],
      { windowsHide: true },
    );
    const grandchild = await new Promise<number>((r) =>
      parent.stdout.setEncoding("utf8").once("data", (d: string) => r(Number(d.trim()))),
    );
    leftovers.push(parent.pid as number, grandchild);
    expect(alive(grandchild)).toBe(true);
    killTree(parent.pid as number);
    await until(() => !alive(parent.pid as number) && !alive(grandchild));
  });
});

describe("stopCore", () => {
  it("cancels running jobs, logs them cancelled, kills their claude and exits 0", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-stop-"));
    const run = claudeJob(project);
    await until(() => !!run.child());
    const pid = run.child() as number;
    leftovers.push(pid);
    const exits: number[] = [];
    let closed = false;
    const stopped = await stopCore({ closeServer: () => (closed = true), exit: (c) => exits.push(c), graceMs: 3000 });
    expect(closed).toBe(true);
    expect(exits).toEqual([0]);
    expect(stopped.jobs.map((j) => [j.id, j.status])).toEqual([[run.job.id, "cancelled"]]);
    expect(lastStatus(project, run.job.id).status).toBe("cancelled");
    await until(() => !alive(pid));
    expect(liveChildren()).not.toContain(pid);
  });

  it("logs a job that ignores its signal as cancelled once the grace is over", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-stop-"));
    const { job } = startJob("rag-index", "all", project, () => new Promise(() => {}));
    const exits: number[] = [];
    const stopped = await stopCore({ exit: (c) => exits.push(c), graceMs: 150 });
    expect(exits).toEqual([0]);
    expect(stopped.jobs[0]).toMatchObject({ id: job.id, status: "cancelled", error: "Stopped with Testimus." });
    expect(lastStatus(project, job.id).status).toBe("cancelled");
  });

  it("kills a claude started outside any job", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-stop-"));
    const before = new Set(liveChildren());
    const done = nodeSpawnClaude({ exe: process.execPath, args: ["-e", SLEEPER], cwd: project, stdin: "" });
    await until(() => liveChildren().some((p) => !before.has(p)));
    const pid = liveChildren().find((p) => !before.has(p)) as number;
    leftovers.push(pid);
    const stopped = await stopCore({ exit: () => {}, graceMs: 1000 });
    expect(stopped.killed).toContain(pid);
    await done;
    expect(alive(pid)).toBe(false);
  });
});

describe("what triggers the stop", () => {
  it("stdin closing (the shell died or quit) stops the core", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-stop-"));
    const run = claudeJob(project);
    await until(() => !!run.child());
    const pid = run.child() as number;
    leftovers.push(pid);
    const stdin = new PassThrough();
    const exits: number[] = [];
    let stopping: Promise<unknown> | null = null;
    onParentGone(stdin, () => {
      stopping ??= stopCore({ exit: (c) => exits.push(c), graceMs: 3000 });
    });
    stdin.end();
    await until(() => !!stopping);
    await stopping;
    expect(exits).toEqual([0]);
    expect(lastStatus(project, run.job.id).status).toBe("cancelled");
    await until(() => !alive(pid));
  });

  it("SIGTERM, SIGINT, SIGBREAK and SIGHUP stop the core the same way", async () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-stop-"));
    const run = claudeJob(project);
    await until(() => !!run.child());
    const pid = run.child() as number;
    leftovers.push(pid);
    const seen: string[] = [];
    let stopping: Promise<unknown> | null = null;
    const exits: number[] = [];
    const signals = ["SIGTERM", "SIGINT", "SIGBREAK", "SIGHUP"] as const;
    const before = new Map(signals.map((s) => [s, new Set(process.listeners(s))]));
    const off = onStopSignals((s) => {
      seen.push(s);
      stopping ??= stopCore({ exit: (c) => exits.push(c), graceMs: 3000 });
    });
    try {
      for (const s of signals)
        for (const fn of process.listeners(s)) if (!before.get(s)?.has(fn)) (fn as (s: NodeJS.Signals) => void)(s);
    } finally {
      off();
    }
    for (const s of signals) expect(process.listeners(s).length).toBe(before.get(s)?.size);
    expect(seen).toEqual(["SIGTERM", "SIGINT", "SIGBREAK", "SIGHUP"]);
    await stopping;
    expect(exits).toEqual([0]);
    expect(lastStatus(project, run.job.id).status).toBe("cancelled");
    await until(() => !alive(pid));
  });
});
