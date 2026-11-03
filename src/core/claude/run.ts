import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExe } from "../../shared/run/process.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { withProcess } from "../jobs.ts";
import { perfScope, recordPerf } from "../lib/models-perf.ts";
import { readJson, writeJson } from "../lib/project.ts";
import type { ClaudeEvent, ClaudeResult, ClaudeScope, Effort } from "../types.ts";
import { diagnose } from "./diagnose.ts";
import { contextDir, readContexts } from "./prompt.ts";
import { finishSnapshot, takeSnapshot } from "./snapshot.ts";
import { claudeAnswered, claudeExe, forShell } from "./status.ts";
import { sessionOf, streamParser, type ToolCall, toolCalls, writtenTests } from "./stream.ts";

export { forShell };

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

const TOOLS: Record<RunKind, string[]> = {
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

// ponytail: read-only = mutates:false, minus whatever starts Claude, a job, or touches the app or the machine
const NOT_READ_ONLY = /^(system|project|jobs|claude)\.|^chat\.ask$|^rag\.eval$/;

export const mcpName = (command: string) => `mcp__testimus__${command.replace(".", "_")}`;

async function commandList(): Promise<{ name: string; mutates: boolean; job?: string }[]> {
  const { registry } = await import("../commands/index.ts");
  return registry;
}

export async function readOnlyCommands(): Promise<string[]> {
  return (await commandList())
    .filter((c) => !c.mutates && !c.job && !NOT_READ_ONLY.test(c.name))
    .map((c) => c.name)
    .sort();
}

// ponytail: an action runs with the app's whole command set (what the CLI and the buttons do), minus another
// Claude run, Jira writes (the user pushes), and what changes the machine or which project is open
const NOT_IN_ACTION =
  /^(claude\.run|actions\.(run|triage)|gen\.(tests|bench)|chat\.ask|review\.fix|rag\.eval|jobs\.cancel)$|^xray\.(push|connect|disconnect)$|^system\.(setup|saveSettings|secrets|pullModel)$|^project\.(init|open|openKey)$|^models\.(add|pull|pullRuntime|remove|setDir|use|usePack)$/;

export async function mcpAccess(kind: RunKind): Promise<{ allow: string[]; deny: string[] }> {
  const all = (await commandList()).map((c) => c.name).sort();
  const allowed = new Set(
    kind === "action" ? all.filter((n) => !NOT_IN_ACTION.test(n)) : [...(await readOnlyCommands()), ...EXTRA[kind]],
  );
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

const MODEL = /^[A-Za-z0-9.\-[\]:]+$/;
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function checkModel(model: string): string {
  if (!MODEL.test(model))
    throw new UserError(
      `Not a model name: ${JSON.stringify(model.slice(0, 60))}.`,
      "Use an alias (opus, sonnet, haiku) or a model id — letters, digits and . - [ ] : only.",
    );
  return model;
}

export function checkEffort(effort: string): Effort {
  if (!EFFORTS.includes(effort as Effort))
    throw new UserError(`Not an effort level: ${JSON.stringify(effort.slice(0, 30))}.`, `Use ${EFFORTS.join(", ")}.`);
  return effort as Effort;
}

const CLI = fileURLToPath(new URL("../../faces/cli.ts", import.meta.url));
export const IN_CLAUDE = { TESTIMUS_IN_CLAUDE: "1" };

type McpServer = { command: string; args: string[]; env: Record<string, string> };

// ponytail: the Claude run must call back into the same Testimus — the source checkout in development,
// the installed shim by its absolute path (testimus.cmd sets TESTIMUS_HOME_BIN), through cmd /c as
// Claude Code needs for a .cmd on Windows; the env tells the server it runs under Claude
export function mcpServer(): McpServer {
  const bin = process.env.TESTIMUS_HOME_BIN;
  if (bin) {
    const shim = /\.(cmd|exe|bat)$/i.test(bin) ? bin : join(bin, "testimus.cmd");
    return /\.(cmd|bat)$/i.test(shim)
      ? { command: "cmd", args: ["/c", shim, "mcp"], env: IN_CLAUDE }
      : { command: shim, args: ["mcp"], env: IN_CLAUDE };
  }
  if (existsSync(CLI)) return { command: "node", args: [CLI.replace(/\\/g, "/"), "mcp"], env: IN_CLAUDE };
  return { command: "testimus", args: ["mcp"], env: IN_CLAUDE };
}

type McpJson = { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };

export function ensureMcpJson(project: string): string {
  const file = join(project, ".mcp.json");
  const cur = readJson<McpJson>(file, {});
  const want = mcpServer();
  const have = cur.mcpServers?.testimus;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const env = { ...have?.env, ...want.env };
  if (have?.command !== want.command || !same(have?.args, want.args) || !same(have?.env, env))
    writeJson(file, { ...cur, mcpServers: { ...cur.mcpServers, testimus: { ...have, ...want, env } } });
  return file;
}

export type ClaudeArgs = {
  model: string;
  effort: Effort;
  mcpConfig: string;
  tools: string[];
  mcpTools?: string[];
  disallowedTools?: string[];
  addDirs?: string[];
  resume?: string;
};

export function claudeArgs(a: ClaudeArgs): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    a.model,
    "--effort",
    a.effort,
    "--permission-mode",
    "acceptEdits",
    "--mcp-config",
    a.mcpConfig,
    "--strict-mcp-config",
    "--tools",
    a.tools.join(","),
    "--allowedTools",
    [...(a.mcpTools ?? []), ...a.tools].join(","),
  ];
  if (a.disallowedTools?.length) args.push("--disallowedTools", a.disallowedTools.join(","));
  if (a.addDirs?.length) args.push("--add-dir", ...a.addDirs);
  if (a.resume) args.push("--resume", a.resume);
  return args;
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export function contextDirs(project: string, ids: string[]): string[] {
  const dirs = new Set<string>();
  for (const c of readContexts(project, ids)) {
    dirs.add(contextDir(project, c.id));
    for (const p of c.paths) {
      const abs = resolve(project, p);
      dirs.add(isDir(abs) ? abs : abs.replace(/[\\/][^\\/]*$/, "") || abs);
    }
  }
  return [...dirs].filter(isDir);
}

const tail = (s: string) =>
  s
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("{"))
    .slice(-3)
    .join("\n")
    .slice(-500);

export type RunOpts = {
  kind: RunKind;
  project: string;
  prompt: string;
  model: string;
  effort: Effort;
  scope?: ClaudeScope;
  contexts?: string[];
  resume?: string;
  signal?: AbortSignal;
  jobId?: string;
  runId?: string;
  files?: boolean;
  label?: string;
  // ponytail: how the run is named in its job's processes (a test's title); the label otherwise
  title?: string;
  onEvent?(e: ClaudeEvent): void;
};

export type RunResult = ClaudeResult & {
  runId: string;
  changedSteps: Record<string, number[]>;
  written: string[];
  calls: ToolCall[];
};

export type RunMeta = { kind: RunKind; model: string; effort: Effort; at: string; jobId?: string; label?: string };

export const runMeta = (project: string, runId: string) => join(project, ".testimus", "runs", runId, "claude.json");

export function readRunMeta(project: string, runId: string): RunMeta | null {
  if (!/^[\w-]+$/.test(runId)) return null;
  const m = readJson<Partial<RunMeta>>(runMeta(project, runId), {});
  return m.kind && m.model && m.effort ? (m as RunMeta) : null;
}

export function newRunId(): string {
  return `run-${env.now().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
}

export async function runClaude(o: RunOpts): Promise<RunResult> {
  const project = resolve(o.project);
  const model = checkModel(o.model);
  const effort = checkEffort(o.effort);
  const addDirs = contextDirs(project, o.contexts ?? []);
  const inside = (d: string) => `${d.toLowerCase()}${sep}`.startsWith(`${project.toLowerCase()}${sep}`);
  const external = addDirs.filter((d) => !inside(d));
  const mcp = await mcpAccess(o.kind);
  const args = claudeArgs({
    model,
    effort,
    mcpConfig: ensureMcpJson(project),
    tools: TOOLS[o.kind],
    mcpTools: mcp.allow,
    disallowedTools: [...mcp.deny, ...protectedRules(external)],
    addDirs,
    resume: o.resume,
  });
  const shell = forShell(resolveExe(claudeExe()), args);
  const runId = o.runId ?? newRunId();
  if (o.scope) takeSnapshot(project, runId, o.scope, o.files === true);
  writeJson(runMeta(project, runId), {
    kind: o.kind,
    model,
    effort,
    at: env.now().toISOString(),
    ...(o.jobId ? { jobId: o.jobId } : {}),
    ...(o.label ? { label: o.label } : {}),
  });
  let result: Extract<ClaudeEvent, { type: "result" }> | undefined;
  const live = streamParser((e) => o.onEvent?.(e));
  const started = Date.now();
  const out = await withProcess(
    `Claude · ${o.title ?? o.label ?? o.kind}`,
    "claude -p",
    (pid) =>
      env
        .spawnClaude({
          exe: shell.exe,
          args: shell.args,
          cwd: project,
          stdin: o.prompt,
          signal: o.signal,
          onLine: (l) => live.push(`${l}\n`),
          onSpawn: pid,
        })
        .catch((err: unknown) => ({ code: -1, stdout: "", stderr: err instanceof Error ? err.message : String(err) })),
    (r) => r.code,
  );
  live.end();
  const whole = streamParser((e) => {
    if (e.type === "result") result = e;
  });
  whole.push(out.stdout);
  whole.end();
  if (out.stderr.trim()) o.onEvent?.({ type: "stderr", text: out.stderr.trim().slice(-2000) });

  const calls = toolCalls(out.stdout);
  const written = writtenTests(calls);
  const rec = o.scope ? finishSnapshot(project, runId, written) : null;
  const stdout = out.stdout
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('{"type":"system"'))
    .join("\n");
  const raw = [stdout, out.stderr]
    .filter((s) => s.trim())
    .join("\n")
    .slice(-20000);
  const base = {
    runId,
    changedTests: rec?.changedTests ?? [],
    changedSteps: rec?.changedSteps ?? {},
    written,
    calls,
    raw,
    durationMs: result?.durationMs || Date.now() - started,
    costUsd: result?.costUsd,
    tokens: result?.tokens,
    sessionId: result?.sessionId ?? sessionOf(out.stdout),
  };
  if (!o.signal?.aborted)
    recordPerf({
      at: env.now().toISOString(),
      op: "claude.run",
      model,
      ...perfScope(),
      project,
      ...(o.jobId ? { jobId: o.jobId } : {}),
      items: 1,
      ms: Math.round(base.durationMs),
    });
  if (o.signal?.aborted) return { ...base, ok: false, summary: "Cancelled" };
  const ok = !!result && result.ok && out.code === 0;
  const summary =
    result?.text || (ok ? "" : tail(out.stderr) || tail(out.stdout) || `claude exited with code ${out.code}`);
  if (result) claudeAnswered();
  return { ...base, ok, summary, diagnosis: ok ? undefined : diagnose(`${summary}\n${out.stderr}`) };
}
