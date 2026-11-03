import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/jobs.ts";
import { env } from "../../../../src/core/env.ts";
import { cancelJob, jobNotice, listJobs, showJob, startJob, subscribe, waitJob } from "../../../../src/core/jobs.ts";
import { loopbackProxyGap, stopCore } from "../../../../src/core/shell.ts";
import type { Job } from "../../../../src/core/types.ts";
import { withLoopback } from "../../../../src/shared/loopback.ts";
import { tempRoot } from "../../cov-faces-helpers.ts";

const root = tempRoot("jobs");

function writeLog(dir: string, id: string, lines: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), lines.join("\n"));
}

const run = (name: string, input: unknown, project: string) => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(name);
  return c.run(quietCtx(project), c.input.parse(input) as never);
};

const status = (job: Partial<Job> & { id: string }) =>
  JSON.stringify({
    jobId: job.id,
    at: "x",
    type: "status",
    job: { kind: "k", subject: "s", startedAt: "2026-01-01", ...job },
  });

describe("jobs on disk", () => {
  it("reads a job back from its log, marking a dead running one interrupted", () => {
    const project = join(root, "p1");
    const dir = join(project, ".testimus", "jobs");
    writeLog(dir, "dead-1", ["", "not json", status({ id: "dead-1", status: "running", pid: 2 ** 30 })]);
    writeLog(dir, "self-1", [status({ id: "self-1", status: "running", pid: process.pid, startedAt: "2026-01-03" })]);
    writeLog(dir, "nopid-1", [status({ id: "nopid-1", status: "running", startedAt: "2026-01-02" })]);
    writeLog(dir, "alive-1", [
      status({ id: "alive-1", status: "running", pid: process.ppid, startedAt: "2026-01-04" }),
    ]);
    writeLog(dir, "done-1", [
      status({ id: "done-1", status: "running" }),
      status({ id: "done-1", status: "done", startedAt: "2025-12-31" }),
    ]);
    writeLog(dir, "empty-1", [JSON.stringify({ jobId: "empty-1", type: "log", level: "info", message: "m" })]);
    writeFileSync(join(dir, "readme.txt"), "not a log");
    expect(showJob(project, "dead-1")?.job).toMatchObject({
      status: "failed",
      error: "Interrupted (the app stopped).",
    });
    expect(showJob(project, "dead-1")?.events).toHaveLength(1);
    expect(showJob(project, "self-1")?.job.status).toBe("failed");
    expect(showJob(project, "nopid-1")?.job.status).toBe("failed");
    expect(showJob(project, "alive-1")?.job.status).toBe("running");
    expect(showJob(project, "done-1")?.job.status).toBe("done");
    expect(showJob(project, "empty-1")).toBeNull();
    const ids = listJobs(project).map((j) => j.id);
    expect(ids).toEqual(["alive-1", "self-1", "nopid-1", "dead-1", "done-1"]);
    expect(listJobs(join(root, "nothing-here"))).toEqual([]);
  });

  it("refuses an id that is not a plain name and falls back to the machine's jobs", () => {
    const project = join(root, "p2");
    expect(showJob(project, "../x")).toBeNull();
    writeLog(join(env.localDir(), "jobs"), "machine-1", [status({ id: "machine-1", status: "done" })]);
    expect(showJob(project, "machine-1")?.job.status).toBe("done");
    expect(showJob(null, "machine-1")?.job.status).toBe("done");
    expect(showJob(null, "nowhere-1")).toBeNull();
    expect(showJob(project, "nowhere-1")).toBeNull();
  });
});

describe("live jobs", () => {
  it("keeps the last 2000 events, survives an unwritable log folder, and records a non-Error failure", async () => {
    const file = join(root, "a-file");
    writeFileSync(file, "x");
    const { job, done } = startJob("chatty", "s", file, async (ctx) => {
      for (let i = 0; i < 2005; i++) ctx.progress({ message: `m${i}` });
      throw "text failure";
    });
    await expect(done).rejects.toBe("text failure");
    expect(job.status).toBe("failed");
    expect(job.error).toBe("text failure");
    expect(job.progress).toBeUndefined();
    const shown = showJob(file, job.id);
    expect(shown?.events).toHaveLength(2000);
    expect(cancelJob(job.id)).toBe(false);
    expect(await waitJob("never-started")).toBeUndefined();
  });

  it("is listed for its own project and hidden from another", async () => {
    const mine = join(root, "mine");
    let release = () => {};
    const { job, done } = startJob("hold", "s", mine, () => new Promise<void>((r) => (release = r)));
    expect(listJobs(mine).map((j) => j.id)).toContain(job.id);
    expect(listJobs(join(root, "theirs")).map((j) => j.id)).not.toContain(job.id);
    expect(showJob(join(root, "theirs"), job.id)).toBeNull();
    expect(cancelJob(job.id, join(root, "theirs"))).toBe(false);
    expect(cancelJob(job.id, mine)).toBe(true);
    release();
    await done;
    expect(job.status).toBe("cancelled");
  });

  it("is cancelled by its caller's signal and logs Claude events", async () => {
    const outer = new AbortController();
    const { job, done } = startJob(
      "outer",
      "s",
      null,
      (ctx) =>
        new Promise((r) => {
          ctx.log("warn", "w");
          ctx.claude({ type: "text", text: "t" });
          ctx.signal.addEventListener("abort", () => r("stopped"));
        }),
      outer.signal,
    );
    outer.abort();
    expect(await waitJob(job.id)).toBe("stopped");
    await done;
    expect(job.status).toBe("cancelled");
    expect(showJob(null, job.id)?.events.map((e) => e.type)).toEqual(["status", "log", "claude", "status"]);
  });

  it("trusts a result that says whether it was cancelled", async () => {
    const a = startJob("said", "s", null, async () => ({ cancelled: true }));
    await a.done;
    expect(a.job.status).toBe("cancelled");
    const b = startJob("said", "s", null, async (ctx) => {
      ctx.progress({ message: "x", total: 1 });
      return { cancelled: false };
    });
    await b.done;
    expect(b.job.status).toBe("done");
    expect(b.job.progress).toEqual({ done: 0, total: 1 });
  });
});

describe("jobNotice", () => {
  it("does nothing outside a job", () => {
    expect(jobNotice("waiting")).toBeUndefined();
  });

  it("shows a notice in the job's line, keeping its bar, and puts the line back if still its own", async () => {
    const messages: string[] = [];
    const { job, done } = startJob("notice", "s", null, async (ctx) => {
      await Promise.resolve();
      ctx.progress({ message: "step 1", done: 1, total: 3 });
      const back = jobNotice("Jira asks to wait");
      messages.push(job.message ?? "");
      back?.();
      messages.push(job.message ?? "");
      const plain = jobNotice("again");
      ctx.progress({ message: "moved on", done: 2, total: 3 });
      plain?.();
      messages.push(job.message ?? "");
      return null;
    });
    await done;
    expect(messages).toEqual(["Jira asks to wait", "step 1", "moved on"]);
    expect(job.progress).toEqual({ done: 2, total: 3 });
    let restore: (() => void) | undefined;
    const bare = startJob("notice", "s", null, async () => {
      restore = jobNotice("no bar");
      return null;
    });
    await bare.done;
    restore?.();
    expect(bare.job.message).toBe("no bar");
  });
});

describe("jobs commands", () => {
  it("lists, filters, shows and cancels", async () => {
    const project = join(root, "cmd");
    const seen: string[] = [];
    const unsub = subscribe((e) => seen.push(e.type));
    let release = () => {};
    const { job, done } = startJob("hold", "s", project, () => new Promise<void>((r) => (release = r)));
    const finished = startJob("quick", "s", project, async () => null);
    await finished.done;
    const all = (await run("jobs.list", {}, project)) as Job[];
    expect(all.map((j) => j.id)).toEqual(expect.arrayContaining([job.id, finished.job.id]));
    const running = (await run("jobs.list", { running: true }, project)) as Job[];
    expect(running.map((j) => j.id)).toContain(job.id);
    expect(running.map((j) => j.id)).not.toContain(finished.job.id);
    expect(((await run("jobs.show", { id: job.id }, project)) as { job: Job }).job.id).toBe(job.id);
    await expect(run("jobs.show", { id: "missing-1" }, project)).rejects.toThrow("No job missing-1.");
    expect(await run("jobs.cancel", { id: job.id }, project)).toEqual({ cancelled: true });
    release();
    await done;
    unsub();
    expect(seen).toContain("status");
  });
});

describe("shell helpers", () => {
  it("adds the loopback to NO_PROXY", () => {
    expect(withLoopback(undefined)).toBe("localhost,127.0.0.1,::1");
    expect(withLoopback("  ")).toBe("localhost,127.0.0.1,::1");
    expect(withLoopback("corp")).toBe("corp,localhost,127.0.0.1,::1");
    expect(withLoopback("localhost,127.0.0.1,::1")).toBe("localhost,127.0.0.1,::1");
  });

  it("finds a proxy gap when NO_PROXY is unset or partial", () => {
    expect(loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", http_proxy: "http://p" })).toContain(
      "localhost, 127.0.0.1, ::1",
    );
    expect(
      loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://p", no_proxy: "localhost,127.0.0.1,[::1]" }),
    ).toBeNull();
    expect(loopbackProxyGap({ NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://p", NO_PROXY: "*" })).toBeNull();
  });

  it("forces exit 1 when a step blocks past the deadline", async () => {
    const exits: number[] = [];
    await stopCore({
      graceMs: 0,
      exit: (c) => exits.push(c),
      closeServer: () => {
        const end = Date.now() + 1100;
        while (Date.now() < end) {}
      },
    });
    expect(exits).toEqual([1, 0]);
  });

  it("stops with the default grace, and exits 1 when a step throws", async () => {
    const exits: number[] = [];
    const ok = await stopCore({ exit: (c) => exits.push(c) });
    expect(ok.jobs.every((j) => j.status !== "running")).toBe(true);
    expect(exits).toEqual([0]);
    const writes: string[] = [];
    const write = process.stderr.write;
    process.stderr.write = ((s: string) => {
      writes.push(s);
      return true;
    }) as typeof process.stderr.write;
    try {
      const bad = await stopCore({
        exit: (c) => exits.push(c),
        closeServer: () => {
          throw new Error("close failed");
        },
      });
      expect(bad).toEqual({ jobs: [], killed: [] });
      await stopCore({
        exit: (c) => exits.push(c),
        closeServer: () => {
          throw "close text";
        },
      });
    } finally {
      process.stderr.write = write;
    }
    expect(exits).toEqual([0, 1, 1]);
    expect(writes.join("")).toContain("Stopping Testimus: close failed\n");
    expect(writes.join("")).toContain("Stopping Testimus: close text\n");
  });
});
