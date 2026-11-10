import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startJob } from "../../../../src/core/jobs.ts";
import type { Job } from "../../../../src/core/types.ts";
import { call } from "../registry.ts";

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "testimus-jobs-about-"));
  mkdirSync(join(p, "tests", "local-1"), { recursive: true });
  mkdirSync(join(p, "docs", "D"), { recursive: true });
  writeFileSync(join(p, "tests", "local-1", "test.md"), "# one");
  writeFileSync(join(p, "docs", "D", "doc.md"), "# doc");
  mkdirSync(join(p, ".testimus", "jobs"), { recursive: true });
  return p;
}

describe("what a job is about", () => {
  it("names the tests and documents whose files it changed, and the list keeps the ones about a folder", async () => {
    const p = project();
    const edit = startJob("claude", "the project", p, async () => {
      writeFileSync(join(p, "tests", "local-1", "test.md"), "# one, edited");
      writeFileSync(join(p, "tests", "local-2.md"), "loose");
      mkdirSync(join(p, "tests", "local-3"), { recursive: true });
      writeFileSync(join(p, "tests", "local-3", "test.md"), "# three");
      writeFileSync(join(p, "docs", "OVERVIEW.md"), "how they fit");
      return {};
    });
    await edit.done;
    const fix = startJob("fix", "local-1", p, async () => {
      throw new Error("Claude stopped.");
    });
    await fix.done.catch(() => {});
    const other = startJob("docs.convert", "D", p, async () => ({}));
    await other.done;

    expect(edit.job.touched?.sort()).toEqual(["tests/local-1", "tests/local-3"]);
    expect(other.job.touched).toBeUndefined();

    const about = await call<Job[]>("jobs.list", { about: "tests/local-1" }, p);
    expect(about.map((j) => j.id).sort()).toEqual([fix.job.id, edit.job.id].sort());
    expect(about.find((j) => j.id === edit.job.id)?.touched).toContain("tests/local-1");
    const doc = await call<Job[]>("jobs.list", { about: "docs/D" }, p);
    expect(doc.map((j) => j.id)).toEqual([other.job.id]);
    expect(await call<Job[]>("jobs.list", { about: "tests/local-9" }, p)).toEqual([]);
  });

  it("deletes the logs of jobs ended more than 30 days ago at the first job, and keeps the others", async () => {
    const p = project();
    const dir = join(p, ".testimus", "jobs");
    const old = join(dir, "old-1.jsonl");
    const recent = join(dir, "recent-1.jsonl");
    const note = join(dir, "notes.txt");
    for (const f of [old, recent, note]) writeFileSync(f, "");
    const longAgo = (Date.now() - 31 * 86_400_000) / 1000;
    utimesSync(old, longAgo, longAgo);
    utimesSync(note, longAgo, longAgo);
    utimesSync(recent, (Date.now() - 29 * 86_400_000) / 1000, (Date.now() - 29 * 86_400_000) / 1000);

    await startJob("k", "one", p, async () => ({})).done;
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(note)).toBe(true);

    writeFileSync(old, "");
    utimesSync(old, longAgo, longAgo);
    await startJob("k", "two", p, async () => ({})).done;
    expect(existsSync(old)).toBe(true);
  });
});
