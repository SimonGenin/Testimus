import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../../../../src/core/env.ts";
import { withPerfScope } from "../../../../../src/core/lib/models-perf.ts";
import {
  ensureServer,
  IDLE_MS,
  liveServers,
  loadedServers,
  type Proc,
  serverArgs,
  serverIo,
  serverPost,
  serverTimeouts,
  stopAllServers,
  sweepIdle,
} from "../../../../../src/core/rag/runtimes/llama-server.ts";

const saved = { ...serverIo, http: env.http, timeouts: { ...serverTimeouts } };

type FakeProc = Proc & { exit(code: number | null): void; say(text: string): void; args: string[] };
let procs: FakeProc[] = [];
let killed: number[] = [];
let clock = 1_000_000;
let healthy: (req: HttpReq, n: number) => HttpRes;
let calls: HttpReq[] = [];

function json(status: number, body: unknown): HttpRes {
  return { status, headers: {}, text: JSON.stringify(body) };
}

beforeEach(() => {
  procs = [];
  killed = [];
  calls = [];
  clock = 1_000_000;
  let pid = 100;
  let port = 50000;
  let healthCalls = 0;
  healthy = () => json(200, { status: "ok" });
  serverIo.spawn = (_exe, args) => {
    const listeners: ((t: string) => void)[] = [];
    let exit: (c: number | null) => void = () => {};
    const p: FakeProc = {
      pid: ++pid,
      args,
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
  serverIo.freePort = async () => ++port;
  serverIo.kill = async (p) => {
    killed.push(p);
    procs.find((x) => x.pid === p)?.exit(1);
  };
  serverIo.now = () => clock;
  serverIo.sleep = async (ms) => {
    clock += ms;
  };
  serverIo.randomKey = () => `key-${pid + 1}`;
  env.http = async (req) => {
    calls.push(req);
    if (req.url.endsWith("/health")) return healthy(req, ++healthCalls);
    if (req.headers?.authorization !== `Bearer key-${new URL(req.url).port === "50001" ? 101 : 102}`)
      return json(401, { error: { message: "Invalid API Key" } });
    return json(200, { ok: true, path: new URL(req.url).pathname });
  };
});

afterEach(async () => {
  await stopAllServers();
  Object.assign(serverIo, saved);
  Object.assign(serverTimeouts, saved.timeouts);
  env.http = saved.http;
});

describe("arguments", () => {
  it("binds to loopback with a key, the context and the right pooling", () => {
    expect(serverArgs("m.gguf", "embedding", 5000, "k")).toEqual([
      "-m",
      "m.gguf",
      "--embedding",
      "--pooling",
      "last",
      "-ub",
      "8192",
      "-ngl",
      "99",
      "--host",
      "127.0.0.1",
      "--port",
      "5000",
      "-c",
      "8192",
      "--api-key",
      "k",
    ]);
    expect(serverArgs("r.gguf", "rerank", 5001, "k").slice(2, 5)).toEqual(["--reranking", "--pooling", "rank"]);
  });

  it("never starts without a key", () => {
    expect(() => serverArgs("m.gguf", "embedding", 5000, "")).toThrow(/API key/);
  });
});

describe("start", () => {
  it("starts one server on a free port with a random key and waits for /health", async () => {
    healthy = (_r, n) => (n < 3 ? json(503, { error: { message: "Loading model" } }) : json(200, { status: "ok" }));
    const s = await ensureServer({ exe: "llama-server.exe", model: "D:/m/emb.gguf", kind: "embedding", sizeMB: 610 });
    expect(s.port).toBe(50001);
    expect(s.apiKey).toBe("key-101");
    expect(procs[0].args).toContain("--api-key");
    expect(procs[0].args[procs[0].args.indexOf("--api-key") + 1]).toBe("key-101");
    expect(procs[0].args[procs[0].args.indexOf("--port") + 1]).toBe("50001");
    expect(calls.filter((c) => c.url === "http://127.0.0.1:50001/health")).toHaveLength(3);
    expect(s.readyMs).toBe(2 * serverTimeouts.pollMs);
    expect(loadedServers()).toEqual([{ name: "emb.gguf", sizeMB: 610, vramMB: 610, runtime: "llamacpp" }]);
  });

  it("reuses the running server for the same model, even when asked twice at once", async () => {
    const o = { exe: "x.exe", model: "D:/m/emb.gguf", kind: "embedding" as const };
    const [a, b] = await Promise.all([ensureServer(o), ensureServer(o)]);
    expect(a).toBe(b);
    expect(await ensureServer(o)).toBe(a);
    expect(procs).toHaveLength(1);
    await ensureServer({ ...o, kind: "rerank" });
    expect(procs).toHaveLength(2);
  });

  it("sends the key on every call and maps an error to a readable message", async () => {
    const s = await ensureServer({ exe: "x.exe", model: "D:/m/emb.gguf", kind: "embedding" });
    expect(await serverPost(s, "/v1/embeddings", { input: ["a"] })).toEqual({ ok: true, path: "/v1/embeddings" });
    const wrong = { ...s, apiKey: "nope" };
    await expect(serverPost(wrong, "/v1/embeddings", {})).rejects.toThrow(/HTTP 401 Invalid API Key/);
  });

  it("fails with the end of the log when the process exits before it is ready", async () => {
    healthy = () => {
      throw new Error("ECONNREFUSED");
    };
    const p = ensureServer({ exe: "x.exe", model: "D:/m/bad.gguf", kind: "embedding" });
    await Promise.resolve();
    procs[0].say("llama_model_load: error loading model\nfailed to load model 'bad.gguf'\n");
    procs[0].exit(1);
    await expect(p).rejects.toThrow(/stopped before it was ready \(exit code 1\)[\s\S]*failed to load model/);
    expect(liveServers()).toHaveLength(0);
  });

  it("gives up after the delay, kills the process and says so", async () => {
    serverTimeouts.readyMs = 1000;
    healthy = () => json(503, { error: { message: "Loading model" } });
    await expect(ensureServer({ exe: "x.exe", model: "D:/m/slow.gguf", kind: "rerank" })).rejects.toThrow(
      /not ready after 1 s/,
    );
    expect(killed).toEqual([procs[0].pid]);
  });

  it("stops the starting server when the load is cancelled", async () => {
    const ctrl = new AbortController();
    healthy = () => {
      ctrl.abort();
      return json(503, {});
    };
    await expect(
      ensureServer({ exe: "x.exe", model: "D:/m/emb.gguf", kind: "embedding", signal: ctrl.signal }),
    ).rejects.toThrow(/cancelled/);
    expect(killed).toEqual([procs[0].pid]);
  });

  it("starts again when the server died", async () => {
    const o = { exe: "x.exe", model: "D:/m/emb.gguf", kind: "embedding" as const };
    await ensureServer(o);
    procs[0].exit(3);
    await Promise.resolve();
    await ensureServer(o);
    expect(procs).toHaveLength(2);
  });
});

describe("stop", () => {
  it("stops a server idle for 10 minutes, not a busy or recent one", async () => {
    const a = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    clock += 5 * 60 * 1000;
    const b = await ensureServer({ exe: "x.exe", model: "D:/m/b.gguf", kind: "rerank" });
    expect(await sweepIdle(clock + IDLE_MS - 5 * 60 * 1000 - 1)).toEqual([]);
    expect(await sweepIdle(clock + IDLE_MS - 5 * 60 * 1000)).toEqual([a.id]);
    expect(killed).toEqual([a.proc.pid]);
    b.busy = 1;
    expect(await sweepIdle(clock + 2 * IDLE_MS)).toEqual([]);
    b.busy = 0;
    expect(await sweepIdle(clock + 2 * IDLE_MS)).toEqual([b.id]);
    expect(liveServers()).toHaveLength(0);
  });

  it("a call resets the idle time", async () => {
    const s = await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    clock += IDLE_MS - 1000;
    await serverPost(s, "/v1/embeddings", { input: ["x"] });
    expect(await sweepIdle(clock + 2000)).toEqual([]);
  });

  it("stopAllServers kills every server, including one still starting", async () => {
    await ensureServer({ exe: "x.exe", model: "D:/m/a.gguf", kind: "embedding" });
    healthy = () => json(503, { error: { message: "Loading model" } });
    serverIo.sleep = () => new Promise((r) => setTimeout(r, 1));
    const loading = ensureServer({ exe: "x.exe", model: "D:/m/b.gguf", kind: "rerank" });
    loading.catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    const t = Date.now();
    await stopAllServers();
    expect(Date.now() - t).toBeLessThan(1000);
    await expect(loading).rejects.toThrow(/cancelled/);
    expect(killed.sort()).toEqual(procs.map((p) => p.pid).sort());
    expect(procs).toHaveLength(2);
    expect(liveServers()).toHaveLength(0);
  });
});

describe("cancelling a load (#9)", () => {
  const o = { exe: "x.exe", model: "D:/m/emb.gguf", kind: "embedding" as const };

  it("a waiter that cancels leaves; the load goes on for the one still waiting", async () => {
    const a = new AbortController();
    const b = new AbortController();
    healthy = (_r, n) => {
      if (n === 2) a.abort();
      return n < 5 ? json(503, {}) : json(200, { status: "ok" });
    };
    const pa = ensureServer({ ...o, signal: a.signal });
    const pb = ensureServer({ ...o, signal: b.signal });
    await expect(pa).rejects.toThrow(/cancelled/);
    const s = await pb;
    expect(s.exitCode).toBeUndefined();
    expect(killed).toEqual([]);
    expect(procs).toHaveLength(1);
    expect(liveServers()).toEqual([s]);
  });

  it("when every waiter cancelled, the start stops and the process is killed", async () => {
    const a = new AbortController();
    const b = new AbortController();
    healthy = (_r, n) => {
      if (n === 2) a.abort();
      if (n === 3) b.abort();
      return json(503, {});
    };
    const pa = ensureServer({ ...o, signal: a.signal });
    const pb = ensureServer({ ...o, signal: b.signal });
    await expect(pa).rejects.toThrow(/cancelled/);
    await expect(pb).rejects.toThrow(/cancelled/);
    await new Promise((r) => setTimeout(r, 5));
    expect(killed).toEqual([procs[0].pid]);
    expect(liveServers()).toEqual([]);
  });

  it("the signal of the operation (job) reaches ensureServer without being passed", async () => {
    const ctrl = new AbortController();
    healthy = () => {
      ctrl.abort();
      return json(503, {});
    };
    await expect(withPerfScope({ jobId: "rag-index-1" }, () => ensureServer(o), ctrl.signal)).rejects.toThrow(
      /cancelled/,
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(killed).toEqual([procs[0].pid]);
  });

  it("an already cancelled operation starts nothing", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(ensureServer({ ...o, signal: ctrl.signal })).rejects.toThrow(/cancelled/);
    expect(procs).toHaveLength(0);
  });

  it("a caller arriving after an abandoned load starts a fresh one", async () => {
    const a = new AbortController();
    healthy = (_r, n) => {
      if (n === 1) a.abort();
      return n < 3 ? json(503, {}) : json(200, { status: "ok" });
    };
    await expect(ensureServer({ ...o, signal: a.signal })).rejects.toThrow(/cancelled/);
    const s = await ensureServer(o);
    expect(s.exitCode).toBeUndefined();
    expect(procs.length).toBeGreaterThanOrEqual(2);
    expect(killed).toContain(procs[0].pid);
  });
});
