import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureMcpJson } from "../claude/run.ts";
import { UserError } from "../command.ts";
import { writeAtomic } from "./atomic.ts";
import { sha256 } from "./hash.ts";
import {
  DEFAULT_PROJECT,
  DEFAULT_XRAY,
  isProject,
  readJson,
  readProject,
  rememberProject,
  writeJson,
  writeProject,
  writeXray,
} from "./project.ts";

const FOLDERS = ["docs", "tests", "contexts"];

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

// ponytail: a new project starts with Xray Editor's one quick ask, edited or removed in Settings › Claude
export const STARTER_ASKS = [
  {
    label: "Rephrase in house style",
    prompt:
      "Rephrase the text in the house style: short imperative sentences, the actor prefix line kept as it is, one ◼ bullet per action. Keep the meaning and the images.",
  },
];

export type Initialized = {
  dir: string;
  name: string;
  jiraProject: string;
  created: string[];
  kept: string[];
  beside: string[];
};

// ponytail: the template's files land in the folder (CLAUDE.md is the team's once it exists; a shipped skill follows
// the app unless the team edited it — then theirs stays and the new one is written beside it), then project.json,
// xray.json and the folders; the project is remembered as the current one
export function initProject(dir: string, p: { name?: string; jiraProject?: string; language?: string }): Initialized {
  const root = resolve(dir);
  const tpl = templateDir();
  if (!existsSync(tpl)) throw new UserError(`Project template not found at ${tpl}.`, "Reinstall Testimus.");
  mkdirSync(root, { recursive: true });
  const created: string[] = [];
  const kept: string[] = [];
  const beside: string[] = [];
  const shippedFile = join(root, ".testimus", "shipped.json");
  const shipped = readJson<Record<string, string[]>>(shippedFile, {});
  const ship = (f: string, hash: string) => {
    shipped[f] = [...new Set([...(shipped[f] ?? []), hash])];
  };
  for (const f of files(tpl)) {
    const to = join(root, f);
    if (f === ".mcp.json") continue;
    const want = readFileSync(join(tpl, f));
    const wantHash = sha256(want);
    if (!existsSync(to)) {
      mkdirSync(dirname(to), { recursive: true });
      writeAtomic(to, want);
      created.push(f);
      ship(f, wantHash);
      continue;
    }
    if (f === "CLAUDE.md") {
      kept.push(f);
      continue;
    }
    const have = sha256(readFileSync(to));
    if (have !== wantHash && !(shipped[f] ?? []).includes(have)) {
      const next = f.replace(/(\.[^./]+)?$/, ".new$1");
      writeAtomic(join(root, next), want);
      kept.push(f);
      beside.push(next);
      continue;
    }
    if (have !== wantHash) writeAtomic(to, want);
    ship(f, wantHash);
  }
  writeJson(shippedFile, shipped);
  if (!existsSync(join(root, ".mcp.json"))) created.push(".mcp.json");
  ensureMcpJson(root);
  if (isProject(root)) {
    const cur = readProject(root);
    writeProject(root, {
      ...cur,
      name: p.name ?? cur.name,
      jiraProject: p.jiraProject ?? cur.jiraProject,
      language: p.language ?? cur.language,
    });
    kept.push("project.json");
  } else {
    const base = structuredClone(DEFAULT_PROJECT);
    writeProject(root, {
      ...base,
      claude: { ...base.claude, presets: [...STARTER_ASKS] },
      name: p.name ?? p.jiraProject ?? "",
      jiraProject: p.jiraProject ?? "",
      language: p.language ?? DEFAULT_PROJECT.language,
    });
    created.push("project.json");
  }
  if (existsSync(join(root, "xray.json"))) kept.push("xray.json");
  else {
    writeXray(root, structuredClone(DEFAULT_XRAY));
    created.push("xray.json");
  }
  for (const d of FOLDERS)
    if (!existsSync(join(root, d))) {
      mkdirSync(join(root, d), { recursive: true });
      created.push(`${d}/`);
    }
  rememberProject(root);
  const { name, jiraProject } = readProject(root);
  return { dir: root, name, jiraProject, created, kept, beside };
}
