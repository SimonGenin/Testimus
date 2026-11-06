import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";

export type Stamp = Map<string, string>;

const SKIP = new Set([".git", ".claude", ".mcp.json", "index", "node_modules"]);

// ponytail: what a screen shows is read from the files, so a file's size and mtime say whether it moved;
// Claude Code's own files, the derived index and the app's bookkeeping under .testimus are left out, but for the
// proposed actions (the project's CLAUDE.md is the team's notes: it counts)
export const skipped = (rel: string) =>
  SKIP.has(rel.split("/")[0]) ||
  (rel.startsWith(".testimus/") && rel !== ".testimus/actions" && !rel.startsWith(".testimus/actions/"));

export function stampProject(project: string): Stamp {
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
          const s = statSync(join(project, r), { bigint: true });
          out.set(r, `${s.size}:${s.mtimeNs}`);
        } catch {}
    }
  };
  walk("");
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
