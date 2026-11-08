import { type BigIntStats, type Dirent, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { sleep } from "../../shared/run/work.ts";

export type Stamp = Map<string, string>;
export type Changes = { paths: string[]; added: string[]; removed: string[] };

const SKIP = new Set([".git", ".claude", ".mcp.json", "index", "node_modules"]);

// ponytail: what a screen shows is read from the files, so a file's size and mtime say whether it moved;
// Claude Code's own files, the derived index and the app's bookkeeping under .testimus are left out, but for the
// proposed actions (the project's CLAUDE.md is the team's notes: it counts) and the skills (Settings › Context shows them)
export const skipped = (rel: string) =>
  (SKIP.has(rel.split("/")[0]) && !rel.startsWith(".claude/skills/")) ||
  (rel.startsWith(".testimus/") && rel !== ".testimus/actions" && !rel.startsWith(".testimus/actions/"));

const stampOf = (s: { size: bigint; mtimeNs: bigint }) => `${s.size}:${s.mtimeNs}`;

// ponytail: every file of the project (or of one folder of it, `under`) with its size and mtime
export function stampProject(project: string, under = ""): Stamp {
  const out: Stamp = new Map();
  const walk = (rel: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(project, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? posix.join(rel, e.name) : e.name;
      if (skipped(r)) continue;
      if (e.isDirectory()) walk(r);
      else if (e.isFile())
        try {
          out.set(r, stampOf(statSync(join(project, r), { bigint: true })));
        } catch {}
    }
  };
  walk(under);
  return out;
}

export function changedPaths(before: Stamp, after: Stamp): string[] {
  const out = new Set<string>();
  for (const [rel, s] of after) if (before.get(rel) !== s) out.add(rel);
  for (const rel of before.keys()) if (!after.has(rel)) out.add(rel);
  return [...out].sort();
}

// ponytail: which changed paths are new and which are gone; the others were modified
export const addedRemoved = (before: Stamp, after: Stamp, paths: string[]) => ({
  added: paths.filter((p) => !before.has(p)),
  removed: paths.filter((p) => !after.has(p)),
});

type Recorder = { before: Map<string, string | undefined>; fence: string; reached: () => void };
type Followed = { stamp: Stamp | null; recorders: Set<Recorder> };

const followed = new Map<string, Followed>();
const FENCE_MS = 2000;

// ponytail: a project the watcher follows keeps its stamp up to date from the paths it reports, so a job reads what
// it changed from them instead of walking the whole project before and after (1 100 files: 2 × 65 ms here, much
// more on a PC with an antivirus); the stamp is made at the project's first job
export function follow(project: string): void {
  const dir = resolve(project);
  if (!followed.has(dir)) followed.set(dir, { stamp: null, recorders: new Set() });
}

export function unfollow(project: string): void {
  const dir = resolve(project);
  const f = followed.get(dir);
  followed.delete(dir);
  for (const r of f?.recorders ?? []) r.reached();
}

// ponytail: a path the watcher reported, as it is now — a file, a folder (walked: a folder renamed into place reports
// only itself), or gone with all it held; each job under way keeps what the path was before it first moved
export function seen(project: string, rel: string): void {
  const f = followed.get(resolve(project));
  if (!f) return;
  for (const r of f.recorders) if (rel === r.fence) r.reached();
  if (!f.stamp || skipped(rel)) return;
  const stamp = f.stamp;
  const moved: [string, string | undefined][] = [];
  const set = (k: string, v: string | undefined) => {
    if (stamp.get(k) === v) return;
    moved.push([k, stamp.get(k)]);
    if (v === undefined) stamp.delete(k);
    else stamp.set(k, v);
  };
  let s: BigIntStats | undefined;
  try {
    s = statSync(join(project, rel), { bigint: true, throwIfNoEntry: false });
  } catch {}
  if (s?.isFile()) set(rel, stampOf(s));
  else {
    const now = s?.isDirectory() ? stampProject(project, rel) : new Map<string, string>();
    for (const k of [...stamp.keys()]) if (k === rel || k.startsWith(`${rel}/`)) set(k, now.get(k));
    for (const [k, v] of now) set(k, v);
  }
  for (const r of f.recorders) for (const [k, was] of moved) if (!r.before.has(k)) r.before.set(k, was);
}

// ponytail: what a job left changed — from the watcher's reports when it follows the project (a fence folder made at
// the end and seen come back says every earlier write has been reported), else from a stamp before and after
export function recordChanges(project: string, id: string): () => Promise<Changes> {
  const f = followed.get(resolve(project));
  if (!f) {
    const before = stampProject(project);
    return async () => {
      const after = stampProject(project);
      const paths = changedPaths(before, after);
      return { paths, ...addedRemoved(before, after, paths) };
    };
  }
  f.stamp ??= stampProject(project);
  const fence = `.testimus/fence-${id}`;
  let reached = () => {};
  const back = new Promise<void>((ok) => {
    reached = ok;
  });
  const r: Recorder = { before: new Map(), fence, reached: () => reached() };
  f.recorders.add(r);
  return async () => {
    const wait = new AbortController();
    try {
      mkdirSync(join(project, fence), { recursive: true });
      await Promise.race([back, sleep(FENCE_MS, wait.signal).catch(() => {})]);
    } catch {
    } finally {
      wait.abort();
      f.recorders.delete(r);
      rmSync(join(project, fence), { recursive: true, force: true });
    }
    const stamp = f.stamp ?? new Map<string, string>();
    const paths = [...r.before].filter(([k, was]) => stamp.get(k) !== was).map(([k]) => k);
    paths.sort();
    return {
      paths,
      added: paths.filter((k) => r.before.get(k) === undefined),
      removed: paths.filter((k) => !stamp.has(k)),
    };
  };
}
