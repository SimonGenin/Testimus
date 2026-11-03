import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { cancelJob, listJobs, showJob, startJob } from "../../../../src/core/jobs.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-jobs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a global job (no project, e.g. moving the models folder)", () => {
  it("is listed, shown and cancelled from any open project", async () => {
    const { job, done } = startJob("models-move", "D:\\models", null, (ctx) => {
      return new Promise((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("cancelled")));
      });
    });
    expect(listJobs(dir).map((j) => j.id)).toContain(job.id);
    expect(showJob(dir, job.id)?.job.kind).toBe("models-move");
    expect(cancelJob(job.id, dir)).toBe(true);
    await done.catch(() => {});
    expect(showJob(dir, job.id)?.job.status).toBe("cancelled");
    const log = join(env.localDir(), "jobs", `${job.id}.jsonl`);
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, "utf8")).toContain('"cancelled"');
  });

  it("keeps a project's job out of another project", async () => {
    const other = mkdtempSync(join(tmpdir(), "testimus-jobs-other-"));
    try {
      const { job, done } = startJob("rag-index", "index", other, () => new Promise((r) => setTimeout(r, 50)));
      expect(showJob(dir, job.id)).toBeNull();
      expect(cancelJob(job.id, dir)).toBe(false);
      await done;
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
