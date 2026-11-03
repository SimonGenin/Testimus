import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, posix } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { testsCiting } from "../lib/check.ts";
import { docIds, findDoc } from "../lib/docs.ts";
import { sha256 } from "../lib/hash.ts";
import { readJson, writeJson } from "../lib/project.ts";
import { testDir } from "../lib/store.ts";
import type { ClaudeScope, Effort } from "../types.ts";
import type { RunKind } from "./access.ts";

// ponytail: .testimus/runs/<runId>/run.json is the whole run — who ran (kind, model, effort, job), and, for a run
// that may edit tests, the snapshot it can be reverted from (scope, before…)
export type RunMeta = { kind: RunKind; model: string; effort: Effort; at: string; jobId?: string; label?: string };
export type RunRecord = Partial<Omit<RunMeta, "at">> & {
  runId: string;
  at: string;
  scope: ClaudeScope;
  before: Record<string, string | null>;
  changedTests: string[];
  changedSteps: Record<string, number[]>;
  written?: string[];
  after?: Record<string, string | null>;
  reverted?: string;
  roots?: string[];
  files?: Record<string, string | null>;
  filesAfter?: Record<string, string | null>;
  changedFiles?: string[];
  revertedFiles?: string[];
};

const testMd = (project: string, id: string) => join(testDir(project, id), "test.md");
const runFile = (project: string, runId: string) => join(project, ".testimus", "runs", runId, "run.json");

const META = ["kind", "model", "effort", "jobId", "label"] as const;

// ponytail: the snapshot is taken first, then who ran is added to the same file
export function writeRunMeta(project: string, runId: string, meta: RunMeta): void {
  const rec = readJson<Record<string, unknown>>(runFile(project, runId), {});
  for (const k of META) delete rec[k];
  writeJson(runFile(project, runId), { runId, ...rec, ...meta, at: (rec.at as string | undefined) ?? meta.at });
}

export function readRunMeta(project: string, runId: string): RunMeta | null {
  if (!/^[\w-]+$/.test(runId)) return null;
  const m = readJson<Partial<RunMeta>>(runFile(project, runId), {});
  return m.kind && m.model && m.effort
    ? {
        kind: m.kind,
        model: m.model,
        effort: m.effort,
        at: m.at ?? "",
        ...(m.jobId ? { jobId: m.jobId } : {}),
        ...(m.label ? { label: m.label } : {}),
      }
    : null;
}
const beforeFile = (project: string, runId: string, rel: string) =>
  join(project, ".testimus", "runs", runId, "before", ...rel.split("/"));
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
        : scope.kind === "doc"
          ? testsCiting(project, docOf(project, scope.docId)).map((t) => t.id)
          : [scope.testId];
  for (const id of ids) testDir(project, id);
  return ids;
}

const docOf = (project: string, id: string): { id: string; code?: string } => ({
  id,
  code: findDoc(project, id)?.code,
});

function walk(project: string, rel: string, skip: string): string[] {
  const abs = join(project, ...rel.split("/"));
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const r = posix.join(rel, e.name);
    if (r === skip) return [];
    return e.isDirectory() ? walk(project, r, skip) : [r];
  });
}

const originalOf = (project: string, rel: string) => {
  const file = findDoc(project, posix.basename(rel))?.source.file;
  return file ? posix.join(rel, file) : "";
};

const rootFiles = (project: string, roots: string[]) => roots.flatMap((r) => walk(project, r, originalOf(project, r)));

// ponytail: an action may change more than tests — the files that hold the truth (SPEC §3) are copied too, the
// whole folder of a document in scope minus its original copy, which no command ever rewrites
export function truthFiles(project: string, scope: ClaudeScope): { roots: string[]; files: string[] } {
  const files = ["project.json", "xray.json", "columns.json"];
  const roots = scope.kind === "doc" ? [`docs/${scope.docId}`] : [];
  if (scope.kind !== "doc")
    for (const id of docIds(project)) files.push(`docs/${id}/doc.json`, `docs/${id}/context.md`);
  return { roots, files: [...files, ...rootFiles(project, roots)] };
}

const readBytes = (project: string, rel: string) => {
  const abs = join(project, ...rel.split("/"));
  return existsSync(abs) ? readFileSync(abs) : null;
};

export function takeSnapshot(project: string, runId: string, scope: ClaudeScope, withFiles = false): RunRecord {
  const before: Record<string, string | null> = {};
  for (const id of scopeIds(project, scope)) before[id] = readMd(project, id);
  const rec: RunRecord = { runId, at: env.now().toISOString(), scope, before, changedTests: [], changedSteps: {} };
  if (withFiles) {
    const t = truthFiles(project, scope);
    rec.roots = t.roots;
    rec.files = {};
    for (const rel of t.files) {
      const buf = readBytes(project, rel);
      rec.files[rel] = buf ? sha256(buf) : null;
      if (buf) writeAtomic(beforeFile(project, runId, rel), buf);
    }
  }
  writeJson(runFile(project, runId), rec);
  return rec;
}

export function readRun(project: string, runId: string): RunRecord {
  const rec = /^[\w-]+$/.test(runId) ? readJson<RunRecord | null>(runFile(project, runId), null) : null;
  if (!rec?.before)
    throw new UserError(`No Claude run ${runId} in this project.`, "Use the runId returned by claude.run.");
  return rec;
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
  if (rec.files) {
    rec.changedFiles = [];
    rec.filesAfter = {};
    for (const rel of rootFiles(project, rec.roots ?? [])) if (!(rel in rec.files)) rec.files[rel] = null;
    for (const rel of Object.keys(rec.files).sort()) {
      const buf = readBytes(project, rel);
      const now = buf ? sha256(buf) : null;
      if (now === rec.files[rel]) continue;
      rec.changedFiles.push(rel);
      rec.filesAfter[rel] = now;
    }
  }
  writeJson(runFile(project, runId), rec);
  return rec;
}

// ponytail: a planned generation is several runs; the first one's record takes the tests the later ones created,
// so reverting the generation's runId removes them all
export function absorbRun(project: string, into: string, from: string): void {
  const rec = readRun(project, into);
  const other = readRun(project, from);
  // ponytail: runs side by side see each other's new tests — the run that wrote a test has the last word on it
  for (const id of other.changedTests) {
    if (other.before[id] !== null) continue;
    const wrote = !!other.written?.includes(id);
    if (id in rec.before && (rec.before[id] !== null || !wrote)) continue;
    if (!(id in rec.before)) {
      rec.before[id] = null;
      rec.changedTests.push(id);
    }
    rec.changedSteps[id] = other.changedSteps[id] ?? [];
    rec.after = { ...rec.after, [id]: other.after?.[id] ?? null };
    if (wrote && !rec.written?.includes(id)) rec.written = [...(rec.written ?? []), id];
  }
  writeJson(runFile(project, into), rec);
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
  const files: string[] = [];
  if (!o.ids && rec.files && rec.filesAfter)
    for (const rel of rec.changedFiles ?? []) {
      const buf = readBytes(project, rel);
      const now = buf ? sha256(buf) : null;
      if (now === rec.files[rel]) continue;
      if (!o.force && now !== rec.filesAfter[rel]) conflicts.push(rel);
      else files.push(rel);
    }
  if (conflicts.length)
    throw new UserError(
      `${conflicts.join(", ")} changed after the Claude run ${runId}: reverting would lose those edits.`,
      "Look at the test first; revert with force to discard the later edits too.",
      "edited-after-run",
    );
  for (const rel of files) {
    const abs = join(project, ...rel.split("/"));
    if (rec.files?.[rel] === null) rmSync(abs, { force: true });
    else writeAtomic(abs, readFileSync(beforeFile(project, runId, rel)));
  }
  rec.revertedFiles = files;
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
