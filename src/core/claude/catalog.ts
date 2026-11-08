import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prompts as doctor } from "../lib/doctor.ts";
import { shipSkills } from "../lib/shipped.ts";
import { prompts as actions } from "./actions.ts";
import { prompts as chat } from "./chat.ts";
import { prompts as check } from "./check.ts";
import { prompts as columns } from "./columns.ts";
import { prompts as comment } from "./comment.ts";
import { prompts as figures } from "./figures.ts";
import { prompts as fix } from "./fix.ts";
import { prompts as generate } from "./generate.ts";
import { prompts as headers } from "./headers.ts";
import { prompts as media } from "./media.ts";
import {
  contextDir,
  contextsTemplate,
  effectiveContexts,
  isShared,
  type PromptTemplate,
  readContextFile,
} from "./prompt.ts";
import { prompts as scoped } from "./scoped.ts";
import { prompts as status } from "./status.ts";
import { prompts as study } from "./study.ts";

export type Origin = "skill" | "built" | "file" | "context";

export type Given = {
  id: string;
  name: string;
  group: string;
  origin: Origin;
  path?: string;
  file?: string;
  usedBy: string[];
  text: string;
};

const EVERY_RUN = "Every run";
const TEAM = "Team skills";

const CONTEXTS: PromptTemplate = {
  id: "contexts",
  name: "Attached contexts, the note, the conversation",
  group: EVERY_RUN,
  usedBy: ["Every prompt above where it says {contexts}: the run's contexts, the user's note, the conversation so far"],
  text: contextsTemplate,
};

// ponytail: every prompt Testimus builds, from the module that builds it — a module that runs claude -p and is missing
// here fails tests/unit/core/claude/catalog.test.ts
export const BUILT: PromptTemplate[] = [
  ...generate,
  ...check,
  ...fix,
  ...scoped,
  ...figures,
  ...headers,
  ...media,
  ...study,
  ...chat,
  ...columns,
  ...comment,
  ...actions,
  ...status,
  ...doctor,
  CONTEXTS,
];

const GROUPS = [
  "Generation",
  "Check and fix",
  "Tests",
  "Documents",
  "Chat",
  "Smart columns",
  "Jira",
  "Claude actions",
  TEAM,
  "System check",
  EVERY_RUN,
];
const RANK: Record<Origin, number> = { skill: 0, file: 1, built: 2, context: 3 };

const read = (file: string) => readFileSync(file, "utf8").replace(/^﻿/, "");
const slash = (p: string) => p.replace(/\\/g, "/");
const words = (name: string) => {
  const s = name.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ponytail: a skill is used where a built prompt names it (« Use the generate-tests skill »); one no prompt names is the
// team's, and Claude picks it from its description. The skills are brought up to the app's version first, as the next
// run will (claude/run.ts): what is shown is what Claude is sent
function skills(project: string, built: Given[]): Given[] {
  try {
    shipSkills(project);
  } catch {}
  const root = join(project, ".claude", "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const by = built.filter((b) => b.text.includes(`${name} skill`));
      const path = `.claude/skills/${name}/SKILL.md`;
      return {
        id: `skill:${name}`,
        name: words(name),
        group: by[0]?.group ?? TEAM,
        origin: "skill" as const,
        path,
        file: join(root, name, "SKILL.md"),
        usedBy: by.length
          ? [...new Set(by.flatMap((b) => b.usedBy))]
          : ["Any run, when Claude finds the request matches the skill's description"],
        text: read(join(root, name, "SKILL.md")),
      };
    });
}

function rules(project: string): Given[] {
  const file = join(project, "CLAUDE.md");
  if (!existsSync(file)) return [];
  return [
    {
      id: "file:CLAUDE.md",
      name: "Project rules",
      group: EVERY_RUN,
      origin: "file",
      path: "CLAUDE.md",
      file,
      usedBy: ["Every Claude run in this project folder: Claude Code reads it itself"],
      text: read(file),
    },
  ];
}

function defaults(project: string): Given[] {
  return effectiveContexts(project).map((id) => {
    const dir = contextDir(project, id);
    const file = join(dir, "context.md");
    const shared = isShared(project, id);
    return {
      id: `context:${id}`,
      name: readContextFile(dir).name || id,
      group: EVERY_RUN,
      origin: "context" as const,
      path: shared ? slash(file) : `contexts/${id}/context.md`,
      file,
      usedBy: [
        "Attached by default (Settings › Claude): every run on a test without contexts of its own, every document run",
      ],
      text: existsSync(file) ? read(file) : "",
    };
  });
}

export function listPrompts(project: string): Given[] {
  const built = BUILT.map((t): Given => ({ ...t, origin: "built", text: t.text() }));
  const all = [...skills(project, built), ...rules(project), ...built, ...defaults(project)];
  const at = (g: string) => (GROUPS.includes(g) ? GROUPS.indexOf(g) : GROUPS.length);
  return all
    .map((g, i) => ({ g, i }))
    .sort((a, b) => at(a.g.group) - at(b.g.group) || RANK[a.g.origin] - RANK[b.g.origin] || a.i - b.i)
    .map(({ g }) => g);
}
