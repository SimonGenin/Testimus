import os from "node:os";
import { every, reasonOf, throwIfAborted } from "../../shared/run/work.ts";
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
// ponytail: what a conversion takes in memory — a Word or PDF document, or a batch of pictures, is about one Claude; a
// video is an ffmpeg, its frames in sharp and a Claude (1 to 1.4 GB measured on 2026-11-10) with room to spare
export const WEIGHT_MB = { document: AGENT_MB, images: AGENT_MB, video: 2500 } as const;

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

export type PoolTask = {
  weightMB?: number;
  signal?: AbortSignal;
  onWait?(): void;
};

export type AgentPool = {
  run<T>(work: () => Promise<T>, task?: PoolTask): Promise<T>;
  tick(): void;
  limit(): number;
  active(): number;
};

type Entry = { weight: number; seen: boolean; go(): void };

// ponytail: a task that weighs (the memory it will take, MB) starts only when the free memory, less what the tasks
// started since the last look will still take, covers it — except the first, which always goes, so a small PC still
// converts. Weighing is part of adapting: a fixed agents setting starts what it says
export function agentPool(
  o: Partial<AgentsSetting> & { deps?: LoadDeps; onLimit?(limit: number, load: Load): void } = {},
): AgentPool {
  const set = agentsSetting();
  const max = clampAgents(o.max ?? set.max);
  const adaptive = o.adaptive ?? set.adaptive;
  const deps = o.deps ?? loadDeps;
  let limit = adaptive ? Math.min(max, AGENTS_START) : max;
  const running = new Set<Entry>();
  const waiting: Entry[] = [];
  let prev = adaptive ? deps.cpus() : { idle: 0, total: 0 };
  let stopTicks: (() => void) | undefined;
  const fits = (e: Entry) => {
    if (!adaptive || !e.weight || !running.size) return true;
    let coming = 0;
    for (const r of running) if (!r.seen) coming += r.weight;
    return e.weight <= deps.freeMB() - coming;
  };
  const pump = () => {
    while (running.size < limit && waiting.length && fits(waiting[0])) {
      const e = waiting.shift() as Entry;
      running.add(e);
      e.go();
    }
    if (!running.size && !waiting.length && stopTicks) {
      stopTicks();
      stopTicks = undefined;
    }
  };
  const tick = () => {
    const now = deps.cpus();
    const load = { cpu: busy(prev, now), freeMB: deps.freeMB() };
    prev = now;
    for (const r of running) r.seen = true;
    const next = nextLimit(limit, running.size, load, max);
    if (next !== limit) {
      limit = next;
      o.onLimit?.(limit, load);
    }
    pump();
  };
  return {
    async run(work, t = {}) {
      throwIfAborted(t.signal);
      if (adaptive && !stopTicks) stopTicks = every(deps.everyMs, tick);
      let mine: Entry | undefined;
      await new Promise<void>((go, stop) => {
        const onAbort = () => {
          const i = waiting.indexOf(entry);
          if (i < 0) return;
          waiting.splice(i, 1);
          stop(reasonOf(t.signal as AbortSignal));
          pump();
        };
        const entry: Entry = {
          weight: t.weightMB ?? 0,
          seen: false,
          go: () => {
            t.signal?.removeEventListener("abort", onAbort);
            go();
          },
        };
        mine = entry;
        t.signal?.addEventListener("abort", onAbort, { once: true });
        waiting.push(entry);
        pump();
        if (waiting.includes(entry)) t.onWait?.();
      });
      try {
        return await work();
      } finally {
        running.delete(mine as Entry);
        pump();
      }
    },
    tick,
    limit: () => limit,
    active: () => running.size,
  };
}

// ponytail: a conversion reads a whole document in this process and may run Claude on its figures — as many at once as
// the agents setting allows; adaptive, never more than the cores (one left for the rest), each weighed (WEIGHT_MB)
export function conversionPool(set: AgentsSetting = agentsSetting(), cores = os.availableParallelism()): AgentPool {
  return agentPool({ max: set.adaptive ? Math.max(1, Math.min(set.max, cores - 1)) : set.max, adaptive: set.adaptive });
}

export const loadLine = (l: Load) => `CPU ${Math.round(l.cpu * 100)} %, ${(l.freeMB / 1024).toFixed(1)} GB free`;
