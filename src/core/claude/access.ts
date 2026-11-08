import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SearchUse } from "../types.ts";

// ponytail: what a Claude run may touch — the built-in tools and the app's own commands (the MCP tools) by kind of
// run, and the files no run edits by hand; the command list comes from the registry, never imported from here
// (the registry imports every command, and a command starts Claude: no cycle)

const EDIT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill"];
const READ_TOOLS = ["Read", "Glob", "Grep", "Skill"];

// ponytail: what a Claude run takes from search, through its MCP tools — the words and the document's structure always,
// the active embedding to rank, never the reranker: Claude reads the passages and judges better than any reranker. The
// MCP face holds rag.search to it; another LLM's runs declare their own line here
export const CLAUDE_SEARCH: SearchUse = {
  id: "claude",
  who: "Claude, while it writes or checks tests (rag_search, rag_mentions, rag_related)",
  when: "Generate, Check, Fix, Ask, Claude's actions",
  words: "always",
  embedding: "uses",
  reranker: "no",
  why: "not in Claude's loop",
};

// ponytail: the one place an LLM's search (a command called through the MCP face: ctx.llm) leaves the reranker out —
// rag.search and search.all both take it, so no path puts the reranker back in Claude's loop
export const llmSearch = (llm?: boolean): { reranker?: null } =>
  llm && CLAUDE_SEARCH.reranker === "no" ? { reranker: null } : {};

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
  | "study"
  | "media"
  | "overview";

export const TOOLS: Record<RunKind, string[]> = {
  chat: READ_TOOLS,
  figures: ["Read"],
  media: READ_TOOLS,
  headers: ["Read"],
  check: READ_TOOLS,
  generate: EDIT_TOOLS,
  fix: EDIT_TOOLS,
  run: EDIT_TOOLS,
  triage: READ_TOOLS,
  action: EDIT_TOOLS,
  columns: READ_TOOLS,
  study: READ_TOOLS,
  overview: EDIT_TOOLS,
};

const TEST_WRITES = ["tests.edit", "tests.save", "tests.addImage"];

const EXTRA: Record<RunKind, string[]> = {
  chat: [],
  figures: [],
  media: [],
  headers: [],
  check: ["check.record", "actions.propose"],
  generate: ["tests.create", ...TEST_WRITES, "check.run", "actions.propose"],
  fix: TEST_WRITES,
  run: [...TEST_WRITES, "check.run"],
  triage: ["actions.propose"],
  action: [],
  columns: [],
  study: ["actions.propose"],
  overview: [],
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

// ponytail: read-only = mutates:false and no job, minus what touches the app or the machine; what Claude is given
// (claude.prompts) is a read like the others
const NOT_READ_ONLY = /^(system|project|jobs)\.|^claude\.(?!prompts$)/;

export const mcpName = (command: string) => `mcp__testimus__${command.replace(".", "_")}`;

export function readOnlyCommands(): string[] {
  return commandList()
    .filter((c) => !c.mutates && !c.job && !NOT_READ_ONLY.test(c.name))
    .map((c) => c.name)
    .sort();
}

// ponytail: an action runs with the app's whole command set (what the CLI and the buttons do), minus another
// Claude run, Jira writes (the user pushes, moves, assigns and comments), what changes the machine or which
// project is open, a test run's results (a tester's findings: Claude reads runs, never marks one) and the overview of the
// documents (written by its own run only)
const NOT_IN_ACTION =
  /^runs\.(?!list$|show$|history$)|^(claude\.run|actions\.(run|triage|triageFailed)|gen\.(tests|bench|revise)|chat\.ask|review\.fix|rag\.eval|jobs\.(cancel|rerun)|docs\.(overview|overviewSave))$|^xray\.(push|connect|disconnect)$|^issue\.(transition|assign|comment|editComment|deleteComment)$|^system\.(setCredentials|set|secrets)$|^project\.(init|open|openKey|delete)$|^models\.(add|pull|pullRuntime|remove|setDir|use|usePack)$/;

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

const PROTECTED = [
  "docs/**",
  "test-runs/**",
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

// ponytail: only the overview's own run may write docs/OVERVIEW.md — for it every document's folder stays closed
// (docs/*/**), for every other run all of docs/ does
export function protectedRules(addDirs: string[] = [], kind?: RunKind, project?: string): string[] {
  const own =
    kind === "overview"
      ? [...PROTECTED.map((p) => (p === "docs/**" ? "docs/*/**" : p)), ...OVERVIEW_CLOSED, ...closedByName(project)]
      : PROTECTED;
  const paths = [...own, ...addDirs.map((d) => `${absRule(d)}/**`)];
  return paths.flatMap((p) => [`Edit(${p})`, `Write(${p})`]);
}

const OVERVIEW_CLOSED = ["tests/**", "eval/**"];
const NAMED = new Set([...PROTECTED, ...OVERVIEW_CLOSED].map((p) => p.split("/")[0]));

// ponytail: a deny rule cannot except one file, so the overview's run gets every other entry of the project root and
// every other file of docs/ closed by name, as they are when it starts — what it could still create is undone after the
// run (claude/overview-scope.ts). A name a rule cannot carry (a comma, a bracket, a glob character) is left to that too
function closedByName(project?: string): string[] {
  if (!project) return [];
  const root = absRule(project);
  const carried = (n: string) => !/[,()[\]{}*?!\\]/.test(n);
  const list = (rel: string) => {
    try {
      return readdirSync(join(project, rel), { withFileTypes: true }).filter((e) => carried(e.name));
    } catch {
      return [];
    }
  };
  return [
    ...list("")
      .filter((e) => !NAMED.has(e.name) && e.name !== "docs")
      .map((e) => (e.isDirectory() ? `${root}/${e.name}/**` : `${root}/${e.name}`)),
    ...list("docs")
      .filter((e) => !e.isDirectory() && e.name !== "OVERVIEW.md")
      .map((e) => `${root}/docs/${e.name}`),
  ];
}
