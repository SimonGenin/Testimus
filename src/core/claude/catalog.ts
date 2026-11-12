import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { prompts as doctor } from "../lib/doctor.ts";
import { OVERVIEW_PATH, overviewFile, overviewGiven } from "../lib/overview.ts";
import { shipSkills } from "../lib/shipped.ts";
import { type RunKind, runCommands, TOOLS } from "./access.ts";
import { prompts as actions } from "./actions.ts";
import { prompts as analyze } from "./analyze.ts";
import { prompts as chat } from "./chat.ts";
import { prompts as check } from "./check.ts";
import { prompts as columns } from "./columns.ts";
import { prompts as comment } from "./comment.ts";
import { prompts as figures } from "./figures.ts";
import { prompts as fix } from "./fix.ts";
import { prompts as generate } from "./generate.ts";
import { attachedContexts, given, givenTemplate, type Pick, type Piece, type Subject, takesOf } from "./given.ts";
import { prompts as glossary } from "./glossary.ts";
import { prompts as headers } from "./headers.ts";
import { prompts as media } from "./media.ts";
import { prompts as overview } from "./overview.ts";
import { prompts as picture } from "./picture.ts";
import { contextDir, isShared, type PromptTemplate, readContextFile } from "./prompt.ts";
import { prompts as scoped } from "./scoped.ts";
import { prompts as status } from "./status.ts";
import { prompts as study } from "./study.ts";

export type Origin = "skill" | "built" | "file" | "context";

/** what goes with a kind of run, whatever the request: Settings › Context says it beside each prompt */
export type Takes = { overview: boolean; documents: boolean; contexts: string; tools: string[]; files: string[] };

export type Given = {
  id: string;
  name: string;
  group: string;
  origin: Origin;
  path?: string;
  file?: string;
  usedBy: string[];
  text: string;
  kind?: RunKind;
  answers?: string;
  takes?: Takes;
};

const EVERY_RUN = "Every run";
const TEAM = "Team skills";

const GIVEN: PromptTemplate = {
  id: "given",
  name: "What goes with a run",
  group: EVERY_RUN,
  usedBy: [
    "Every prompt above, where it says so: what to read first, what the team knows about the documents of the run, what is left out, the user's note and the conversation — each present only when the run has it",
  ],
  answers: "",
  text: givenTemplate,
};

// ponytail: every prompt Testimus builds, from the module that builds it — a module that runs claude -p and is missing
// here fails tests/unit/core/claude/catalog.test.ts
export const BUILT: PromptTemplate[] = [
  ...generate,
  ...check,
  ...analyze,
  ...fix,
  ...scoped,
  ...figures,
  ...headers,
  ...media,
  ...glossary,
  ...overview,
  ...study,
  ...chat,
  ...columns,
  ...comment,
  ...picture,
  ...actions,
  ...status,
  ...doctor,
  GIVEN,
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

const CONTEXT_RULE =
  "The contexts of what the run is about — a test's or a document's own list, else the project's defaults — unless the user picks others for the run";

function takes(kind: RunKind): Takes {
  const t = takesOf(kind);
  return {
    ...t,
    contexts: CONTEXT_RULE,
    tools: runCommands(kind).map((n) => n.replace(".", "_")),
    files: TOOLS[kind],
  };
}

function skillNames(project: string): string[] {
  const root = join(project, ".claude", "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

const names = (text: string, skill: string) => text.includes(`${skill} skill`);

// ponytail: a skill is used where a built prompt names it (« Use the generate-tests skill »); one no prompt names is the
// team's, and Claude picks it from its description. The skills are brought up to the app's version first, as the next
// run will (claude/run.ts): what is shown is what Claude is sent
function skills(project: string, built: Given[]): Given[] {
  try {
    shipSkills(project);
  } catch {}
  const root = join(project, ".claude", "skills");
  return skillNames(project).map((name) => {
    const by = built.filter((b) => names(b.text, name));
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

// ponytail: how the documents fit together, while it is given to every run — the file itself, as Claude reads it
function overviewEntry(project: string): Given[] {
  const file = overviewFile(project);
  if (!overviewGiven(project)) return [];
  return [
    {
      id: "file:docs/OVERVIEW.md",
      name: "How the documents fit together",
      group: EVERY_RUN,
      origin: "file",
      path: OVERVIEW_PATH,
      file,
      usedBy: [
        "Every run that searches the documents is told to read it first (Settings › Claude: Give it to every Claude run); a run may leave it out",
      ],
      text: read(file),
    },
  ];
}

function defaults(project: string): Given[] {
  return attachedContexts(project, { kind: "none" }).map(({ id }) => {
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
        "A default of the project (Settings › Context): every run on a test or a document without contexts of its own, every question and every generation",
      ],
      text: existsSync(file) ? read(file) : "",
    };
  });
}

export function listPrompts(project: string): Given[] {
  const built = BUILT.map(
    (t): Given => ({
      id: t.id,
      name: t.name,
      group: t.group,
      usedBy: t.usedBy,
      origin: "built",
      text: t.text(),
      ...(t.kind ? { kind: t.kind, takes: takes(t.kind) } : {}),
      ...(t.answers ? { answers: t.answers } : {}),
    }),
  );
  const all = [...skills(project, built), ...rules(project), ...overviewEntry(project), ...built, ...defaults(project)];
  const at = (g: string) => (GROUPS.includes(g) ? GROUPS.indexOf(g) : GROUPS.length);
  return all
    .map((g, i) => ({ g, i }))
    .sort((a, b) => at(a.g.group) - at(b.g.group) || RANK[a.g.origin] - RANK[b.g.origin] || a.i - b.i)
    .map(({ g }) => g);
}

export type Preview = {
  use: string;
  kind: RunKind;
  name: string;
  answers: string;
  pieces: Piece[];
};

// ponytail: a request before it is sent, piece by piece — the instruction (its template: the request itself is still
// being written), the skill it names, the project rules, the tools of that kind of run, then what goes with it,
// worked out by the very function the run calls (given). What can be left out is not locked
export function previewRun(project: string, use: string, subject: Subject, pick: Pick = {}): Preview {
  // ponytail: the skills and the rules are brought up to the app's version first, as the run itself will
  try {
    shipSkills(project);
  } catch {}
  const t = BUILT.find((b) => b.id === use);
  if (!t?.kind)
    throw new UserError(
      `No run sends « ${use} ».`,
      `Use the id of a prompt Testimus builds (claude.prompts): ${BUILT.filter((b) => b.kind)
        .map((b) => b.id)
        .join(", ")}.`,
    );
  const text = t.text();
  const pieces: Piece[] = [
    {
      id: "instruction",
      kind: "instruction",
      name: t.name,
      why: "What Testimus asks of this run, with your request",
      how: "inline",
      locked: true,
      on: true,
      chars: text.length,
      text,
    },
  ];
  const root = join(project, ".claude", "skills");
  for (const name of skillNames(project).filter((s) => names(text, s))) {
    const body = read(join(root, name, "SKILL.md"));
    pieces.push({
      id: `skill:${name}`,
      kind: "skill",
      name: words(name),
      why: "The method of the job: the instruction names it, Claude loads it as it starts",
      how: "auto",
      locked: true,
      on: true,
      chars: body.length,
      path: `.claude/skills/${name}/SKILL.md`,
      text: body,
    });
  }
  const claudeMd = join(project, "CLAUDE.md");
  if (existsSync(claudeMd)) {
    const body = read(claudeMd);
    pieces.push({
      id: "rules",
      kind: "rules",
      name: "Project rules",
      why: "CLAUDE.md of the project folder: Claude Code reads it by itself at every run",
      how: "auto",
      locked: true,
      on: true,
      chars: body.length,
      path: "CLAUDE.md",
      text: body,
    });
  }
  const tools = runCommands(t.kind).map((n) => n.replace(".", "_"));
  pieces.push({
    id: "tools",
    kind: "tools",
    name: `${tools.length} tool${tools.length === 1 ? "" : "s"} of the app`,
    why: "What this kind of run may call, and nothing else — each one is described to Claude at every turn",
    how: "auto",
    locked: true,
    on: true,
    chars: 0,
    detail: [...TOOLS[t.kind], ...tools].join(", "),
  });
  pieces.push(...given(project, t.kind, subject, pick).pieces);
  return { use, kind: t.kind, name: t.name, answers: t.answers, pieces };
}
