import os from "node:os";
import { every } from "../../shared/run/work.ts";
import { readSettings } from "./project.ts";

export const AGENTS_DEFAULT = 5;
export const AGENTS_CAP = 32;
export const AGENTS_START = 2;
export const HOT_CPU = 0.85;
export const BURNING_CPU = 0.95;
export const COOL_CPU = 0.7;
export const LOW_MB = 1500;
export const CRITICAL_MB = 800;
// ponytail: one more agent is a claude.exe and its own Testimus MCP server holding the embedding model in memory
export const AGENT_MB = 1000;

export type Load = { cpu: number; freeMB: number };
export type CpuTimes = { idle: number; total: number };
export type LoadDeps = { cpus(): CpuTimes; freeMB(): number; everyMs: number };
export type AgentsSetting = { max: number; adaptive: boolean };

export function cpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

export const busy = (a: CpuTimes, b: CpuTimes): number => {
  const total = b.total - a.total;
  return total > 0 ? Math.min(1, Math.max(0, 1 - (b.idle - a.idle) / total)) : 0;
};

export const loadDeps: LoadDeps = {
  cpus: cpuTimes,
  freeMB: () => Math.floor(os.freemem() / (1024 * 1024)),
  everyMs: 3000,
};

export const clampAgents = (n: number) =>
  Number.isFinite(Number(n)) ? Math.min(AGENTS_CAP, Math.max(1, Math.round(n))) : AGENTS_DEFAULT;

export function agentsSetting(): AgentsSetting {
  const a = readSettings().agents;
  return { max: clampAgents(a?.max ?? AGENTS_DEFAULT), adaptive: a?.adaptive ?? true };
}

// ponytail: a busy PC starts no new agent, a struggling one lets one finish without a successor; a PC with room
// gets one more, only once every slot is taken — a limit nobody reaches says nothing about the load it would bring
export function nextLimit(limit: number, active: number, load: Load, max: number): number {
  if (load.cpu >= BURNING_CPU || load.freeMB < CRITICAL_MB) return Math.max(1, Math.min(limit, active) - 1);
  if (load.cpu >= HOT_CPU || load.freeMB < LOW_MB) return Math.max(1, Math.min(limit, active));
  if (load.cpu < COOL_CPU && load.freeMB >= LOW_MB + AGENT_MB && active >= limit) return Math.min(max, limit + 1);
  return Math.min(limit, max);
}

export type AgentPool = {
  run<T>(work: () => Promise<T>): Promise<T>;
  tick(): void;
  limit(): number;
  active(): number;
};

export function agentPool(
  o: Partial<AgentsSetting> & { deps?: LoadDeps; onLimit?(limit: number, load: Load): void } = {},
): AgentPool {
  const set = agentsSetting();
  const max = clampAgents(o.max ?? set.max);
  const adaptive = o.adaptive ?? set.adaptive;
  const deps = o.deps ?? loadDeps;
  let limit = adaptive ? Math.min(max, AGENTS_START) : max;
  let active = 0;
  const waiting: (() => void)[] = [];
  let prev = adaptive ? deps.cpus() : { idle: 0, total: 0 };
  let stopTicks: (() => void) | undefined;
  const pump = () => {
    while (active < limit && waiting.length) {
      active++;
      waiting.shift()?.();
    }
    if (!active && !waiting.length && stopTicks) {
      stopTicks();
      stopTicks = undefined;
    }
  };
  const tick = () => {
    const now = deps.cpus();
    const load = { cpu: busy(prev, now), freeMB: deps.freeMB() };
    prev = now;
    const next = nextLimit(limit, active, load, max);
    if (next !== limit) {
      limit = next;
      o.onLimit?.(limit, load);
    }
    pump();
  };
  return {
    async run(work) {
      if (adaptive && !stopTicks) stopTicks = every(deps.everyMs, tick);
      await new Promise<void>((r) => {
        waiting.push(r);
        pump();
      });
      try {
        return await work();
      } finally {
        active--;
        pump();
      }
    },
    tick,
    limit: () => limit,
    active: () => active,
  };
}

// ponytail: a conversion reads a whole document in this process and may run Claude on its figures — as many at once as
// the agents setting allows; adaptive, no more than the cores (one left for the rest) and the free memory (AGENT_MB
// each) allow, read when a batch of conversions starts
export function conversionsAtOnce(
  set: AgentsSetting = agentsSetting(),
  cores = os.availableParallelism(),
  freeMB = loadDeps.freeMB(),
): number {
  if (!set.adaptive) return set.max;
  return Math.max(1, Math.min(set.max, cores - 1, Math.floor(freeMB / AGENT_MB)));
}

export const loadLine = (l: Load) => `CPU ${Math.round(l.cpu * 100)} %, ${(l.freeMB / 1024).toFixed(1)} GB free`;
