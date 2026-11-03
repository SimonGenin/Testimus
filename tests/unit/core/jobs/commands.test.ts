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
