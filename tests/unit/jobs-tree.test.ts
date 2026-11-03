import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UserError } from "../../src/core/command.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { clearJobs, listJobs, showJob, startJob, waitJob, withProcess } from "../../src/core/jobs.ts";
import type { JobEvent } from "../../src/core/types.ts";
import { tempRoot } from "./cov-faces-helpers.ts";

const root = tempRoot("jobs-tree");
let n = 0;
const project = () => {
  const p = join(root, `p${++n}`);
  mkdirSync(p, { recursive: true });
  return p;
};

describe("a job's steps", () => {
  it("declares its steps, runs them in order, skips the unneeded and tags its events", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      ctx.steps?.([
        { id: "a", label: "First" },
        { id: "b", label: "Second" },
        { id: "c", label: "Third" },
      ]);
      ctx.step?.("a");
      ctx.progress({ message: "half", done: 1, total: 2 });
      ctx.log("info", "in a");
      ctx.step?.("c");
      ctx.step?.("c");
      ctx.step?.("d", "Extra");
      return {};
    });
    await done;
    expect(job.steps?.map((s) => [s.id, s.status])).toEqual([
      ["a", "done"],
      ["b", "skipped"],
      ["c", "done"],
      ["d", "done"],
    ]);
    expect(job.steps?.[0]).toMatchObject({ done: 1, total: 2, message: "half" });
    expect(job.steps?.[3].label).toBe("Extra");
    const events = showJob(p, job.id)?.events ?? [];
    expect(events.find((e) => e.type === "log")).toMatchObject({ step: "a" });
    expect(events.some((e) => e.type === "steps")).toBe(true);
  });

  it("marks the running step failed, keeps the command's fix and leaves the rest waiting", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      ctx.steps?.([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]);
      ctx.step?.("a");
      throw new UserError("broke", "do this");
    });
    await done.catch(() => {});
    expect(job).toMatchObject({ status: "failed", error: "broke", fix: "do this" });
    expect(job.steps?.map((s) => s.status)).toEqual(["failed", "waiting"]);
  });
});

describe("jobs inside jobs", () => {
  it("gives a job started inside another its parent, and the step that carries it", async () => {
    const p = project();
    let child = "";
    const { job, done } = startJob("parent", "s", p, async (ctx) => {
      ctx.step?.("sub", "Sub job");
      const inner = startJob("child", "c", p, async () => ({}));
      child = inner.job.id;
      await inner.done;
      return {};
    });
    await done;
    expect(showJob(p, child)?.job.parentId).toBe(job.id);
    expect(job.steps?.[0].jobId).toBe(child);
  });

  it("records the cause and how to run it again through invoke", async () => {
    const p = project();
    const r = (await invoke(
      "jobs.list",
      {},
      { project: p, cause: { jobId: "x-00000000", why: "retry" } },
    )) as unknown[];
    expect(Array.isArray(r)).toBe(true);
    const { job, done } = startJob("k", "s", p, async () => ({}), undefined, {
      cause: { jobId: "x-00000000", why: "after-failure" },
      rerun: { name: "rag.index", input: {} },
    });
    await done;
    expect(showJob(p, job.id)?.job).toMatchObject({
      cause: { jobId: "x-00000000", why: "after-failure" },
      rerun: { name: "rag.index", input: {} },
    });
  });
});

describe("processes", () => {
  it("records a program the job runs, its pid, exit and step, and tags its Claude events", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      ctx.step?.("run", "Run");
      await withProcess(
        "Claude · write",
        "claude -p",
        async (pid) => {
          pid(4242);
          ctx.claude({ type: "text", text: "hi" });
          return { code: 0 };
        },
        (r) => r.code,
      );
      return {};
    });
    await done;
    expect(job.processes).toEqual([
      expect.objectContaining({ id: "p1", label: "Claude · write", pid: 4242, step: "run", exit: 0 }),
    ]);
    const claude = (showJob(p, job.id)?.events ?? []).find(
      (e): e is Extract<JobEvent, { type: "claude" }> => e.type === "claude",
    );
    expect(claude).toMatchObject({ process: "p1", step: "run" });
  });

  it("ends a process that threw with no exit code, and runs plainly outside a job", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async () => {
      await withProcess(
        "x",
        "x",
        async () => {
          throw new Error("no");
        },
        () => 0,
      ).catch(() => {});
      return {};
    });
    await done;
    expect(job.processes?.[0]).toMatchObject({ exit: null });
    expect(
      await withProcess(
        "y",
        "y",
        async () => 7,
        () => 0,
      ),
    ).toBe(7);
  });
});

describe("clearing and interruptions", () => {
  it("forgets finished jobs and deletes their logs, never a running one", async () => {
    const p = project();
    const a = startJob("k", "done one", p, async () => ({}));
    await a.done;
    let release = () => {};
    const b = startJob("k", "running one", p, () => new Promise((r) => (release = () => r({}))));
    const file = join(p, ".testimus", "jobs", `${a.job.id}.jsonl`);
    expect(existsSync(file)).toBe(true);
    expect(clearJobs(p)).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(listJobs(p).map((j) => j.id)).toEqual([b.job.id]);
    release();
    await waitJob(b.job.id);
    expect(clearJobs(p, ["nope"])).toBe(0);
    expect(clearJobs(p, [b.job.id])).toBe(1);
  });

  it("reads a job the app stopped as interrupted, its steps and processes kept", () => {
    const p = project();
    const dir = join(p, ".testimus", "jobs");
    mkdirSync(dir, { recursive: true });
    const lines = [
      {
        jobId: "k-1",
        at: "x",
        type: "status",
        job: { id: "k-1", kind: "k", subject: "s", status: "running", startedAt: "2026-01-01", pid: 2 ** 30 },
      },
      { jobId: "k-1", at: "x", type: "steps", steps: [{ id: "a", label: "A", status: "running" }] },
      { jobId: "k-1", at: "x", type: "process", process: { id: "p1", label: "L", command: "c", startedAt: "x" } },
      {
        jobId: "k-1",
        at: "x",
        type: "process",
        process: { id: "p1", label: "L", command: "c", startedAt: "x", exit: 0 },
      },
    ];
    writeFileSync(join(dir, "k-1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
    const job = showJob(p, "k-1")?.job;
    expect(job).toMatchObject({ status: "failed", interrupted: true });
    expect(job?.steps?.[0].status).toBe("failed");
    expect(job?.processes).toEqual([expect.objectContaining({ id: "p1", exit: 0 })]);
  });
});
