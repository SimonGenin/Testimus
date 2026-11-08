import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "./atomic.ts";
import { sha256 } from "./hash.ts";
import { readJson, writeJson } from "./project.ts";

const APP = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

export function templateDir(): string {
  const dev = fileURLToPath(new URL("../../../templates/project/", import.meta.url));
  if (existsSync(dev)) return dev;
  return join(dirname(process.argv[1] ?? "."), "templates", "project");
}

function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), base) : [relative(base, join(dir, e.name)).replace(/\\/g, "/")],
  );
}

export type Shipped = { created: string[]; kept: string[]; beside: string[] };

const besideOf = (f: string) => f.replace(/(\.[^./]+)?$/, ".new$1");
const older = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) < 0;

// ponytail: .testimus/shipped.json is { <file>: [hash of each version shipped, in the order they were first written],
// app: <newest Testimus that shipped here> }. A shipped file follows the app only forward: an app older than `app`
// leaves every file alone; otherwise a file at a shipped version written before this app's is replaced, one at a later
// one (a newer build was here) stays, one at no shipped version (the team edited it) stays and the new one is written
// beside it. A file shipped once and now missing was deleted by the team: only `restore` (project init) brings it back.
// CLAUDE.md is the team's once it exists and .mcp.json is ensureMcpJson's
export function shipTemplate(root: string, only: (f: string) => boolean = () => true, restore = true): Shipped {
  const tpl = templateDir();
  const out: Shipped = { created: [], kept: [], beside: [] };
  if (!existsSync(tpl)) return out;
  const shippedFile = join(root, ".testimus", "shipped.json");
  const shipped = readJson<Record<string, string[] | string>>(shippedFile, {});
  const app = typeof shipped.app === "string" ? shipped.app : "";
  if (app && older(APP, app)) return out;
  const known = (f: string): string[] => (Array.isArray(shipped[f]) ? (shipped[f] as string[]) : []);
  let dirty = app !== APP;
  shipped.app = APP;
  const ship = (f: string, hash: string) => {
    if (known(f).includes(hash)) return;
    shipped[f] = [...known(f), hash];
    dirty = true;
  };
  for (const f of files(tpl)) {
    if (f === ".mcp.json" || !only(f)) continue;
    const to = join(root, f);
    const want = readFileSync(join(tpl, f));
    const wantHash = sha256(want);
    if (!existsSync(to)) {
      if (!restore && known(f).length) continue;
      writeAtomic(to, want);
      out.created.push(f);
      ship(f, wantHash);
      continue;
    }
    if (f === "CLAUDE.md") {
      out.kept.push(f);
      continue;
    }
    const have = sha256(readFileSync(to));
    if (have === wantHash) {
      ship(f, wantHash);
      continue;
    }
    const at = known(f).indexOf(have);
    if (at < 0) {
      const next = besideOf(f);
      const path = join(root, next);
      if (!existsSync(path) || sha256(readFileSync(path)) !== wantHash) writeAtomic(path, want);
      out.kept.push(f);
      out.beside.push(next);
      continue;
    }
    const mine = known(f).indexOf(wantHash);
    if (mine >= 0 && mine < at) continue;
    writeAtomic(to, want);
    ship(f, wantHash);
  }
  if (dirty || !existsSync(shippedFile)) writeJson(shippedFile, shipped);
  return out;
}

// ponytail: every Claude run brings the project's shipped skills up to the app's version first, so a project made by
// an older Testimus gets a changed skill without anyone running project init again; a skill the team deleted stays gone
export const shipSkills = (project: string): Shipped =>
  shipTemplate(project, (f) => f.startsWith(".claude/skills/"), false);
