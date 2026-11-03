import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startJob, waitJob } from "../../../../src/core/jobs.ts";
import { call } from "../registry.ts";

type Listed = { id: string; status: string };

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "testimus-jobs-reg-"));
  mkdirSync(join(p, ".testimus"), { recursive: true });
  return p;
}

describe("jobs.clear through the registry", () => {
  it("forgets the finished jobs and deletes their logs, and keeps a running one", async () => {
    const p = project();
    const ok = startJob("k", "done one", p, async () => ({}));
    await ok.done;
    const bad = startJob("k", "failed one", p, async () => {
      throw new Error("boom");
    });
    await bad.done.catch(() => {});
    let release = () => {};
    const running = startJob("k", "running one", p, () => new Promise((r) => (release = () => r({}))));
    const log = (id: string) => join(p, ".testimus", "jobs", `${id}.jsonl`);
    expect(existsSync(log(ok.job.id))).toBe(true);
    expect(await call("jobs.clear", {}, p)).toEqual({ cleared: 2 });
    expect(existsSync(log(ok.job.id))).toBe(false);
    expect(existsSync(log(bad.job.id))).toBe(false);
    const left = await call<{ jobs: Listed[] } | Listed[]>("jobs.list", {}, p);
    const ids = (Array.isArray(left) ? left : left.jobs).map((j) => j.id);
    expect(ids).toEqual([running.job.id]);
    release();
    await waitJob(running.job.id);
  });

  it("clears only the jobs named, and none that is unknown", async () => {
    const p = project();
    const a = startJob("k", "a", p, async () => ({}));
    const b = startJob("k", "b", p, async () => ({}));
    await Promise.all([a.done, b.done]);
    expect(await call("jobs.clear", { ids: ["nope"] }, p)).toEqual({ cleared: 0 });
    expect(await call("jobs.clear", { ids: [a.job.id] }, p)).toEqual({ cleared: 1 });
    expect(existsSync(join(p, ".testimus", "jobs", `${b.job.id}.jsonl`))).toBe(true);
    await expect(call("jobs.clear", {}, null)).rejects.toThrow(/No project is open/);
  });
});

describe("jobs.show and jobs.cancel through the registry, each output against its schema", () => {
  it("jobs.show gives the job and its log: steps, progress, logs, Claude events and the status", async () => {
    const p = project();
    const r = startJob(
      "k",
      "logged",
      p,
      async (ctx) => {
        ctx.steps?.([{ id: "read", label: "Read" }]);
        ctx.step?.("read");
        ctx.progress({ message: "half", done: 1, total: 2 });
        ctx.log("warn", "careful");
        ctx.claude({ type: "text", text: "hello" });
        ctx.claude({ type: "result", ok: true, text: "done", durationMs: 5 });
        return { n: 1 };
      },
      undefined,
      { rerun: { name: "fake.run", input: { a: 1 } } },
    );
    await r.done;
    const shown = await call<{ job: { status: string; result: unknown }; events: { type: string }[] }>(
      "jobs.show",
      { id: r.job.id },
      p,
    );
    expect(shown.job).toMatchObject({ status: "done", result: { n: 1 } });
    expect(new Set(shown.events.map((e) => e.type))).toEqual(new Set(["status", "steps", "progress", "log", "claude"]));
    await expect(call("jobs.show", { id: "nope" }, p)).rejects.toMatchObject({
      fix: expect.stringMatching(/jobs list/),
    });
  });

  it("jobs.cancel stops a running job, and says false for one that is not running", async () => {
    const p = project();
    const r = startJob(
      "k",
      "long",
      p,
      (ctx) => new Promise((_, no) => ctx.signal.addEventListener("abort", () => no(new Error("stopped")))),
    );
    expect(await call("jobs.cancel", { id: r.job.id }, p)).toEqual({ cancelled: true });
    await r.done.catch(() => {});
    expect(await call("jobs.cancel", { id: r.job.id }, p)).toEqual({ cancelled: false });
    expect((await call<{ job: { status: string } }>("jobs.show", { id: r.job.id }, p)).job.status).toBe("cancelled");
  });
});
