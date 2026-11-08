import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { type Command, UserError } from "../core/command.ts";
import { invoke, registry } from "../core/commands/index.ts";
import { subscribe, waitJob } from "../core/jobs.ts";
import { resolveProjectDir } from "../core/lib/project.ts";
import { onStopSignals } from "../core/shell.ts";
import type { JobEvent } from "../core/types.ts";
import { killChildren, killChildrenOnExit, onParentGone } from "../shared/run/process.ts";
import { timeout } from "../shared/run/work.ts";

export function toolName(command: string): string {
  return command.replace(".", "_");
}

export type ToolCtx = {
  mcpReq: {
    signal: AbortSignal;
    _meta?: { progressToken?: string | number };
    notify(n: { method: string; params?: Record<string, unknown> }): Promise<void>;
  };
};

// ponytail: a job reports progress only when the client asked for it with a progressToken
export async function callTool(c: Command, project: string | null, input: unknown, ctx: ToolCtx): Promise<unknown> {
  const token = ctx.mcpReq?._meta?.progressToken;
  const signal = ctx.mcpReq?.signal;
  if (!c.job || token === undefined) return await invoke(c.name, input, { project, wait: true, signal, llm: true });
  let jobId = "";
  let n = 0;
  const early: JobEvent[] = [];
  const send = (e: JobEvent) => {
    if (e.jobId !== jobId || e.type !== "progress") return;
    n++;
    const of = e.total ? ` [${e.done ?? 0}/${e.total}]` : "";
    ctx.mcpReq
      .notify({
        method: "notifications/progress",
        params: { progressToken: token, progress: n, message: `${e.message}${of}` },
      })
      .catch(() => {});
  };
  const unsub = subscribe((e) => (jobId ? send(e) : early.push(e)));
  try {
    jobId = ((await invoke(c.name, input, { project, wait: false, signal })) as { jobId: string }).jobId;
    for (const e of early) send(e);
    return await waitJob(jobId);
  } finally {
    unsub();
  }
}

export function buildServer(project: string | null, version = "0.1.0"): McpServer {
  const server = new McpServer({ name: "testimus", version }, { capabilities: { tools: {} } });
  for (const c of registry) {
    if (c.mcp === false) continue;
    server.registerTool(
      toolName(c.name),
      {
        description: `${c.summary}${c.mutates ? " (changes files or Jira)" : ""}${c.job ? " Runs as a job." : ""}`,
        inputSchema: c.input as never,
      },
      (async (input: unknown, ctx: ToolCtx) => {
        try {
          const result = await callTool(c, project, input ?? {}, ctx);
          return { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const fix = e instanceof UserError && e.fix ? `\n${e.fix}` : "";
          return { content: [{ type: "text", text: `${msg}${fix}` }], isError: true };
        }
      }) as never,
    );
  }
  return server;
}

export async function mcp(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { project: { type: "string" } }, strict: false });
  const project = resolveProjectDir(typeof values.project === "string" ? values.project : undefined);
  serveStdio(() => buildServer(project));
  // ponytail: Claude runs this server as its child, talking over stdin; when Claude goes, so does the server and every
  // program it started (a model server, a worker) — whatever ended the session
  killChildrenOnExit();
  let leaving = false;
  const leave = async () => {
    if (leaving) return;
    leaving = true;
    killChildren();
    const { stopAllServers } = await import("../core/rag/runtimes/llamacpp.ts");
    await timeout(5000, () => stopAllServers()).catch(() => {});
    process.exit(0);
  };
  onParentGone(process.stdin, () => void leave());
  onStopSignals(() => void leave());
}
