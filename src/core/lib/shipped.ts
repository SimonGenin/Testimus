import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "./atomic.ts";
import { sha256 } from "./hash.ts";
import { readJson, writeJson } from "./project.ts";

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

// ponytail: a shipped file follows the app unless the team edited it (its hash is no version this project was
// shipped, .testimus/shipped.json) — then theirs stays and the new one is written beside it; CLAUDE.md is the team's
// once it exists and .mcp.json is ensureMcpJson's
export function shipTemplate(root: string, only: (f: string) => boolean = () => true): Shipped {
  const tpl = templateDir();
  const out: Shipped = { created: [], kept: [], beside: [] };
  if (!existsSync(tpl)) return out;
  const shippedFile = join(root, ".testimus", "shipped.json");
  const shipped = readJson<Record<string, string[]>>(shippedFile, {});
  let dirty = false;
  const ship = (f: string, hash: string) => {
    if ((shipped[f] ?? []).includes(hash)) return;
    shipped[f] = [...(shipped[f] ?? []), hash];
    dirty = true;
  };
  for (const f of files(tpl)) {
    if (f === ".mcp.json" || !only(f)) continue;
    const to = join(root, f);
    const want = readFileSync(join(tpl, f));
    const wantHash = sha256(want);
    if (!existsSync(to)) {
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
    if (have !== wantHash && !(shipped[f] ?? []).includes(have)) {
      const next = besideOf(f);
      const at = join(root, next);
      if (!existsSync(at) || sha256(readFileSync(at)) !== wantHash) writeAtomic(at, want);
      out.kept.push(f);
      out.beside.push(next);
      continue;
    }
    if (have !== wantHash) writeAtomic(to, want);
    ship(f, wantHash);
  }
  if (dirty || !existsSync(shippedFile)) writeJson(shippedFile, shipped);
  return out;
}

// ponytail: every Claude run brings the project's shipped skills up to the app's version first, so a project made by
// an older Testimus gets a changed skill without anyone running project init again
export const shipSkills = (project: string): Shipped => shipTemplate(project, (f) => f.startsWith(".claude/skills/"));
