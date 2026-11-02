import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { sha256 } from "../lib/hash.ts";
import { readJson, writeJson } from "../lib/project.ts";
import { testDir } from "../lib/store.ts";
import type { ClaudeScope } from "../types.ts";

export type RunRecord = {
  runId: string;
  at: string;
  scope: ClaudeScope;
  before: Record<string, string | null>;
  changedTests: string[];
  changedSteps: Record<string, number[]>;
  written?: string[];
  after?: Record<string, string | null>;
  reverted?: string;
};

const testMd = (project: string, id: string) => join(testDir(project, id), "test.md");
const runFile = (project: string, runId: string) => join(project, ".testimus", "runs", runId, "run.json");
const hashOf = (md: string | null) => (md === null ? null : sha256(md));

function readMd(project: string, id: string): string | null {
  const f = testMd(project, id);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
}

function allTests(project: string): string[] {
  const dir = join(project, "tests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "test.md")))
    .map((e) => e.name)
    .sort();
}

export function scopeIds(project: string, scope: ClaudeScope): string[] {
  const ids =
    scope.kind === "project"
      ? allTests(project)
      : scope.kind === "tests"
        ? [...new Set(scope.testIds)]
        : [scope.testId];
  for (const id of ids) testDir(project, id);
  return ids;
}

export function takeSnapshot(project: string, runId: string, scope: ClaudeScope): RunRecord {
  const before: Record<string, string | null> = {};
  for (const id of scopeIds(project, scope)) before[id] = readMd(project, id);
  const rec: RunRecord = { runId, at: env.now().toISOString(), scope, before, changedTests: [], changedSteps: {} };
  writeJson(runFile(project, runId), rec);
  return rec;
}

export function readRun(project: string, runId: string): RunRecord {
  if (!/^[\w-]+$/.test(runId) || !existsSync(runFile(project, runId)))
    throw new UserError(`No Claude run ${runId} in this project.`, "Use the runId returned by claude.run.");
  return readJson<RunRecord>(runFile(project, runId), {} as RunRecord);
}

// ponytail: steps are compared as text blocks between `## Step N` headings, positionally, with the
// number and the step id taken out — the testfile parser is not needed to know which step moved
export function stepBlocks(md: string): string[] {
  const text = md.replace(/\r\n/g, "\n");
  const parts = text.split(/^## Step \d+[^\n]*\n/m);
  return parts.slice(1).map((p, i, all) => (i === all.length - 1 ? p.split(/^## /m)[0] : p).replace(/\s+$/, ""));
}

export function changedStepNumbers(before: string | null, after: string | null): number[] {
  const a = before === null ? [] : stepBlocks(before);
  const b = after === null ? [] : stepBlocks(after);
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i + 1);
  return out;
}

const validId = (project: string, id: string) => {
  try {
    testDir(project, id);
    return true;
  } catch {
    return false;
  }
};

export function finishSnapshot(project: string, runId: string, written: string[] = []): RunRecord {
  const rec = readRun(project, runId);
  const ids = new Set(Object.keys(rec.before));
  if (rec.scope.kind === "project") for (const id of allTests(project)) ids.add(id);
  rec.changedTests = [];
  rec.changedSteps = {};
  rec.written = written.filter((id) => validId(project, id));
  rec.after = {};
  for (const id of [...ids].sort()) {
    if (!(id in rec.before)) rec.before[id] = null;
    const now = readMd(project, id);
    if (now === rec.before[id]) continue;
    rec.changedTests.push(id);
    rec.changedSteps[id] = changedStepNumbers(rec.before[id], now);
    rec.after[id] = hashOf(now);
  }
  writeJson(runFile(project, runId), rec);
  return rec;
}

// ponytail: what Testimus itself writes right after a run (generation stamp, review state) is part of what the run left
export function markLeft(project: string, runId: string, ids: string[]): void {
  const rec = readRun(project, runId);
  if (!rec.after) return;
  for (const id of ids) if (id in rec.after) rec.after[id] = hashOf(readMd(project, id));
  writeJson(runFile(project, runId), rec);
}

export type RevertOpts = { force?: boolean; ids?: string[] };

// ponytail: revert only undoes what the run left — a test created by someone else during the run stays,
// and a test edited after the run is refused (named) unless force
export function revert(project: string, runId: string, o: RevertOpts = {}): string[] {
  const rec = readRun(project, runId);
  const todo: string[] = [];
  const conflicts: string[] = [];
  for (const id of o.ids ?? Object.keys(rec.before)) {
    if (!(id in rec.before)) continue;
    const md = rec.before[id];
    const now = readMd(project, id);
    if (now === md) continue;
    if (md === null && !rec.written?.includes(id)) continue;
    if (rec.after && !(id in rec.after)) continue;
    if (!o.force && (!rec.after || hashOf(now) !== rec.after[id])) conflicts.push(id);
    else todo.push(id);
  }
  if (conflicts.length)
    throw new UserError(
      `${conflicts.join(", ")} changed after the Claude run ${runId}: reverting would lose those edits.`,
      "Look at the test first; revert with force to discard the later edits too.",
    );
  for (const id of todo) {
    const md = rec.before[id];
    if (md === null) rmSync(testDir(project, id), { recursive: true, force: true });
    else {
      mkdirSync(testDir(project, id), { recursive: true });
      writeAtomic(testMd(project, id), md);
    }
  }
  rec.reverted = env.now().toISOString();
  writeJson(runFile(project, runId), rec);
  return todo;
}
