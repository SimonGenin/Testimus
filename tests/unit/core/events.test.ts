import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "../../../src/core/command.ts";
import { notice, startJob, subscribe } from "../../../src/core/jobs.ts";
import type { JobEvent } from "../../../src/core/types.ts";
import { unwatchAll, watchProject } from "../../../src/core/watch.ts";

afterEach(() => unwatchAll());

function listen(): { events: JobEvent[]; stop: () => void } {
  const events: JobEvent[] = [];
  const stop = subscribe((e) => events.push(e));
  return { events, stop };
}

describe("events name their project", () => {
  it("every event of a job carries the job's project; a notice belongs to the machine", async () => {
    const p = mkdtempSync(join(tmpdir(), "testimus-ev-"));
    const l = listen();
    const { done } = startJob("k", "s", p, async (ctx) => {
      ctx.log("hello");
      ctx.progress({ message: "half" });
    });
    await done;
    notice("rate limited");
    l.stop();
    const ofJob = l.events.filter((e) => e.jobId);
    expect(ofJob.length).toBeGreaterThan(2);
    expect(ofJob.every((e) => e.project === p)).toBe(true);
    expect(l.events.find((e) => e.type === "notice")?.project).toBeNull();
  });
});

describe("the project watcher", () => {
  it("turns a burst of writes into one changed event naming the paths, and leaves the app's bookkeeping out", async () => {
    const p = realpathSync(mkdtempSync(join(tmpdir(), "testimus-watch-")));
    mkdirSync(join(p, "tests", "T1"), { recursive: true });
    mkdirSync(join(p, ".testimus", "jobs"), { recursive: true });
    mkdirSync(join(p, "index"), { recursive: true });
    const l = listen();
    watchProject(p, 100);
    watchProject(p, 100);
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(join(p, "tests", "T1", "test.md"), "a");
    writeFileSync(join(p, "tests", "T1", "test.md"), "ab");
    writeFileSync(join(p, "CLAUDE.md"), "notes");
    writeFileSync(join(p, ".testimus", "jobs", "j.jsonl"), "{}");
    writeFileSync(join(p, "index", "rag.db"), "x");
    await vi.waitFor(() => expect(l.events.some((e) => e.type === "changed")).toBe(true), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    l.stop();
    const changed = l.events.filter((e): e is Extract<JobEvent, { type: "changed" }> => e.type === "changed");
    const paths = new Set(changed.flatMap((e) => e.paths));
    expect(paths.has("tests/T1/test.md")).toBe(true);
    expect(paths.has("CLAUDE.md")).toBe(true);
    expect([...paths].some((x) => x.startsWith(".testimus/jobs") || x.startsWith("index"))).toBe(false);
    expect(changed.every((e) => e.project === p && e.jobId === "")).toBe(true);
  });
});

describe("UserError", () => {
  it("carries a stable code a page can branch on", () => {
    const e = new UserError("test.md changed on disk.", "Reload it.", "conflict");
    expect(e.code).toBe("conflict");
    expect(new UserError("plain").code).toBeUndefined();
  });
});
