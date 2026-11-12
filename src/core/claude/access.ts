import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { UserError } from "../command.ts";
import type { SearchUse } from "../types.ts";

// ponytail: what a Claude run may touch — the built-in tools and the app's own commands (the MCP tools) by kind of
// run, and the files no run edits by hand; the command list comes from the registry, never imported from here
// (the registry imports every command, and a command starts Claude: no cycle)

const EDIT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill"];
const READ_TOOLS = ["Read", "Glob", "Grep", "Skill"];
// ponytail: a run on pictures or on a video opens the files its prompt names and, to propose a correction, looks a
// word up in the documents: no skill is its job's, and every tool it does not use is paid in each of its runs
const MEDIA_TOOLS = ["Read", "Grep"];

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
  | "analyze"
  | "generate"
  | "fix"
  | "run"
  | "triage"
  | "action"
  | "columns"
  | "study"
  | "media"
  | "overview"
  | "learn";

export const TOOLS: Record<RunKind, string[]> = {
  chat: READ_TOOLS,
  figures: ["Read"],
  media: MEDIA_TOOLS,
  headers: ["Read"],
  check: READ_TOOLS,
  analyze: READ_TOOLS,
  generate: EDIT_TOOLS,
  fix: EDIT_TOOLS,
  run: EDIT_TOOLS,
  triage: READ_TOOLS,
  action: EDIT_TOOLS,
  columns: READ_TOOLS,
  study: READ_TOOLS,
  overview: EDIT_TOOLS,
  learn: ["Read"],
};

const TEST_WRITES = ["tests.edit", "tests.save", "tests.addImage"];
// ponytail: a run that writes a test, or proposes what a test should cite, may make any second of a video a key
// frame (it looked at it with media.frame), so what is seen there can be cited and embedded — the one change to a
// document such a run may make
const KEEP_FRAME = "media.keep";

// ponytail: what a run answers with, and what it may change — each a command of the app, so a refused answer says what
// to fix and Claude corrects it in the same run
// ponytail: the chat proposes a change to the overview, a context or a column — a proposal the user applies, never a
// write; the learning run's one write is the conversations context
const EXTRA: Record<RunKind, string[]> = {
  chat: ["docs.overviewPropose", "contexts.propose", "columns.propose"],
  figures: [],
  media: [],
  headers: [],
  check: ["check.record"],
  analyze: ["analysis.record", KEEP_FRAME],
  generate: ["tests.create", ...TEST_WRITES, "check.run", KEEP_FRAME],
  fix: [...TEST_WRITES, KEEP_FRAME],
  run: [...TEST_WRITES, "check.run", KEEP_FRAME],
  triage: ["actions.propose"],
  action: [],
  columns: [],
  study: ["actions.propose"],
  overview: [],
  learn: ["contexts.learn"],
};

const DOCS = [
  "rag.search",
  "rag.mentions",
  "rag.related",
  "rag.passage",
  "rag.figure",
  "rag.status",
  "docs.list",
  "docs.show",
  "docs.page",
  "media.show",
  "media.transcript",
  "media.frame",
];
const TESTS = ["tests.list", "tests.show", "search.all", "columns.list", "check.show"];
const RUNS = ["runs.list", "runs.show", "runs.history"];
const FOLDERS = ["xray.folders", "xray.preconditions"];

// ponytail: the read-only commands a kind of run is given — the ones its job uses, not every read of the app: each
// tool's definition is sent with every turn of the run (62 of them were about 10 000 tokens a turn, for a run that
// only looks at pictures too). A question may be about anything, and so may a problem the app met: chat keeps a wide
// set, triage the whole of it
export const READS: Record<Exclude<RunKind, "action">, readonly string[] | "all"> = {
  chat: [
    ...DOCS,
    ...TESTS,
    ...RUNS,
    ...FOLDERS,
    "xray.search",
    "xray.status",
    "xray.plan",
    "issue.comments",
    "issue.people",
    "issue.transitions",
    "contexts.list",
    "contexts.show",
    "actions.list",
    "analysis.show",
    "review.queue",
    "gen.show",
    "docs.overviewShow",
  ],
  figures: [],
  media: ["media.frame"],
  headers: [],
  check: [...DOCS, "tests.list", "tests.show", "search.all", "columns.list"],
  analyze: [...DOCS, ...TESTS, "analysis.show"],
  generate: [...DOCS, ...TESTS, ...FOLDERS],
  fix: [...DOCS, ...TESTS],
  run: [...DOCS, ...TESTS, ...RUNS, ...FOLDERS],
  triage: "all",
  columns: [...DOCS, ...TESTS, "contexts.list", "contexts.show", "xray.fields"],
  study: ["docs.inspect", "docs.page", "docs.show", "docs.list", "rag.passage", "rag.figure"],
  overview: [
    "docs.list",
    "docs.show",
    "docs.overviewShow",
    "rag.search",
    "rag.mentions",
    "rag.related",
    "rag.passage",
    "rag.figure",
  ],
  learn: [],
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
  /^runs\.(?!list$|show$|history$)|^(claude\.run|analysis\.run|actions\.(run|triage|triageFailed)|gen\.(tests|bench|revise)|media\.propose|chat\.(ask|learn|apply|ignore)|contexts\.learn|review\.fix|rag\.eval|jobs\.(cancel|rerun)|docs\.(overview|overviewSave))$|^xray\.(push|connect|disconnect)$|^issue\.(transition|assign|comment|editComment|deleteComment)$|^system\.(setCredentials|set|secrets)$|^project\.(init|open|openKey|delete)$|^models\.(add|pull|pullRuntime|pullWhisper|remove|setDir|use|usePack|useSpeech)$/;

export function runCommands(kind: RunKind): string[] {
  const all = commandList().map((c) => c.name);
  if (kind === "action") return all.filter((n) => !NOT_IN_ACTION.test(n)).sort();
  const ro = readOnlyCommands();
  const reads = READS[kind];
  const allowed = new Set([...(reads === "all" ? ro : ro.filter((n) => reads.includes(n))), ...EXTRA[kind]]);
  return all.filter((n) => allowed.has(n)).sort();
}

export function mcpAccess(kind: RunKind): { allow: string[]; deny: string[] } {
  const allowed = new Set(runCommands(kind));
  const all = commandList()
    .map((c) => c.name)
    .sort();
  return {
    allow: all.filter((n) => allowed.has(n)).map(mcpName),
    deny: all.filter((n) => !allowed.has(n)).map(mcpName),
  };
}

// ponytail: the documents the user took out of a run — the run's own MCP server is started with their ids
// (claude/run.ts), and every command that finds or reads a document for Claude leaves them out or refuses them
export const WITHOUT_DOCS = "TESTIMUS_WITHOUT_DOCS";

export const leftOutDocs = (llm?: boolean): string[] =>
  llm ? (process.env[WITHOUT_DOCS] ?? "").split(",").filter(Boolean) : [];

export function refuseLeftOut(llm: boolean | undefined, docId: string): void {
  if (leftOutDocs(llm).includes(docId))
    throw new UserError(
      `${docId} is left out of this run.`,
      "The user took this document out of the run: do not search, read or cite it.",
      "doc-left-out",
    );
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

// ponytail: only the overview's own run may write docs/OVERVIEW.md — for it every document's folder stays closed by
// name, for every other run all of docs/ does. Not docs/*/**: Claude Code reads it as covering docs/OVERVIEW.md too
export function protectedRules(addDirs: string[] = [], kind?: RunKind, project?: string): string[] {
  const own =
    kind === "overview"
      ? [...PROTECTED.filter((p) => p !== "docs/**"), ...OVERVIEW_CLOSED, ...closedByName(project)]
      : PROTECTED;
  const paths = [...own, ...addDirs.map((d) => `${absRule(d)}/**`)];
  return paths.flatMap((p) => [`Edit(${p})`, `Write(${p})`]);
}

const OVERVIEW_CLOSED = ["tests/**", "eval/**"];
const NAMED = new Set([...PROTECTED, ...OVERVIEW_CLOSED].map((p) => p.split("/")[0]));

// ponytail: a deny rule cannot except one file, so the overview's run gets every other entry of the project root and
// of docs/ closed by name, as they are when it starts — what it could still create is undone after the
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
      .filter((e) => e.name !== "OVERVIEW.md")
      .map((e) => (e.isDirectory() ? `${root}/docs/${e.name}/**` : `${root}/docs/${e.name}`)),
  ];
}
