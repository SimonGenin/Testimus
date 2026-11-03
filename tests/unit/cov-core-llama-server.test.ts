import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../src/core/env.ts";
import { journalFile, readPerf, timeOp } from "../../src/core/lib/models-perf.ts";
import {
  ensureServer,
  liveServers,
  loadedServers,
  type Proc,
  serverIo,
  serverPost,
  serverTimeouts,
  stopAllServers,
  stopServer,
} from "../../src/core/rag/runtimes/llama-server.ts";

const saved = { ...serverIo, http: env.http, timeouts: { ...serverTimeouts } };
const perf = { model: "qwen3-embedding-0.6b-q8", runtime: "llamacpp" as const, device: "gpu" as const };

type FakeProc = Proc & { exit(code: number | null): void; say(text: string): void };
let procs: FakeProc[] = [];
let killed: number[] = [];
let clock = 0;
let respond: (req: HttpReq) => HttpRes;

const json = (status: number, body: unknown): HttpRes => ({ status, headers: {}, text: JSON.stringify(body) });

beforeEach(() => {
  rmSync(journalFile(), { force: true });
  procs = [];
  killed = [];
  clock = 1_000_000;
  let pid = 500;
  respond = () => json(200, { status: "ok" });
  serverIo.spawn = () => {
    const listeners: ((t: string) => void)[] = [];
    let exit: (c: number | null) => void = () => {};
    const p: FakeProc = {
      pid: ++pid,
      onOutput: (cb) => listeners.push(cb),
      exited: new Promise((r) => {
        exit = r;
      }),
      exit: (c) => exit(c),
      say: (t) => {
        for (const l of listeners) l(t);
      },
    };
    procs.push(p);
    return p;
  };
  serverIo.freePort = async () => 52000;
  serverIo.kill = async (p) => {
    killed.push(p);
    procs.find((x) => x.pid === p)?.exit(1);
  };
  serverIo.now = () => clock;
  serverIo.sleep = async (ms) => {
    clock += ms;
  };
  serverIo.randomKey = () => "k";
  serverIo.vramUsedMB = async () => null;
  env.http = async (req) => respond(req);
});

afterEach(async () => {
  await stopAllServers();
  Object.assign(serverIo, saved);
  Object.assign(serverTimeouts, saved.timeouts);
  env.http = saved.http;
});

describe("llama-server load measurement", () => {
  it("records model.load with the NVIDIA memory the load took, and counts the load in the operation", async () => {
    let vram = 1000;
    serverIo.vramUsedMB = async () => {
      vram += 700;
      return vram;
    };
    let s: Awaited<ReturnType<typeof ensureServer>> | undefined;
    await timeOp("embed.query", perf, 1, async () => {
      s = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding", perf, catalogId: "cat-a" });
    });
    const [load] = readPerf();
    expect(load).toMatchObject({ op: "model.load", items: 1, vramMB: 700 });
    expect(loadedServers()).toEqual([{ name: "cat-a", sizeMB: 0, vramMB: 0, runtime: "llamacpp" }]);
    expect(s?.catalogId).toBe("cat-a");
  });

  it("a CPU server or a failing nvidia-smi gives no vramMB", async () => {
    serverIo.vramUsedMB = async () => {
      throw new Error("no nvidia-smi");
    };
    await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding", perf });
    await ensureServer({ exe: "x.exe", model: "D:/m/b.gguf", kind: "rerank", perf, onGpu: false, sizeMB: 300 });
    const lines = readPerf();
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.vramMB).toBeUndefined();
    expect(loadedServers().find((x) => x.name === "b.gguf")).toEqual({
      name: "b.gguf",
      sizeMB: 300,
      vramMB: 0,
      runtime: "llamacpp",
    });
  });

  it("vram read before but not after: no vramMB", async () => {
    let n = 0;
    serverIo.vramUsedMB = async () => (++n === 1 ? 1000 : null);
    await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding", perf });
    serverIo.vramUsedMB = async () => {
      if (++n === 3) return 1000;
      throw new Error("nvidia-smi went away");
    };
    await ensureServer({ exe: "x.exe", model: "D:/m/b.gguf", kind: "embedding", perf });
    expect(readPerf().map((l) => l.vramMB)).toEqual([undefined, undefined]);
  });

  it("a waiter that left on cancel ignores the failure that comes later", async () => {
    respond = () => json(503, {});
    serverIo.sleep = () => new Promise((r) => setTimeout(r, 1));
    const a = new AbortController();
    const b = new AbortController();
    const pa = ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding", signal: a.signal });
    const pb = ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding", signal: b.signal });
    a.abort();
    await expect(pa).rejects.toThrow(/cancelled/);
    procs[0].exit(2);
    await expect(pb).rejects.toThrow(/exit code 2/);
  });

  it("a server that dies for memory inside an operation logs oom and counts its load time", async () => {
    respond = () => json(503, {});
    serverIo.sleep = () => new Promise((r) => setTimeout(r, 1));
    const op = timeOp("embed.index", perf, 1, async () => {
      const p = ensureServer({ exe: "x.exe", model: "D:/m/big.gguf", kind: "embedding", perf });
      await new Promise((r) => setTimeout(r, 1));
      procs[0].say("cudaMalloc failed: out of memory\n");
      procs[0].exit(1);
      return p;
    });
    await expect(op).rejects.toThrow(/stopped before it was ready/);
    const lines = readPerf();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ op: "model.load", oom: true });
  });
});

describe("llama-server edge cases", () => {
  it("keeps only the last 400 log chunks", async () => {
    const s = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    for (let i = 0; i < 405; i++) procs[0].say(`line ${i}\n`);
    expect(s.log).toHaveLength(400);
    expect(s.log[0]).toBe("line 5\n");
  });

  it("a load abandoned while the port is being found never spawns", async () => {
    let release: (n: number) => void = () => {};
    serverIo.freePort = () =>
      new Promise((r) => {
        release = r;
      });
    const ctrl = new AbortController();
    const p = ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding", signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 1));
    ctrl.abort();
    await expect(p).rejects.toThrow(/cancelled/);
    release(52001);
    await new Promise((r) => setTimeout(r, 5));
    expect(procs).toHaveLength(0);
  });

  it("health with an empty body is not ready; a process exit then fails the start", async () => {
    respond = () => ({ status: 200, headers: {} });
    serverIo.sleep = () => new Promise((r) => setTimeout(r, 1));
    const p = ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    await new Promise((r) => setTimeout(r, 1));
    procs[0].exit(null);
    await expect(p).rejects.toThrow(/exit code null/);
  });

  it("serverPost maps every error shape and reads an empty 200 as {}", async () => {
    const s = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    respond = () => json(500, { error: "plain message" });
    await expect(serverPost(s, "/x", {})).rejects.toThrow(/HTTP 500 plain message/);
    respond = () => json(500, { error: {} });
    await expect(serverPost(s, "/x", {})).rejects.toThrow(/HTTP 500 \{"error":\{\}\}/);
    respond = () => ({ status: 502, headers: {} });
    await expect(serverPost(s, "/x", {})).rejects.toThrow(/HTTP 502 $/);
    respond = () => ({ status: 503, headers: {}, text: "not json" });
    await expect(serverPost(s, "/x", {})).rejects.toThrow(/HTTP 503 not json/);
    respond = () => ({ status: 200, headers: {} });
    expect(await serverPost(s, "/x", {})).toEqual({});
    expect(s.busy).toBe(0);
  });

  it("stopping a server that already exited or has no pid kills nothing", async () => {
    const s = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    procs[0].exit(0);
    await new Promise((r) => setTimeout(r, 1));
    await stopServer(s);
    const t = await ensureServer({ exe: "x.exe", model: "D:/m/b.gguf", kind: "embedding" });
    await stopServer({ ...t, id: "other", proc: { ...t.proc, pid: undefined } });
    expect(killed).toEqual([]);
    expect(liveServers()).toEqual([t]);
  });

  it("the idle sweeper runs on its interval", async () => {
    serverTimeouts.sweepMs = 5;
    const s = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    clock += 11 * 60 * 1000;
    await new Promise((r) => setTimeout(r, 40));
    expect(killed).toEqual([s.proc.pid]);
    expect(liveServers()).toEqual([]);
  });
});
