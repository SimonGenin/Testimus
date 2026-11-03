import { resolve } from "node:path";

// ponytail: what a Claude run may touch — the built-in tools and the app's own commands (the MCP tools) by kind of
// run, and the files no run edits by hand; the command list comes from the registry, never imported from here
// (the registry imports every command, and a command starts Claude: GOAL-V3 N4, no cycle)

export const EDIT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill"];
export const READ_TOOLS = ["Read", "Glob", "Grep", "Skill"];

export type RunKind =
  | "chat"
  | "figures"
  | "headers"
  | "check"
  | "generate"
  | "fix"
  | "run"
  | "triage"
  | "action"
  | "columns"
  | "study";

export const TOOLS: Record<RunKind, string[]> = {
  chat: READ_TOOLS,
  figures: ["Read"],
  headers: ["Read"],
  check: READ_TOOLS,
  generate: EDIT_TOOLS,
  fix: EDIT_TOOLS,
  run: EDIT_TOOLS,
  triage: READ_TOOLS,
  action: EDIT_TOOLS,
  columns: READ_TOOLS,
  study: READ_TOOLS,
};

const TEST_WRITES = ["tests.edit", "tests.save", "tests.addImage"];

const EXTRA: Record<RunKind, string[]> = {
  chat: [],
  figures: [],
  headers: [],
  check: ["check.record", "actions.propose"],
  generate: ["tests.create", ...TEST_WRITES, "check.run", "actions.propose"],
  fix: TEST_WRITES,
  run: [...TEST_WRITES, "check.run"],
  triage: ["actions.propose"],
  action: [],
  columns: [],
  study: ["actions.propose"],
};

export type CommandInfo = { name: string; mutates: boolean; job?: string };

let provided: (() => readonly CommandInfo[]) | null = null;

export function provideCommands(list: () => readonly CommandInfo[]): void {
  provided = list;
}

function commandList(): readonly CommandInfo[] {
  if (!provided) throw new Error("The command registry is not loaded: import src/core/commands/index.ts first.");
  return provided();
}

// ponytail: read-only = mutates:false and no job, minus what touches the app or the machine
const NOT_READ_ONLY = /^(system|project|jobs|claude)\./;

export const mcpName = (command: string) => `mcp__testimus__${command.replace(".", "_")}`;

export function readOnlyCommands(): string[] {
  return commandList()
    .filter((c) => !c.mutates && !c.job && !NOT_READ_ONLY.test(c.name))
    .map((c) => c.name)
    .sort();
}

// ponytail: an action runs with the app's whole command set (what the CLI and the buttons do), minus another
// Claude run, Jira writes (the user pushes), and what changes the machine or which project is open
const NOT_IN_ACTION =
  /^(claude\.run|actions\.(run|triage|triageFailed)|gen\.(tests|bench)|chat\.ask|review\.fix|rag\.eval|jobs\.cancel)$|^xray\.(push|connect|disconnect)$|^system\.(setup|saveSettings|secrets)$|^project\.(init|open|openKey)$|^models\.(add|pull|pullRuntime|remove|setDir|use|usePack)$/;

export function mcpAccess(kind: RunKind): { allow: string[]; deny: string[] } {
  const ro = readOnlyCommands();
  const all = commandList()
    .map((c) => c.name)
    .sort();
  const allowed = new Set(kind === "action" ? all.filter((n) => !NOT_IN_ACTION.test(n)) : [...ro, ...EXTRA[kind]]);
  return {
    allow: all.filter((n) => allowed.has(n)).map(mcpName),
    deny: all.filter((n) => !allowed.has(n)).map(mcpName),
  };
}

export const PROTECTED = [
  "docs/**",
  "index/**",
  ".testimus/**",
  "contexts/**",
  ".claude/**",
  "project.json",
  "xray.json",
  "columns.json",
  ".mcp.json",
  "CLAUDE.md",
];

// ponytail: Claude Code matches Windows paths in POSIX form — C:\a\b is //c/a/b in a rule
export function absRule(dir: string): string {
  const p = resolve(dir).replace(/\\/g, "/");
  const m = p.match(/^([A-Za-z]):(.*)$/);
  return `/${m ? `/${m[1].toLowerCase()}${m[2]}` : p}`.replace(/\/+$/, "");
}

export function protectedRules(addDirs: string[] = []): string[] {
  const paths = [...PROTECTED, ...addDirs.map((d) => `${absRule(d)}/**`)];
  return paths.flatMap((p) => [`Edit(${p})`, `Write(${p})`]);
}
