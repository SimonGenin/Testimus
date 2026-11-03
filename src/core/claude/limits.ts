import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { killTree } from "../../shared/run/process.ts";
import { type Ctx, UserError } from "../command.ts";
import { AGENTS_CAP, busy, type CpuTimes, HOT_CPU, LOW_MB, type Load, loadDeps, loadLine } from "../lib/agents.ts";
import type { AgentsLevel, AgentsMeasure } from "../types.ts";
import { mcpServer } from "./run.ts";

// ponytail: claude.exe itself is not started by the test (it would spend the subscription): its memory is counted
export const CLAUDE_MB = 350;
export const PACE_MS = 1500;

const QUERIES = [
  "conditions de déclenchement de l'alarme",
  "état affiché après la commande",
  "message présenté à l'opérateur",
  "délai de temporisation avant la retombée",
  "cas où la commande est refusée",
  "valeur par défaut au démarrage",
];

export type ProbeWorker = {
  ready: Promise<void>;
  searches(since: number): number[];
  failure(): string | null;
  stop(): void;
};

export type ProbeDeps = {
  start(): ProbeWorker;
  cpus(): CpuTimes;
  freeMB(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  windowMs: number;
  readyMs: number;
};

// ponytail: one worker is what an agent runs on this PC besides claude.exe — the project's Testimus MCP server, which
// loads the embedding model in its own memory and searches the index now and then
export function mcpWorker(project: string, paceMs = PACE_MS): ProbeWorker {
  const s = mcpServer();
  const child = spawn(s.command, s.args, {
    cwd: project,
    windowsHide: true,
    env: { ...process.env, ...s.env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const done: { at: number; ms: number }[] = [];
  const pending = new Map<number, () => void>();
  let failed: string | null = null;
  let stopped = false;
  let next = 0;
  let ready = () => {};
  const readyP = new Promise<void>((r) => {
    ready = r;
  });
  let buf = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const id = (JSON.parse(line) as { id?: unknown }).id;
        if (typeof id === "number") {
          pending.get(id)?.();
          pending.delete(id);
        }
      } catch {}
    }
  });
  const end = (why: string | null) => {
    if (!stopped && why) failed = why;
    stopped = true;
    for (const r of pending.values()) r();
    pending.clear();
    ready();
  };
  child.on("error", (e) => end(`the Testimus MCP server did not start: ${e.message}`));
  child.on("exit", (code) => end(`the Testimus MCP server stopped (exit code ${code ?? "none"})`));
  child.stdin.on("error", () => {});
  const send = (msg: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  const request = (method: string, params: object) =>
    new Promise<void>((r) => {
      if (stopped) return r();
      const id = ++next;
      pending.set(id, r);
      send({ id, method, params });
    });
  void (async () => {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "testimus-limits", version: "1" },
    });
    send({ method: "notifications/initialized" });
    for (let k = 0; !stopped; k++) {
      const t0 = Date.now();
      await request("tools/call", { name: "rag_search", arguments: { query: QUERIES[k % QUERIES.length], k: 10 } });
      if (stopped) break;
      done.push({ at: Date.now(), ms: Date.now() - t0 });
      ready();
      await wait(paceMs);
    }
  })();
  return {
    ready: readyP,
    searches: (since) => done.filter((d) => d.at >= since).map((d) => d.ms),
    failure: () => failed,
    stop() {
      stopped = true;
      if (child.pid && child.exitCode === null) killTree(child.pid);
    },
  };
}

export function probeDeps(project: string): ProbeDeps {
  return {
    start: () => mcpWorker(project),
    cpus: loadDeps.cpus,
    freeMB: loadDeps.freeMB,
    sleep: (ms, signal) => wait(ms, undefined, { signal }).catch(() => {}),
    now: () => Date.now(),
    windowMs: 6000,
    readyMs: 120000,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)]);
};

export function verdict(n: number, load: Load, searchMs: number, aloneMs: number): string | null {
  const pct = Math.round(load.cpu * 100);
  if (load.cpu >= HOT_CPU) return `With ${n} agents the CPU is at ${pct} %`;
  const left = load.freeMB - n * CLAUDE_MB;
  if (left < LOW_MB)
    return `With ${n} agents about ${(Math.max(0, left) / 1024).toFixed(1)} GB of memory would be left once each claude.exe (~${CLAUDE_MB} MB) runs`;
  if (n > 1 && aloneMs > 0 && searchMs > Math.max(3 * aloneMs, aloneMs + 1500))
    return `With ${n} agents a search takes ${searchMs} ms (${aloneMs} ms alone)`;
  return null;
}

// ponytail: agents are added one by one (two by two past 8) until the CPU, the memory or the search time says stop;
// the limit is the last count that held
export async function probeAgents(ctx: Ctx, deps: ProbeDeps, cap = AGENTS_CAP): Promise<AgentsMeasure> {
  const workers: ProbeWorker[] = [];
  const levels: AgentsLevel[] = [];
  let limit = 0;
  let reason = "";
  try {
    ctx.progress({ message: "Measuring the PC at rest" });
    const t = deps.cpus();
    await deps.sleep(deps.windowMs, ctx.signal);
    const rest = { cpu: busy(t, deps.cpus()), freeMB: deps.freeMB() };
    ctx.log("info", `At rest: ${loadLine(rest)}.`);
    if (rest.cpu >= HOT_CPU)
      throw new UserError(
        `The PC is already busy before any agent (CPU at ${Math.round(rest.cpu * 100)} %).`,
        "Close what is running (a build, a video call, another generation) and test again.",
      );
    let alone = 0;
    for (let n = 1; n <= cap && !ctx.signal.aborted; n += n < 8 ? 1 : 2) {
      ctx.progress({ message: `Starting agent ${n}`, done: limit, total: cap });
      while (workers.length < n) workers.push(deps.start());
      let late = true;
      await Promise.race([
        Promise.all(workers.map((w) => w.ready)).then(() => {
          late = false;
        }),
        deps.sleep(deps.readyMs, ctx.signal),
      ]);
      if (ctx.signal.aborted) break;
      const dead = workers.map((w) => w.failure()).find((f) => f);
      if (dead && n === 1) throw new UserError(`The test could not run one agent: ${dead}.`, "Run testimus doctor.");
      if (dead) {
        reason = `With ${n} agents, ${dead}`;
        break;
      }
      if (late) {
        reason = `With ${n} agents the last one took more than ${Math.round(deps.readyMs / 1000)} s to answer its first search`;
        break;
      }
      const t0 = deps.cpus();
      const from = deps.now();
      await deps.sleep(deps.windowMs, ctx.signal);
      if (ctx.signal.aborted) break;
      const load = { cpu: busy(t0, deps.cpus()), freeMB: deps.freeMB() };
      const searchMs = median(workers.flatMap((w) => w.searches(from)));
      if (n === 1) alone = searchMs;
      levels.push({ agents: n, cpu: Math.round(load.cpu * 100) / 100, freeMB: load.freeMB, searchMs });
      ctx.log("info", `${n} agent${n > 1 ? "s" : ""}: ${loadLine(load)}, a search in ${searchMs} ms.`);
      const why = verdict(n, load, searchMs, alone);
      if (why) {
        reason = why;
        break;
      }
      limit = n;
    }
  } finally {
    for (const w of workers) w.stop();
  }
  if (!reason) reason = ctx.signal.aborted ? "Cancelled." : `Reached ${cap}, the most Testimus allows.`;
  return { limit: Math.max(1, limit), at: new Date().toISOString(), reason, levels };
}
