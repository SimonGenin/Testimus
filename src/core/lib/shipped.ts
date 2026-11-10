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

export const RULES = "CLAUDE.md";
const NOTES = /^## Team notes[ \t]*$/m;

// ponytail: CLAUDE.md is two files in one — everything above « ## Team notes » is Testimus' and follows the app like a
// skill, the notes below are the team's and are never touched. The rules are known by their own hash, so notes the team
// wrote never make them look edited
export function splitRules(text: string): { rules: string; notes: string } {
  const t = text.replace(/\r\n/g, "\n");
  const at = t.search(NOTES);
  return at < 0 ? { rules: t, notes: "" } : { rules: t.slice(0, at), notes: t.slice(at) };
}

export const rulesHash = (text: string): string => sha256(splitRules(text).rules.trim()).slice(0, 16);

// ponytail: the rules of every CLAUDE.md Testimus shipped before the rules followed the app (2026-11-10) — a project
// made then kept its file as it was, with no record of it: one of these is a file the team never edited above its
// notes, and is brought up to date like any other
const RULES_BEFORE = [
  "909a26da8059706e",
  "26f91eee16a29781",
  "154c4bd392d95e47",
  "ec4ef98ab148525d",
  "dfb9e83bbf6f0157",
  "abe01f6c7fa60bf9",
  "d0d314516a9f98df",
  "450140bca9012a39",
  "c9b71cd74b3470dd",
  "7b87d7ad2d55f345",
  "124ab9cf4b297340",
  "0027deb17a400d1e",
  "25e69fbe42da6009",
  "72cea21947846b78",
  "79f94cd6e4c0b555",
  "74c9e522f62a2df8",
  "bd10d097e31d98aa",
  "312b92a93b91c06a",
  "29f461bc07de0e4b",
  "50cbe9e01e2688e8",
  "5be128acda9fcad8",
  "f716c09c48b1e770",
  "38f8f2b63603b0a9",
  "47c0e61c649bb303",
];

// ponytail: .testimus/shipped.json is { <file>: [hash of each version shipped, in the order they were first written],
// app: <newest Testimus that shipped here> }. A shipped file follows the app only forward: an app older than `app`
// leaves every file alone; otherwise a file at a shipped version written before this app's is replaced, one at a later
// one (a newer build was here) stays, one at no shipped version (the team edited it) stays and the new one is written
// beside it. A file shipped once and now missing was deleted by the team: only `restore` (project init) brings it back.
// CLAUDE.md goes by the same rule on its part above « Team notes » (the team's notes are kept as they are) and
// .mcp.json is ensureMcpJson's
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
    const rules = f === RULES;
    const hashOf = (b: Buffer) => (rules ? rulesHash(b.toString("utf8")) : sha256(b));
    const wantHash = hashOf(want);
    if (!existsSync(to)) {
      if (!restore && known(f).length) continue;
      writeAtomic(to, want);
      out.created.push(f);
      ship(f, wantHash);
      continue;
    }
    const mine = readFileSync(to);
    const have = hashOf(mine);
    if (have === wantHash) {
      ship(f, wantHash);
      continue;
    }
    const versions = rules ? [...RULES_BEFORE, ...known(f)] : known(f);
    const at = versions.lastIndexOf(have);
    if (at < 0) {
      const next = besideOf(f);
      const path = join(root, next);
      if (!existsSync(path) || sha256(readFileSync(path)) !== sha256(want)) writeAtomic(path, want);
      out.kept.push(f);
      out.beside.push(next);
      continue;
    }
    const here = versions.lastIndexOf(wantHash);
    if (here >= 0 && here < at) continue;
    if (rules) {
      const notes = splitRules(mine.toString("utf8")).notes;
      const fresh = splitRules(want.toString("utf8"));
      writeAtomic(to, `${fresh.rules}${notes || fresh.notes}`);
    } else writeAtomic(to, want);
    ship(f, wantHash);
  }
  if (dirty || !existsSync(shippedFile)) writeJson(shippedFile, shipped);
  return out;
}

// ponytail: every Claude run brings what Testimus shipped to the project up to the app's version first — the skills
// and the rules of CLAUDE.md — so a project made by an older Testimus gets a changed skill or rule without anyone
// running project init again; a skill the team deleted stays gone
export const shipSkills = (project: string): Shipped =>
  shipTemplate(project, (f) => f.startsWith(".claude/skills/") || f === RULES, false);
