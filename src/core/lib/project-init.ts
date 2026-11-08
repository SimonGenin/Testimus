import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureMcpJson } from "../claude/run.ts";
import { UserError } from "../command.ts";
import {
  DEFAULT_PROJECT,
  DEFAULT_XRAY,
  isProject,
  readProject,
  rememberProject,
  writeProject,
  writeXray,
} from "./project.ts";
import { shipTemplate, templateDir } from "./shipped.ts";

const FOLDERS = ["docs", "tests", "contexts"];

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

// ponytail: the template's files land in the folder (shipTemplate), then project.json, xray.json and the folders; the
// project is remembered as the current one
export function initProject(dir: string, p: { name?: string; jiraProject?: string; language?: string }): Initialized {
  const root = resolve(dir);
  const tpl = templateDir();
  if (!existsSync(tpl)) throw new UserError(`Project template not found at ${tpl}.`, "Reinstall Testimus.");
  mkdirSync(root, { recursive: true });
  const { created, kept, beside } = shipTemplate(root);
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
