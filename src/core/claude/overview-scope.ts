import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { FILE_WRITE_TOOLS } from "../../shared/tests.ts";
import { writeAtomic } from "../lib/atomic.ts";
import { OVERVIEW_PATH } from "../lib/overview.ts";
import type { ToolCall } from "./stream.ts";

// ponytail: the overview's run may write docs/OVERVIEW.md and nothing else. Its rules close every other path a rule can
// name (claude/access.ts); what is kept here before the run — the files of the project root and of docs/, every
// tests/<id>/test.md, and which entries those folders held — lets the core undo a write that got through anyway: a
// file kept is put back, a new entry removed, anything else is named as left

export type Kept = { bytes: Map<string, Buffer>; listed: Map<string, Set<string>> };

function keepDir(project: string, kept: Kept, rel: string, files: (name: string) => boolean) {
  const abs = join(project, ...rel.split("/").filter(Boolean));
  const list = existsSync(abs) ? readdirSync(abs, { withFileTypes: true }) : [];
  kept.listed.set(rel, new Set(list.map((e) => e.name)));
  for (const e of list)
    if (e.isFile() && files(e.name)) kept.bytes.set(rel ? `${rel}/${e.name}` : e.name, readFileSync(join(abs, e.name)));
  return list.filter((e) => e.isDirectory()).map((e) => e.name);
}

export function keepForOverview(project: string): Kept {
  const kept: Kept = { bytes: new Map(), listed: new Map() };
  const all = () => true;
  keepDir(project, kept, "", all);
  keepDir(project, kept, "docs", all);
  for (const id of keepDir(project, kept, "tests", () => false))
    keepDir(project, kept, `tests/${id}`, (n) => n === "test.md");
  return kept;
}

// ponytail: the paths the run's own file tools wrote, other than docs/OVERVIEW.md — project-relative, or absolute
// when outside the project
export function strayWrites(project: string, calls: ToolCall[]): string[] {
  const out = new Set<string>();
  for (const c of calls) {
    if (c.error || !FILE_WRITE_TOOLS.test(c.name)) continue;
    const p = c.input.file_path ?? c.input.notebook_path;
    if (typeof p !== "string" || !p.trim()) continue;
    const abs = resolve(project, p);
    const rel = relative(resolve(project), abs);
    const r = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : abs;
    if (r.toLowerCase() !== OVERVIEW_PATH.toLowerCase()) out.add(r);
  }
  return [...out].sort();
}

// ponytail: puts back what the run wrote at these paths; returns those it could not
export function undoWrites(project: string, kept: Kept, paths: string[]): string[] {
  const left: string[] = [];
  for (const rel of paths) {
    const was = kept.bytes.get(rel);
    if (isAbsolute(rel)) left.push(rel);
    else if (was) writeAtomic(join(project, ...rel.split("/")), was);
    else if (!removeNew(project, kept, rel) && existsSync(join(project, ...rel.split("/")))) left.push(rel);
  }
  return left;
}

// ponytail: the first entry of the path that a kept folder did not hold is new: it goes, with what is under it
function removeNew(project: string, kept: Kept, rel: string): boolean {
  const segs = rel.split("/");
  for (let i = 0; i < segs.length; i++) {
    const names = kept.listed.get(segs.slice(0, i).join("/"));
    if (!names) return false;
    if (names.has(segs[i])) continue;
    rmSync(join(project, ...segs.slice(0, i + 1)), { recursive: true, force: true });
    return true;
  }
  return false;
}
