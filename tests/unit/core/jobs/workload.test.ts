import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeActivity } from "../../../../src/core/claude/activity.ts";
import { runClaude } from "../../../../src/core/claude/run.ts";
import { env } from "../../../../src/core/env.ts";
import {
  cancelJob,
  jobWrote,
  listJobs,
  lookAtProcesses,
  nameJob,
  startJob,
  subscribe,
  withProcess,
} from "../../../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockBatch } from "../../../../src/core/mock/jobs.ts";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const realNow = env.now;
const realSpawn = env.spawnClaude;
const realMock = env.mock;
afterEach(() => {
  env.now = realNow;
  env.spawnClaude = realSpawn;
  env.mock = realMock;
});

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "testimus-jobs-load-"));
  for (const d of ["docs/A", "docs/B", "tests/local-1"]) mkdirSync(join(p, d), { recursive: true });
  return p;
}

const logOf = (p: string, id: string): JobEvent[] =>
  readFileSync(join(p, ".testimus", "jobs", `${id}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

// ponytail: a clock the test moves by hand
function clock(start = Date.parse("2026-11-12T08:00:00Z")) {
  let t = start;
  env.now = () => new Date(t);
  return { at: (ms: number) => (t = start + ms) };
}

describe("progress: written when it says something new, at most once a second", () => {
  it("writes 100 identical progress lines once", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      for (let i = 0; i < 100; i++) ctx.progress({ message: "Copying", done: 1, total: 4 });
      return {};
    });
    await done;
    expect(logOf(p, job.id).filter((e) => e.type === "progress")).toHaveLength(1);
  });

  it("holds lines within the second and writes the last one before the step ends; a verdict is never held", async () => {
    const p = project();
    const c = clock();
    const pushed: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "progress") pushed.push(e.message);
    });
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      ctx.steps?.([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]);
      ctx.step?.("a");
      for (let i = 0; i < 50; i++) {
        c.at(i * 10);
        ctx.progress({ message: `frame ${i}`, done: i, total: 50 });
      }
      ctx.progress({ message: "« T »: 0 error(s)", test: "local-1" });
      c.at(2000);
      ctx.progress({ message: "frame 50", done: 50, total: 50 });
      c.at(2100);
      ctx.progress({ message: "frame 51", done: 50, total: 50 });
      ctx.step?.("b");
      return {};
    });
    await done;
    off();
    const lines = logOf(p, job.id)
      .filter((e) => e.type === "progress")
      .map((e) => e.message);
    expect(lines).toEqual(["frame 0", "frame 49", "« T »: 0 error(s)", "frame 50", "frame 51"]);
    expect(pushed).toEqual(lines);
    const types = logOf(p, job.id).map((e) => e.type);
    expect(types.indexOf("step", types.lastIndexOf("progress"))).toBeGreaterThan(-1);
  });
});

describe("steps: only the one that moved is written", () => {
  it("writes the declaration once, then one step per change, and reads the job back from them", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      ctx.steps?.([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ]);
      ctx.step?.("a");
      ctx.step?.("c");
      return {};
    });
    await done;
    const log = logOf(p, job.id);
    expect(log.filter((e) => e.type === "steps")).toHaveLength(1);
    const moved = log.flatMap((e) => (e.type === "step" ? [`${e.step.id}:${e.step.status}`] : []));
    expect(moved).toEqual(["a:running", "a:done", "b:skipped", "c:running", "c:done"]);
    const id = "hand-1";
    writeFileSync(
      join(p, ".testimus", "jobs", `${id}.jsonl`),
      log
        .filter((e) => e.type !== "status" || e.job.status === "running")
        .map((e) => JSON.stringify({ ...e, jobId: id, ...(e.type === "status" ? { job: { ...e.job, id } } : {}) }))
        .join("\n"),
    );
    const back = listJobs(p).find((j) => j.id === id);
    expect(back?.steps?.map((s) => s.status)).toEqual(["done", "skipped", "done"]);
    expect(back?.interrupted).toBe(true);
  });
});

describe("Claude runs: a summary in the job's file, the detail in the run's folder", () => {
  const line = (o: unknown) => JSON.stringify(o);
  const stream = [
    line({ type: "assistant", message: { content: [{ type: "text", text: "Reading the documents" }] } }),
    line({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "mcp__testimus__tests_save", input: { id: "local-0000000b", md: "x" } }],
      },
    }),
    line({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Wrote one test.",
      total_cost_usd: 0.25,
      duration_ms: 4200,
      usage: { input_tokens: 1000, output_tokens: 200 },
      session_id: "s1",
    }),
  ];

  it("keeps Claude's events out of the job's file and gives them back through jobs.activity", async () => {
    const p = fixtureCopy("jobs-activity");
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "claude" } });
    env.spawnClaude = async (s) => {
      for (const l of stream) s.onLine?.(l);
      s.onSpawn?.(4242);
      return { code: 0, stdout: `${stream.join("\n")}\n`, stderr: "" };
    };
    const live: JobEvent[] = [];
    const off = subscribe((e) => {
      if (e.type === "claude") live.push(e);
    });
    const { job, done } = startJob("generate", "write one", p, (ctx) =>
      runClaude({
        kind: "generate",
        project: p,
        prompt: "write",
        model: "sonnet",
        effort: "high",
        jobId: ctx.jobId,
        onEvent: (e) => ctx.claude(e),
      }),
    );
    await done;
    off();
    expect(live.length).toBe(3);
    expect(logOf(p, job.id).some((e) => e.type === "claude")).toBe(false);
    const proc = job.processes?.[0];
    expect(proc?.run).toMatchObject({
      model: "sonnet",
      effort: "high",
      durationMs: 4200,
      costUsd: 0.25,
      tokens: { input: 1000, output: 200 },
      tests: ["local-0000000b"],
    });
    expect(proc?.run?.error).toBeUndefined();
    const all = await call<{ events: JobEvent[] }>("jobs.activity", { id: job.id }, p);
    expect(all.events.map((e) => (e.type === "claude" ? e.event.type : e.type))).toEqual(["text", "tool", "result"]);
    expect(all.events.every((e) => e.type === "claude" && e.process === proc?.id)).toBe(true);
    expect((await call<{ events: JobEvent[] }>("jobs.activity", { id: job.id, process: "p9" }, p)).events).toEqual([]);
    await expect(call("jobs.activity", { id: "nope-1" }, p)).rejects.toThrow(/No job nope-1/);
  });

  it("reads a finished run's events from its folder rather than from memory, and says why a run failed", async () => {
    const p = project();
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      await withProcess(
        "Claude · x",
        "claude -p",
        async () => {
          ctx.claude({ type: "text", text: "live only" });
          return 1;
        },
        (r) => r,
        { start: { run: { id: "run-1" } }, end: () => ({ run: { id: "run-1", error: "credit" } }) },
      );
      return {};
    });
    await done;
    writeActivity(p, "run-1", [{ at: "2026-11-12T08:00:00.000Z", event: { type: "text", text: "kept" } }]);
    const r = await call<{ events: JobEvent[] }>("jobs.activity", { id: job.id }, p);
    expect(r.events.map((e) => (e.type === "claude" && e.event.type === "text" ? e.event.text : ""))).toEqual(["kept"]);
    expect(job.processes?.[0].run).toEqual({ id: "run-1", error: "credit" });
  });
});

describe("changed: a job sends the files of its own folders", () => {
  it("two jobs at once on two documents each name only their document's files", async () => {
    const p = project();
    let goA = () => {};
    let goB = () => {};
    const a = startJob("docs.convert", "A", p, async () => {
      writeFileSync(join(p, "docs", "A", "doc.md"), "a");
      await new Promise<void>((r) => (goA = r));
      return {};
    });
    const b = startJob("docs.convert", "B", p, async () => {
      writeFileSync(join(p, "docs", "B", "doc.md"), "b");
      await new Promise<void>((r) => (goB = r));
      return {};
    });
    await new Promise((r) => setTimeout(r, 10));
    goA();
    goB();
    await Promise.all([a.done, b.done]);
    expect(logOf(p, a.job.id).flatMap((e) => (e.type === "changed" ? e.paths : []))).toEqual(["docs/A/doc.md"]);
    expect(logOf(p, b.job.id).flatMap((e) => (e.type === "changed" ? e.paths : []))).toEqual(["docs/B/doc.md"]);
    expect(a.job.touched).toEqual(["docs/A"]);
  });

  it("a job that owns no folder leaves out what a job running meanwhile owns; a claimed file is its own", async () => {
    const p = project();
    let go = () => {};
    const conv = startJob("docs.convert", "A", p, async () => {
      await new Promise<void>((r) => (go = r));
      return {};
    });
    const pull = startJob("pull", "project = X", p, async () => {
      writeFileSync(join(p, "docs", "A", "doc.md"), "a");
      writeFileSync(join(p, "tests", "local-1", "test.md"), "t");
      return {};
    });
    await pull.done;
    go();
    await conv.done;
    expect(logOf(p, pull.job.id).flatMap((e) => (e.type === "changed" ? e.paths : []))).toEqual([
      "tests/local-1/test.md",
    ]);
    const claim = startJob("k", "s", p, async () => {
      jobWrote(["columns.json"]);
      jobWrote(["index"], "rag-index");
      writeFileSync(join(p, "columns.json"), "{}");
      writeFileSync(join(p, "project.json"), "{}");
      return {};
    });
    await claim.done;
    expect(logOf(p, claim.job.id).flatMap((e) => (e.type === "changed" ? e.paths : []))).toEqual(["columns.json"]);
  });

  it("a job inside a batch hands its folders to its parent, which sends them once", async () => {
    const p = project();
    const sent: { jobId: string; paths: string[] }[] = [];
    const off = subscribe((e) => {
      if (e.type === "changed" && e.jobId) sent.push({ jobId: e.jobId, paths: e.paths });
    });
    const parent = startJob("docs.add", "folder", p, async () => {
      const kids = ["A", "B"].map(
        (d) =>
          startJob("docs.convert", d, p, async () => {
            writeFileSync(join(p, "docs", d, "doc.md"), d);
            return {};
          }).done,
      );
      await Promise.all(kids);
      return {};
    });
    await parent.done;
    off();
    expect(sent).toEqual([{ jobId: parent.job.id, paths: ["docs/A/doc.md", "docs/B/doc.md"] }]);
    expect(parent.job.touched?.sort()).toEqual(["docs/A", "docs/B"]);
    const child = listJobs(p).find((j) => j.parentId === parent.job.id && j.subject === "A");
    expect(child?.touched).toEqual(["docs/A"]);
  });

  it("keeps the count and the folders in the job's file beyond 200 paths, and all of them live", async () => {
    const p = project();
    let pushed = 0;
    const off = subscribe((e) => {
      if (e.type === "changed" && e.jobId) pushed = e.paths.length;
    });
    const { job, done } = startJob("docs.convert", "A", p, async () => {
      for (let i = 0; i < 250; i++) writeFileSync(join(p, "docs", "A", `f${i}.txt`), "x");
      writeFileSync(join(p, "docs", "A", "x.md"), "x");
      return {};
    });
    await done;
    off();
    expect(pushed).toBe(251);
    const e = logOf(p, job.id).find((x) => x.type === "changed");
    expect(e).toMatchObject({ paths: [], count: 251, folders: [{ path: "docs/A", files: 251 }] });
    const shown = await call<{ events: JobEvent[] }>("jobs.show", { id: job.id }, p);
    expect(shown.events.find((x) => x.type === "changed")).toMatchObject({ paths: expect.any(Array) });
    rmSync(join(p, "docs", "A"), { recursive: true });
  });
});

describe("liveness, worked out when read", () => {
  it("gives the last sign, and says stuck after 10 min of silence with no program and no queue", async () => {
    const p = project();
    const c = clock();
    let release = () => {};
    const { job, done } = startJob("k", "s", p, async (ctx) => {
      ctx.progress({ message: "Reading" });
      await new Promise<void>((r) => (release = r));
      return {};
    });
    c.at(3 * 60_000);
    const early = listJobs(p).find((j) => j.id === job.id) as Job;
    expect(early.lastEventAt).toBe("2026-11-12T08:00:00.000Z");
    expect(early.stuck).toBeUndefined();
    c.at(11 * 60_000);
    expect(listJobs(p).find((j) => j.id === job.id)?.stuck).toBe(true);
    expect(((await call<{ job: Job }>("jobs.show", { id: job.id }, p)) as { job: Job }).job.stuck).toBe(true);
    release();
    await done;
    expect(listJobs(p).find((j) => j.id === job.id)?.lastEventAt).toBeUndefined();
  });

  it("a running child's sign is its parent's; a queued job or one with a live program is not stuck", async () => {
    const p = project();
    const c = clock();
    const gates: (() => void)[] = [];
    const hold = () => new Promise<void>((r) => gates.push(r));
    let child: Job | undefined;
    const parent = startJob("docs.add", "folder", p, async () => {
      const kid = startJob("docs.convert", "A", p, async (ctx) => {
        await hold();
        ctx.log("info", "still going");
        await hold();
        return {};
      });
      child = kid.job;
      await kid.done;
      return {};
    });
    const queued = startJob("docs.convert", "B", p, async (ctx) => {
      ctx.progress({ message: "Waiting to convert (5 at a time)" });
      await hold();
      return {};
    });
    const prog = startJob("k", "s", p, async () => {
      await withProcess(
        "ffmpeg",
        "ffmpeg",
        (pid) => {
          pid(process.pid);
          return hold();
        },
        () => 0,
      );
      return {};
    });
    await new Promise((r) => setTimeout(r, 0));
    c.at(12 * 60_000);
    gates[0]();
    await new Promise((r) => setTimeout(r, 0));
    const byId = new Map(listJobs(p).map((j) => [j.id, j]));
    expect(byId.get(child?.id ?? "")?.stuck).toBeUndefined();
    expect(byId.get(parent.job.id)?.lastEventAt).toBe(new Date(Date.parse("2026-11-12T08:12:00Z")).toISOString());
    expect(byId.get(parent.job.id)?.stuck).toBeUndefined();
    expect(byId.get(queued.job.id)?.stuck).toBeUndefined();
    expect(byId.get(prog.job.id)?.stuck).toBeUndefined();
    for (const g of gates.slice(1)) g();
    await Promise.all([parent.done, queued.done, prog.done]);
  });

  it("puts the end of a program the core heard of late at the last time it was seen alive", async () => {
    const p = project();
    const c = clock();
    let end = (_: number) => {};
    const { job, done } = startJob("k", "s", p, () =>
      withProcess(
        "ffmpeg",
        "ffmpeg",
        (pid) => {
          pid(process.pid);
          return new Promise<number>((r) => (end = r));
        },
        (r) => r,
      ),
    );
    c.at(5000);
    lookAtProcesses();
    c.at(3 * 3600_000);
    end(0);
    await done;
    expect(job.processes?.[0]).toMatchObject({ exit: 0, endedAt: "2026-11-12T08:00:05.000Z" });
    const quick = startJob("k", "s", p, () =>
      withProcess(
        "ffmpeg",
        "ffmpeg",
        async () => 0,
        (r) => r,
      ),
    );
    c.at(3 * 3600_000 + 2000);
    await quick.done;
    expect(Date.parse(quick.job.processes?.[0].endedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(quick.job.processes?.[0].startedAt ?? ""),
    );
  });
});

describe("job labels", () => {
  it("names an index run by its documents, only a job of that kind", async () => {
    const dir = fixtureCopy("jobs-index-label");
    env.mock = true;
    await call("rag.index", {}, dir);
    const idx = listJobs(dir).find((j) => j.kind === "rag-index");
    expect(idx?.label).toBe("Index: 5 documents");
    const other = startJob("k", "s", dir, async () => {
      nameJob("rag-index", "Index: 9 documents");
      return {};
    });
    await other.done;
    expect(other.job.label).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the mock's batch (TESTIMUS_MOCK_JOBS)", () => {
  it("holds a folder import of n conversions under way, most done, some converting, the rest queued", async () => {
    const p = project();
    mockBatch(p, 10);
    await new Promise((r) => setTimeout(r, 20));
    const all = listJobs(p);
    const parent = all.find((j) => j.kind === "docs.add") as Job;
    const kids = all.filter((j) => j.parentId === parent.id);
    expect(parent.status).toBe("running");
    expect(kids.filter((k) => k.status === "done")).toHaveLength(6);
    expect(kids.filter((k) => k.status === "running" && k.steps?.[0]?.id === "queue")).toHaveLength(3);
    expect(cancelJob(parent.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(listJobs(p).filter((j) => j.status === "running")).toEqual([]);
    mockBatch(null, 3);
    mockBatch(p, 0);
  });
});
