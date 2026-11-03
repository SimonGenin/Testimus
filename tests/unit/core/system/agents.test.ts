import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mcpWorker,
  type ProbeDeps,
  type ProbeWorker,
  probeAgents,
  probeDeps,
  verdict,
} from "../../../../src/core/claude/limits.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { agentProbe } from "../../../../src/core/commands/system.ts";
import { env } from "../../../../src/core/env.ts";
import { agentPool, agentsSetting, busy, type LoadDeps, nextLimit } from "../../../../src/core/lib/agents.ts";
import { DEFAULT_SETTINGS, readSettings, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockProbeDeps } from "../../../../src/core/mock/agents.ts";
import { indexFile } from "../../../../src/core/rag/db.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");

// ponytail: a PC whose busy share and free memory the test sets before each tick
function fakeLoad(cpu = 0.2, freeMB = 16000) {
  const m = { cpu, freeMB, idle: 0, total: 0 };
  const deps: LoadDeps = {
    cpus() {
      m.total += 1000;
      m.idle += 1000 * (1 - m.cpu);
      return { idle: m.idle, total: m.total };
    },
    freeMB: () => m.freeMB,
    everyMs: 1e9,
  };
  return { m, deps };
}

const held = () => {
  const open: (() => void)[] = [];
  const work = () => new Promise<void>((r) => open.push(r));
  return { open, work, release: () => open.shift()?.() };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  rmSync(join(env.dataDir(), "settings.json"), { force: true });
});
afterEach(() => {
  env.mock = false;
  agentProbe.deps = probeDeps;
});

describe("agents setting", () => {
  it("defaults to 5 agents, adapting; a saved value is clamped to 1–32", async () => {
    expect(agentsSetting()).toEqual({ max: 5, adaptive: true });
    await invoke("system.set", { agentsMax: 12, agentsAdaptive: false }, { project: null });
    expect(agentsSetting()).toEqual({ max: 12, adaptive: false });
    expect(((await invoke("system.settings", {}, { project: null })) as any).agents).toEqual({
      max: 12,
      adaptive: false,
    });
    await expect(invoke("system.set", { agentsMax: 40 }, { project: null })).rejects.toThrow();
    writeSettings({ ...DEFAULT_SETTINGS, agents: { max: 99 } });
    expect(agentsSetting().max).toBe(32);
  });
});

describe("load", () => {
  it("busy is the non-idle share of the CPU time between two samples", () => {
    expect(busy({ idle: 0, total: 0 }, { idle: 250, total: 1000 })).toBe(0.75);
    expect(busy({ idle: 5, total: 5 }, { idle: 5, total: 5 })).toBe(0);
  });

  it("nextLimit grows by one only when every slot is taken and the PC has room", () => {
    const cool = { cpu: 0.3, freeMB: 8000 };
    expect(nextLimit(2, 2, cool, 5)).toBe(3);
    expect(nextLimit(2, 1, cool, 5)).toBe(2);
    expect(nextLimit(5, 5, cool, 5)).toBe(5);
    expect(nextLimit(3, 3, { cpu: 0.3, freeMB: 2000 }, 5)).toBe(3);
    expect(nextLimit(3, 3, { cpu: 0.75, freeMB: 8000 }, 5)).toBe(3);
  });

  it("nextLimit holds while the PC is busy and drops one while it struggles, never below 1", () => {
    expect(nextLimit(4, 3, { cpu: 0.88, freeMB: 8000 }, 5)).toBe(3);
    expect(nextLimit(4, 3, { cpu: 0.3, freeMB: 1200 }, 5)).toBe(3);
    expect(nextLimit(4, 3, { cpu: 0.97, freeMB: 8000 }, 5)).toBe(2);
    expect(nextLimit(3, 3, { cpu: 0.3, freeMB: 500 }, 5)).toBe(2);
    expect(nextLimit(1, 1, { cpu: 0.99, freeMB: 100 }, 5)).toBe(1);
    expect(nextLimit(6, 6, { cpu: 0.5, freeMB: 8000 }, 4)).toBe(4);
  });
});

describe("agent pool", () => {
  it("not adapting, runs exactly max at a time", async () => {
    const pool = agentPool({ max: 3, adaptive: false });
    const h = held();
    const all = Promise.all(Array.from({ length: 5 }, () => pool.run(h.work)));
    await flush();
    expect(pool.active()).toBe(3);
    h.release();
    await flush();
    expect(pool.active()).toBe(3);
    for (let k = 0; k < 4; k++) {
      h.release();
      await flush();
    }
    await all;
    expect(pool.active()).toBe(0);
  });

  it("adapting, starts with 2, adds one per tick while the PC has room, up to max", async () => {
    const { m, deps } = fakeLoad();
    const seen: number[] = [];
    const pool = agentPool({ max: 4, adaptive: true, deps, onLimit: (n) => seen.push(n) });
    const h = held();
    const all = Promise.all(Array.from({ length: 6 }, () => pool.run(h.work)));
    await flush();
    expect(pool.active()).toBe(2);
    pool.tick();
    expect(pool.active()).toBe(3);
    pool.tick();
    pool.tick();
    expect(pool.limit()).toBe(4);
    expect(pool.active()).toBe(4);

    m.cpu = 0.97;
    pool.tick();
    expect(pool.limit()).toBe(3);
    h.release();
    await flush();
    expect(pool.active()).toBe(3);
    pool.tick();
    expect(pool.limit()).toBe(2);
    h.release();
    await flush();
    expect(pool.active()).toBe(2);

    m.cpu = 0.88;
    pool.tick();
    expect(pool.limit()).toBe(2);
    h.release();
    await flush();
    expect(pool.active()).toBe(2);
    expect(seen).toEqual([3, 4, 3, 2]);

    m.cpu = 0.2;
    pool.tick();
    expect(pool.active()).toBe(3);
    while (h.open.length) {
      h.release();
      await flush();
    }
    await all;
    expect(pool.active()).toBe(0);
  });

  it("reads max and adapt from the settings", async () => {
    writeSettings({ ...DEFAULT_SETTINGS, agents: { max: 7, adaptive: false } });
    const pool = agentPool();
    expect(pool.limit()).toBe(7);
  });

  it("a failed work frees its slot", async () => {
    const pool = agentPool({ max: 1, adaptive: false });
    await expect(pool.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await pool.run(async () => 1)).toBe(1);
  });
});

type Fake = { cpu: (n: number) => number; freeMB?: (n: number) => number; ms?: (n: number) => number };

// ponytail: a machine described by what n workers cost; a worker can be made to die or never answer
function machine(f: Fake, o: { dieAt?: number; lateAt?: number } = {}) {
  let running = 0;
  let started = 0;
  let idle = 0;
  let total = 0;
  let stopped = 0;
  const deps: ProbeDeps = {
    start(): ProbeWorker {
      started++;
      running++;
      const me = started;
      return {
        ready: me === o.lateAt ? new Promise(() => {}) : Promise.resolve(),
        searches: () => [f.ms?.(running) ?? 300],
        failure: () => (me === o.dieAt ? "the Testimus MCP server stopped (exit code 1)" : null),
        stop() {
          stopped++;
          running--;
        },
      };
    },
    cpus() {
      total += 1000;
      idle += 1000 * (1 - f.cpu(running));
      return { idle, total };
    },
    freeMB: () => f.freeMB?.(running) ?? 16000,
    sleep: async () => {},
    now: () => 0,
    windowMs: 10,
    readyMs: 10,
  };
  return { deps, stopped: () => stopped, started: () => started };
}

describe("testing the PC's limits", () => {
  it("adds agents until the CPU is hot; the limit is the last count that held, every worker is stopped", async () => {
    const m = machine({ cpu: (n) => 0.1 + 0.15 * n });
    const r = await probeAgents(quietCtx(null), m.deps);
    expect(r.limit).toBe(4);
    expect(r.reason).toBe("With 5 agents the CPU is at 85 %");
    expect(r.levels.map((l) => l.agents)).toEqual([1, 2, 3, 4, 5]);
    expect(m.stopped()).toBe(m.started());
  });

  it("past 8 agents, adds them two by two; reaching the cap says so", async () => {
    const m = machine({ cpu: () => 0.1 });
    const r = await probeAgents(quietCtx(null), m.deps, 12);
    expect(r.levels.map((l) => l.agents)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12]);
    expect(r).toMatchObject({ limit: 12, reason: "Reached 12, the most Testimus allows." });
  });

  it("stops on memory, counting each claude.exe the test does not start", async () => {
    const r = await probeAgents(quietCtx(null), machine({ cpu: () => 0.1, freeMB: (n) => 6000 - 600 * n }).deps);
    expect(r.limit).toBe(4);
    expect(r.reason).toMatch(/^With 5 agents about 1\.2 GB of memory would be left/);
  });

  it("stops when a search takes three times as long as alone", async () => {
    const r = await probeAgents(quietCtx(null), machine({ cpu: () => 0.1, ms: (n) => (n < 4 ? 400 : 2500) }).deps);
    expect(r).toMatchObject({ limit: 3, reason: "With 4 agents a search takes 2500 ms (400 ms alone)" });
  });

  it("a worker that dies or never answers ends the test; the first one dying is an error", async () => {
    const dies = await probeAgents(quietCtx(null), machine({ cpu: () => 0.1 }, { dieAt: 3 }).deps);
    expect(dies).toMatchObject({ limit: 2, reason: "With 3 agents, the Testimus MCP server stopped (exit code 1)" });
    const late = await probeAgents(quietCtx(null), machine({ cpu: () => 0.1 }, { lateAt: 2 }).deps);
    expect(late.limit).toBe(1);
    expect(late.reason).toMatch(/^With 2 agents the last one took more than/);
    await expect(probeAgents(quietCtx(null), machine({ cpu: () => 0.1 }, { dieAt: 1 }).deps)).rejects.toThrow(
      "The test could not run one agent",
    );
  });

  it("refuses to measure a PC already busy at rest", async () => {
    await expect(probeAgents(quietCtx(null), machine({ cpu: () => 0.9 }).deps)).rejects.toThrow(
      "already busy before any agent",
    );
  });

  it("a cancelled test keeps what it measured", async () => {
    const ac = new AbortController();
    const m = machine({ cpu: () => 0.1 });
    const start = m.deps.start;
    m.deps.start = () => {
      if (m.started() === 2) ac.abort();
      return start();
    };
    const r = await probeAgents(quietCtx(null, ac.signal), m.deps);
    expect(r).toMatchObject({ limit: 2, reason: "Cancelled." });
    expect(m.stopped()).toBe(m.started());
  });

  it("verdict says nothing while the PC holds", () => {
    expect(verdict(3, { cpu: 0.5, freeMB: 9000 }, 500, 400)).toBeNull();
    expect(verdict(1, { cpu: 0.5, freeMB: 9000 }, 5000, 5000)).toBeNull();
  });

  it("--mock: the simulated PC holds 10 agents", async () => {
    const r = await probeAgents(quietCtx(null), mockProbeDeps(0));
    expect(r).toMatchObject({ limit: 10, reason: "With 12 agents the CPU is at 96 %" });
  });

  it("system.testAgents saves the limit as the maximum, or only the measure without apply", async () => {
    const project = join(mkdtempSync(join(tmpdir(), "testimus-agents-")), "LFRPS12");
    cpSync(FIXTURE, project, { recursive: true });
    rmSync(join(project, "index"), { recursive: true, force: true });
    await expect(invoke("system.testAgents", {}, { project })).rejects.toThrow("The project has no index yet");
    await expect(invoke("system.testAgents", {}, { project: null })).rejects.toThrow("No project is open.");
    mkdirSync(dirname(indexFile(project)), { recursive: true });
    writeFileSync(indexFile(project), "");
    agentProbe.deps = () => mockProbeDeps();
    const r = (await invoke("system.testAgents", {}, { project })) as any;
    expect(r).toMatchObject({ limit: 10, applied: true });
    expect(readSettings().agents).toMatchObject({ max: 10, measured: { limit: 10 } });
    await invoke("system.set", { agentsMax: 4 }, { project: null });
    expect((await invoke("system.testAgents", { apply: false }, { project })) as any).toMatchObject({
      applied: false,
    });
    expect(readSettings().agents?.max).toBe(4);
  });
});

describe("the probe's worker", () => {
  it("talks MCP to the project's Testimus server and times its searches", { timeout: 60000 }, async () => {
    const project = join(mkdtempSync(join(tmpdir(), "testimus-agents-")), "LFRPS12");
    cpSync(FIXTURE, project, { recursive: true });
    const w = mcpWorker(project, 50);
    try {
      await w.ready;
      expect(w.failure()).toBeNull();
      expect(w.searches(0).length).toBeGreaterThan(0);
    } finally {
      w.stop();
    }
  });
});
