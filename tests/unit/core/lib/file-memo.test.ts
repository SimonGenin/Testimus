import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { listJobs } from "../../../../src/core/jobs.ts";
import { fileMemo, fileStamp } from "../../../../src/core/lib/file-memo.ts";
import { projectOverview } from "../../../../src/core/lib/project-info.ts";
import { listLocalTests, localTestRef, markRemoteChanged } from "../../../../src/core/lib/store.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const fresh = () => {
  const p = mkdtempSync(join(tmpdir(), "testimus-memo-"));
  cpSync(FIXTURE, p, { recursive: true });
  return p;
};

test("a memo works a value out once per version of its files, and again when one moves, appears or goes", () => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-memo-"));
  const a = join(dir, "a.txt");
  const b = join(dir, "b.txt");
  writeFileSync(a, "1");
  const memo = fileMemo<string>();
  let n = 0;
  const get = () => memo("k", [a, b], () => `${++n}:${readFileSync(a, "utf8")}`);
  expect(get()).toBe("1:1");
  expect(get()).toBe("1:1");
  writeFileSync(a, "22");
  expect(get()).toBe("2:22");
  writeFileSync(b, "x");
  expect(get()).toBe("3:22");
  rmSync(b);
  expect(get()).toBe("4:22");
  expect(fileStamp(b)).toBe("-");
});

test("a memo forgets its oldest entries past its size", () => {
  const memo = fileMemo<number>(2);
  let n = 0;
  for (const k of ["a", "b", "c"]) memo(k, [], () => ++n);
  expect(memo("c", [], () => -1)).toBe(3);
  expect(memo("a", [], () => -1)).toBe(-1);
});

test("a test's row follows each of the files it is made of", () => {
  const p = fresh();
  const md = join(p, "tests", "LFRPS12-1398", "test.md");
  expect(localTestRef(p, "LFRPS12-1398")).toMatchObject({ sync: "synced", review: "validated" });
  writeFileSync(md, readFileSync(md, "utf8").replace("review: validated", "review: draft"));
  expect(localTestRef(p, "LFRPS12-1398")).toMatchObject({ sync: "modified", review: "draft", dirty: true });
  markRemoteChanged(p, "LFRPS12-1398", true);
  expect(localTestRef(p, "LFRPS12-1398")?.sync).toBe("remote-changed");
  writeFileSync(join(p, "tests", "LFRPS12-1398", "check.json"), JSON.stringify({ testHash: "x", findings: [] }));
  expect(localTestRef(p, "LFRPS12-1398")?.findings).toMatchObject({ errors: 0, stale: true });
  rmSync(md);
  expect(localTestRef(p, "LFRPS12-1398")).toBeNull();
  expect(listLocalTests(p).map((t) => t.id)).toEqual(["LFRPS12-1420", "local-3f9a12c0"]);
});

test("a row handed out is a copy: changing it changes nothing kept", () => {
  const p = fresh();
  const r = localTestRef(p, "LFRPS12-1420");
  if (!r) throw new Error("no row");
  r.summary = "changed by a caller";
  expect(localTestRef(p, "LFRPS12-1420")?.summary).not.toBe("changed by a caller");
});

test("the project's counts are the tests' rows", () => {
  const p = fresh();
  const before = projectOverview(p).counts;
  expect(before).toMatchObject({ tests: 3, awaiting: 2, review: { validated: 1, draft: 1, "to-fix": 1 } });
  const dir = join(p, "tests", "local-0000beef");
  mkdirSync(dir);
  writeFileSync(
    join(dir, "test.md"),
    readFileSync(join(p, "tests", "local-3f9a12c0", "test.md"), "utf8").replace("review: to-fix", "review: draft"),
  );
  expect(projectOverview(p).counts).toMatchObject({ tests: 4, awaiting: 3, review: { draft: 2, "to-fix": 1 } });
});

test("the jobs list reads a job's state from its log, past thousands of lines of Claude's words, and follows it", () => {
  const p = mkdtempSync(join(tmpdir(), "testimus-memo-"));
  const dir = join(p, ".testimus", "jobs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "generate-1.jsonl");
  const job = { id: "generate-1", kind: "generate", subject: "s", status: "running", startedAt: "2026-01-01" };
  const lines = [JSON.stringify({ jobId: "generate-1", at: "x", type: "status", job })];
  for (let i = 0; i < 3000; i++)
    lines.push(
      JSON.stringify({
        jobId: "generate-1",
        at: "x",
        type: "claude",
        event: { type: "text", text: 'it said {"type":"status","job":{}} in words' },
      }),
    );
  lines.push(
    JSON.stringify({
      jobId: "generate-1",
      at: "x",
      type: "steps",
      steps: [{ id: "a", label: "A", status: "running" }],
    }),
  );
  writeFileSync(file, `${lines.join("\n")}\n`);
  expect(listJobs(p)[0]).toMatchObject({ id: "generate-1", subject: "s", steps: [{ id: "a", label: "A" }] });
  appendFileSync(
    file,
    `${JSON.stringify({ jobId: "generate-1", at: "y", type: "status", job: { ...job, status: "done", endedAt: "y" } })}\n`,
  );
  expect(listJobs(p)[0]).toMatchObject({ status: "done", endedAt: "y" });
});

test("the jobs list reads a log from its end: a last status larger than the first read is still read whole", () => {
  const p = mkdtempSync(join(tmpdir(), "testimus-memo-"));
  const dir = join(p, ".testimus", "jobs");
  mkdirSync(dir, { recursive: true });
  const job = { id: "pull-1", kind: "pull", subject: "s", status: "running", startedAt: "2026-01-01" };
  const words = Array.from({ length: 2000 }, () =>
    JSON.stringify({ jobId: "pull-1", at: "x", type: "claude", event: { type: "text", text: "w".repeat(100) } }),
  );
  const pulled = Array.from({ length: 6000 }, (_, i) => `LFRPS12-${i}`);
  const done = { ...job, status: "done", endedAt: "z", result: { pulled } };
  const lines = [
    JSON.stringify({ jobId: "pull-1", at: "x", type: "status", job }),
    ...words,
    JSON.stringify({ jobId: "pull-1", at: "z", type: "status", job: done }),
    JSON.stringify({ jobId: "pull-1", at: "z", type: "process", process: { id: "p1", label: "Claude", pid: 1 } }),
  ];
  writeFileSync(join(dir, "pull-1.jsonl"), `${lines.join("\n")}\n`);
  expect(JSON.stringify(done).length).toBeGreaterThan(64 * 1024);
  const listed = listJobs(p)[0] as unknown as { result: { pulled: string[] }; processes: { id: string }[] };
  expect(listed).toMatchObject({ status: "done", endedAt: "z", processes: [{ id: "p1" }] });
  expect(listed.result.pulled).toHaveLength(6000);
});
