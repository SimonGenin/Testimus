import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startJob, subscribe } from "../../src/core/jobs.ts";
import { changedPaths, stampProject } from "../../src/core/lib/changed.ts";
import type { JobEvent } from "../../src/core/types.ts";

let dir: string;
const put = (rel: string, text: string) => {
  const abs = join(dir, ...rel.split("/"));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-changed-"));
  put("project.json", "{}");
  put("tests/local-1/test.md", "# one");
  put("tests/local-2/test.md", "# two");
  put("docs/D/doc.md", "# doc");
  put("index/index.db", "db");
  put(".testimus/jobs/j.jsonl", "");
  put(".testimus/actions/act-1.json", "{}");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("what a job left changed in the project", () => {
  it("names the files written, added and removed, with / and sorted", () => {
    const before = stampProject(dir);
    put("tests/local-1/test.md", "# one, edited");
    put("tests/local-3/test.md", "# three");
    rmSync(join(dir, "tests", "local-2"), { recursive: true });
    put("docs/D/figures/f1.png", "png");
    expect(changedPaths(before, stampProject(dir))).toEqual([
      "docs/D/figures/f1.png",
      "tests/local-1/test.md",
      "tests/local-2/test.md",
      "tests/local-3/test.md",
    ]);
  });

  it("sees a rewrite of the same size by its time", () => {
    const before = stampProject(dir);
    put("tests/local-1/test.md", "# ONE");
    utimesSync(join(dir, "tests", "local-1", "test.md"), new Date(2030, 0, 1), new Date(2030, 0, 1));
    expect(changedPaths(before, stampProject(dir))).toEqual(["tests/local-1/test.md"]);
  });

  it("leaves out the index, Git, Claude Code's files and the app's bookkeeping, but not the proposed actions", () => {
    const before = stampProject(dir);
    put("index/index.db", "db, reindexed");
    put(".git/HEAD", "ref");
    put(".claude/skills/x/SKILL.md", "x");
    put(".mcp.json", "{}");
    put(".testimus/jobs/j.jsonl", "{}");
    put(".testimus/runs/r/run.json", "{}");
    put(".testimus/actions/act-2.json", "{}");
    expect(changedPaths(before, stampProject(dir))).toEqual([".testimus/actions/act-2.json"]);
  });

  it("is empty for a folder that is not there", () => {
    expect(stampProject(join(dir, "missing")).size).toBe(0);
  });
});

describe("a job's changed event", () => {
  const eventsOf = async (project: string | null, work: () => Promise<unknown>) => {
    const seen: JobEvent[] = [];
    const off = subscribe((e) => seen.push(e));
    try {
      const { job, done } = startJob("claude", "test", project, work);
      await done.catch(() => {});
      return seen.filter((e) => e.jobId === job.id);
    } finally {
      off();
    }
  };

  it("comes before the job ends, with the files it changed — failed or not", async () => {
    const seen = await eventsOf(dir, async () => {
      put("tests/local-1/test.md", "# edited by Claude");
      throw new Error("stopped half way");
    });
    expect(seen.map((e) => e.type)).toEqual(["status", "changed", "status"]);
    expect(seen[1]).toMatchObject({ type: "changed", paths: ["tests/local-1/test.md"] });
  });

  it("is not sent when nothing changed, nor for a job of no project", async () => {
    expect((await eventsOf(dir, async () => null)).map((e) => e.type)).toEqual(["status", "status"]);
    expect((await eventsOf(null, async () => null)).map((e) => e.type)).toEqual(["status", "status"]);
  });
});
