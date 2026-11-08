import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelAll, cancelJob, startJob, subscribe } from "../../../../src/core/jobs.ts";
import type { JobEvent } from "../../../../src/core/types.ts";
import { unwatchAll, watchProject } from "../../../../src/core/watch.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readdirSync: vi.fn(fs.readdirSync) };
});

let root: string;
const put = (dir: string, rel: string, text: string) => {
  const abs = join(dir, ...rel.split("/"));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-watched-"));
  const seed = join(root, "seed");
  put(seed, "project.json", "{}");
  put(seed, "tests/local-1/test.md", "# one");
  put(seed, "tests/local-2/test.md", "# two");
  put(seed, "docs/D/doc.md", "# doc");
  put(seed, "index/index.db", "db");
  put(seed, ".testimus/jobs/j.jsonl", "");
  put(seed, ".testimus/actions/act-1.json", "{}");
});
afterEach(() => {
  unwatchAll();
  rmSync(root, { recursive: true, force: true });
});

const copy = (name: string) => {
  const dir = join(root, name);
  cpSync(join(root, "seed"), dir, { recursive: true });
  return dir;
};

type Changed = Extract<JobEvent, { type: "changed" }>;

async function changedOf(project: string, work: () => Promise<unknown>): Promise<Changed | undefined> {
  const seen: JobEvent[] = [];
  const off = subscribe((e) => seen.push(e));
  try {
    const { job, done } = startJob("claude", "test", project, work);
    await done.catch(() => {});
    return seen.find((e): e is Changed => e.jobId === job.id && e.type === "changed");
  } finally {
    off();
  }
}

// ponytail: what a Claude run, a pull and a conversion do to a project — edits, new and removed tests, a figure, a
// file written beside and renamed over (atomic), a document folder renamed into place, and the derived files
const work = (dir: string) => async () => {
  put(dir, "tests/local-1/test.md", "# one, edited");
  put(dir, "tests/local-3/test.md", "# three");
  rmSync(join(dir, "tests", "local-2"), { recursive: true });
  put(dir, "docs/D/figures/f1.png", "png");
  put(dir, "docs/D/doc.md.tmp", "# doc, converted again");
  renameSync(join(dir, "docs", "D", "doc.md.tmp"), join(dir, "docs", "D", "doc.md"));
  put(dir, "docs/E.tmp/doc.json", "{}");
  put(dir, "docs/E.tmp/doc.md", "# E");
  renameSync(join(dir, "docs", "E.tmp"), join(dir, "docs", "E"));
  put(dir, "index/index.db", "db, reindexed");
  put(dir, ".testimus/actions/act-2.json", "{}");
};

describe("a job's changed event in a project the watcher follows", () => {
  it("names the same files, added and removed, as walking the project before and after", async () => {
    const walked = copy("walked");
    const watched = copy("watched");
    watchProject(watched, 50);
    await changedOf(watched, async () => null);
    const byWalk = await changedOf(walked, work(walked));
    const byWatch = await changedOf(watched, work(watched));
    expect(byWalk).toMatchObject({
      paths: [
        ".testimus/actions/act-2.json",
        "docs/D/doc.md",
        "docs/D/figures/f1.png",
        "docs/E/doc.json",
        "docs/E/doc.md",
        "tests/local-1/test.md",
        "tests/local-2/test.md",
        "tests/local-3/test.md",
      ],
      added: [
        ".testimus/actions/act-2.json",
        "docs/D/figures/f1.png",
        "docs/E/doc.json",
        "docs/E/doc.md",
        "tests/local-3/test.md",
      ],
      removed: ["tests/local-2/test.md"],
    });
    expect({ paths: byWatch?.paths, added: byWatch?.added, removed: byWatch?.removed }).toEqual({
      paths: byWalk?.paths,
      added: byWalk?.added,
      removed: byWalk?.removed,
    });
    expect(readdirSync(join(watched, ".testimus")).filter((f) => f.startsWith("fence-"))).toEqual([]);
  });

  it("does not walk the project: only the folders that moved are read", async () => {
    const watched = copy("quiet");
    watchProject(watched, 50);
    await changedOf(watched, async () => null);
    const walks = vi.mocked(readdirSync);
    walks.mockClear();
    const e = await changedOf(watched, async () => put(watched, "tests/local-1/test.md", "# one, by Claude"));
    expect(e).toMatchObject({ paths: ["tests/local-1/test.md"], added: [], removed: [] });
    expect(walks.mock.calls.filter(([p]) => String(p) === watched)).toEqual([]);
  });

  it("stopping Testimus waits for a cancelled job still saying what it changed: its last status is written", async () => {
    const watched = copy("stopping");
    watchProject(watched, 50);
    await changedOf(watched, async () => null);
    const seen: JobEvent[] = [];
    const off = subscribe((e) => seen.push(e));
    const { job } = startJob("claude", "test", watched, async (ctx) => {
      await new Promise((ok) => ctx.signal.addEventListener("abort", ok));
      put(watched, "tests/local-1/test.md", "# one, half written");
      throw new Error("cancelled");
    });
    cancelJob(job.id);
    await new Promise((ok) => setImmediate(ok));
    await cancelAll(5000);
    off();
    const mine = seen.filter((e) => e.jobId === job.id);
    expect(mine.map((e) => e.type)).toEqual(["status", "changed", "status"]);
    expect(mine.at(-1)).toMatchObject({ type: "status", job: { status: "cancelled" } });
  });

  it("is not sent when nothing changed, and comes before the job ends when it failed", async () => {
    const watched = copy("failed");
    watchProject(watched, 50);
    expect(await changedOf(watched, async () => null)).toBeUndefined();
    const e = await changedOf(watched, async () => {
      put(watched, "tests/local-2/test.md", "# two, half done");
      throw new Error("stopped half way");
    });
    expect(e).toMatchObject({ paths: ["tests/local-2/test.md"], added: [], removed: [] });
  });
});
