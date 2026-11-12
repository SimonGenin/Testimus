import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import { killChildrenOnExit, killTree, run, start as startProcess } from "../../../shared/run/process.ts";
import { every, sleep } from "../../../shared/run/work.ts";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { withProcess } from "../../jobs.ts";
import {
  currentOp,
  isMemoryError,
  loadFailedForMemory,
  opSignal,
  type PerfFields,
  perfScope,
  recordPerf,
} from "../../lib/models-perf.ts";
import type { LoadedModel } from "../../types.ts";

export type ServerKind = "embedding" | "rerank";
export type Proc = {
  pid: number | undefined;
  onOutput(cb: (text: string) => void): void;
  exited: Promise<number | null>;
};
export type LlamaServer = {
  id: string;
  exe: string;
  model: string;
  kind: ServerKind;
  port: number;
  apiKey: string;
  url: string;
  proc: Proc;
  startedAt: number;
  readyMs: number;
  lastUsed: number;
  busy: number;
  exitCode?: number | null;
  log: string[];
  sizeMB: number;
  onGpu: boolean;
  vramMB?: number;
  catalogId?: string;
};
export type ServerStart = {
  exe: string;
  build?: string;
  model: string;
  kind: ServerKind;
  catalogId?: string;
  sizeMB?: number;
  onGpu?: boolean;
  signal?: AbortSignal;
  perf?: PerfFields;
  /** set when it runs on the processor: its threads (embedThreads), and it starts at low priority */
  threads?: number;
};

export const IDLE_MS = 10 * 60 * 1000;
export const LLAMA_CTX = 8192;
// ponytail: serverIo and serverTimeouts are the seam env does not have — the llama-server process, its health
// polls and its clock — which the tests drive to play a server that never gets ready or dies at start
export const serverTimeouts = { readyMs: 180000, pollMs: 250, sweepMs: 60000 };

export const serverIo = {
  spawn(exe: string, args: string[], low = false): Proc {
    const listeners: ((t: string) => void)[] = [];
    const proc = startProcess({
      exe,
      args,
      ...(low ? { priority: "low" as const } : {}),
      onLine: (line) => {
        for (const l of listeners) l(`${line}\n`);
      },
    });
    return {
      pid: proc.pid,
      onOutput: (cb) => listeners.push(cb),
      exited: proc.exited.then((e) => {
        if (e.error) for (const l of listeners) l(e.error);
        return e.error && proc.pid === undefined ? -1 : e.code;
      }),
    };
  },
  freePort(): Promise<number> {
    return new Promise((res, rej) => {
      const srv = createServer();
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => res(port));
      });
    });
  },
  kill: (pid: number): Promise<void> => killTree(pid),
  now: () => Date.now(),
  sleep: (ms: number) => sleep(ms),
  randomKey: () => randomBytes(24).toString("hex"),
  vramUsedMB: nvidiaUsedMB,
};

// ponytail: llama.cpp holds its weights outside Node; the NVIDIA memory used before and after the load is its share
async function nvidiaUsedMB(): Promise<number | null> {
  const r = await run({
    exe: "nvidia-smi",
    args: ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
    timeoutMs: 5000,
  });
  const used = r.stdout
    .split(/\r?\n/)
    .map((l) => Number.parseFloat(l))
    .filter(Number.isFinite);
  return r.code !== 0 || !used.length ? null : used.reduce((a, b) => a + b, 0);
}

// ponytail: from this build on (the one Testimus downloads), llama.cpp places the layers itself: `-ngl auto` with --fit
// (on by default) keeps what does not fit the free memory, less 1 GiB, on the processor instead of failing the load;
// an older build registered by path may know neither, so it gets every layer as before
export const AUTO_LAYERS_SINCE = 12032;

export function autoLayers(build: string | undefined): boolean {
  const n = Number(build?.match(/^b(\d+)$/i)?.[1]);
  return Number.isFinite(n) && n >= AUTO_LAYERS_SINCE;
}

export type MemoryReport = { gpuMB: number; hostMB: number; layers?: { onGpu: number; total: number } };

// What llama.cpp says it allocated while loading (llama.cpp b12032: load_tensors « offloaded 28/29 layers to GPU »,
// then « <buffer> model / KV / compute / output buffer size = 604.15 MiB » per device): the memory a model really takes
// on any GPU maker, where nvidia-smi sees NVIDIA only
export function memoryReport(log: string): MemoryReport | null {
  let gpuMB = 0;
  let hostMB = 0;
  let found = false;
  for (const m of log.matchAll(/(\S+)\s+(?:model|KV|compute|output|rotation) buffer size\s*=\s*([\d.]+) MiB/g)) {
    found = true;
    if (/cpu|host/i.test(m[1])) hostMB += Number(m[2]);
    else gpuMB += Number(m[2]);
  }
  const layers = log.match(/offloaded (\d+)\/(\d+) layers to GPU/);
  if (!found && !layers) return null;
  return {
    gpuMB: Math.round(gpuMB),
    hostMB: Math.round(hostMB),
    ...(layers ? { layers: { onGpu: Number(layers[1]), total: Number(layers[2]) } } : {}),
  };
}

// ponytail: on the processor llama-server offloads to no device (a CUDA build would still take the card) and keeps
// two threads for the rest of the PC, as the embed worker does; on the card it places its layers
export function serverArgs(
  model: string,
  kind: ServerKind,
  port: number,
  apiKey: string,
  build?: string,
  threads?: number,
): string[] {
  if (!apiKey) throw new UserError("llama-server is never started without an API key.");
  const where = threads
    ? ["-dev", "none", "-t", String(threads), "-tb", String(threads)]
    : // ponytail: llama.cpp prints what it allocated (memoryReport) only from verbosity 4 on (b12032 defaults to 3)
      autoLayers(build)
      ? ["-ngl", "auto", "-lv", "4"]
      : ["-ngl", "99"];
  return [
    "-m",
    model,
    ...(kind === "rerank"
      ? ["--reranking", "--pooling", "rank"]
      : ["--embedding", "--pooling", "last", "-ub", String(LLAMA_CTX)]),
    ...where,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "-c",
    String(LLAMA_CTX),
    "--api-key",
    apiKey,
  ];
}

const running = new Map<string, LlamaServer>();
type Starting = { promise: Promise<LlamaServer>; ctrl: AbortController; waiting: number };
const starting = new Map<string, Starting>();
let sweeper: (() => void) | null = null;
let generation = 0;

function serverId(kind: ServerKind, model: string): string {
  return `${kind}|${resolve(model).toLowerCase()}`;
}

function tail(s: LlamaServer, n = 15): string {
  return s.log.join("").split(/\r?\n/).filter(Boolean).slice(-n).join("\n");
}

async function health(s: LlamaServer): Promise<boolean> {
  try {
    const res = await env.http({
      method: "GET",
      url: `${s.url}/health`,
      headers: { authorization: `Bearer ${s.apiKey}` },
      timeoutMs: 2000,
    });
    return res.status === 200 && (JSON.parse(res.text || "{}") as { status?: string }).status === "ok";
  } catch {
    return false;
  }
}

function cancelled(model: string): UserError {
  return new UserError(`Loading ${basename(model)} in llama-server was cancelled.`);
}

async function start(o: ServerStart, id: string): Promise<LlamaServer> {
  const port = await serverIo.freePort();
  const apiKey = serverIo.randomKey();
  const args = serverArgs(o.model, o.kind, port, apiKey, o.build, o.threads);
  const target = currentOp();
  const tStart = serverIo.now();
  const vramBefore = o.perf && (o.onGpu ?? true) ? await serverIo.vramUsedMB().catch(() => null) : null;
  const t0 = serverIo.now();
  const gen = generation;
  if (o.signal?.aborted || gen !== generation) throw cancelled(o.model);
  const s: LlamaServer = {
    id,
    exe: o.exe,
    model: o.model,
    kind: o.kind,
    port,
    apiKey,
    url: `http://127.0.0.1:${port}`,
    proc: serverIo.spawn(o.exe, args, o.threads !== undefined),
    startedAt: t0,
    readyMs: 0,
    lastUsed: t0,
    busy: 0,
    log: [],
    sizeMB: o.sizeMB ?? 0,
    onGpu: o.onGpu ?? true,
    ...(o.catalogId ? { catalogId: o.catalogId } : {}),
  };
  const memory: string[] = [];
  s.proc.onOutput((t) => {
    s.log.push(t);
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
    if (/buffer size|layers to GPU/.test(t)) memory.push(t);
  });
  s.proc.exited.then((code) => {
    s.exitCode = code;
    if (running.get(id) === s) running.delete(id);
  });
  void withProcess(
    `llama-server · ${basename(o.model)}`,
    "llama-server",
    (pid) => {
      pid(s.proc.pid);
      return s.proc.exited;
    },
    (code) => code,
  ).catch(() => {});
  killChildrenOnExit();
  for (;;) {
    if (s.exitCode !== undefined) {
      const err = new UserError(
        `llama-server stopped before it was ready (exit code ${s.exitCode}) for ${basename(o.model)}.\n${tail(s)}`,
        "Check the model (testimus models verify <id>) and the llama.cpp build (testimus models pullRuntime); the end of its log is above.",
      );
      const ms = serverIo.now() - t0;
      if (target) target.loadMs += serverIo.now() - tStart;
      if (o.perf && isMemoryError(err)) loadFailedForMemory(o.perf, ms, target);
      throw err;
    }
    if (o.signal?.aborted || gen !== generation) {
      await stopServer(s);
      throw cancelled(o.model);
    }
    if (await health(s)) break;
    if (serverIo.now() - t0 > serverTimeouts.readyMs) {
      await stopServer(s);
      throw new UserError(
        `llama-server was not ready after ${Math.round(serverTimeouts.readyMs / 1000)} s for ${basename(o.model)}.\n${tail(s)}`,
        "Retry once the PC is less busy, or choose a lighter pack in Settings › Models.",
      );
    }
    await serverIo.sleep(serverTimeouts.pollMs);
  }
  s.readyMs = serverIo.now() - t0;
  s.lastUsed = serverIo.now();
  running.set(id, s);
  // ponytail: nvidia-smi's before/after counts the CUDA context too (6405 MB where llama.cpp reports 6055 for Qwen3
  // Embedding 8B on b12032) but sees NVIDIA only (≈ 0 for a model on the PC's other GPU): the larger of the two is the
  // model's share; llama.cpp's report alone tells the layers left on the processor
  const report = s.onGpu ? memoryReport(memory.join("")) : null;
  if (report) s.vramMB = report.gpuMB;
  if (o.perf) {
    const vramAfter = vramBefore === null ? null : await serverIo.vramUsedMB().catch(() => null);
    const delta = vramBefore !== null && vramAfter !== null ? Math.max(0, Math.round(vramAfter - vramBefore)) : null;
    const vramMB = delta === null && !report ? null : Math.max(delta ?? 0, report?.gpuMB ?? 0);
    if (vramMB !== null && s.onGpu) s.vramMB = vramMB;
    const partialOffload = report?.layers ? report.layers.onGpu < report.layers.total : undefined;
    if (target && partialOffload !== undefined) target.partialOffload = partialOffload;
    recordPerf({
      at: env.now().toISOString(),
      op: "model.load",
      ...o.perf,
      ...perfScope(),
      items: 1,
      ms: s.readyMs,
      loadMs: s.readyMs,
      ...(vramMB !== null ? { vramMB } : {}),
      ...(partialOffload !== undefined ? { partialOffload } : {}),
    });
  }
  if (target) target.loadMs += serverIo.now() - tStart;
  sweeper ??= every(serverTimeouts.sweepMs, sweepIdle);
  return s;
}

// ponytail: callers share one start; it stops (and its process is killed) only once every caller that can cancel has
export async function ensureServer(o: ServerStart): Promise<LlamaServer> {
  const id = serverId(o.kind, o.model);
  const live = running.get(id);
  if (live && live.exitCode === undefined) return live;
  const signal = o.signal ?? opSignal();
  if (signal?.aborted) throw cancelled(o.model);
  let st = starting.get(id);
  if (!st || st.ctrl.signal.aborted) {
    const ctrl = new AbortController();
    const promise: Promise<LlamaServer> = start({ ...o, signal: ctrl.signal }, id).finally(() => {
      if (starting.get(id)?.promise === promise) starting.delete(id);
    });
    promise.catch(() => {});
    st = { promise, ctrl, waiting: 0 };
    starting.set(id, st);
  }
  const s = st;
  s.waiting++;
  if (!signal) return s.promise;
  return new Promise<LlamaServer>((resolve, reject) => {
    let left = false;
    const leave = (): boolean => {
      if (left) return false;
      left = true;
      signal.removeEventListener("abort", onAbort);
      s.waiting--;
      return true;
    };
    const onAbort = () => {
      if (!leave()) return;
      if (s.waiting === 0) s.ctrl.abort();
      reject(cancelled(o.model));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    s.promise.then(
      (v) => leave() && resolve(v),
      (e) => leave() && reject(e),
    );
  });
}

export async function serverPost<T>(s: LlamaServer, path: string, body: unknown, timeoutMs = 300000): Promise<T> {
  s.busy++;
  try {
    const req = {
      method: "POST",
      url: s.url + path,
      headers: { "content-type": "application/json", authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify(body),
      timeoutMs,
    };
    // ponytail: embeddings and reranks are idempotent; a local connection reset (seen on the dev PC under load) is
    // retried twice before it counts as a failure
    let res: Awaited<ReturnType<typeof env.http>> | undefined;
    for (let attempt = 0; !res; attempt++) {
      try {
        res = await env.http(req);
      } catch (e) {
        const reset = /fetch failed|ECONNRESET|socket hang up|other side closed/i.test(
          `${e instanceof Error ? e.message : String(e)} ${String((e as { cause?: unknown }).cause ?? "")}`,
        );
        if (!reset || attempt >= 2) throw e;
      }
    }
    if (res.status !== 200) {
      let msg = (res.text ?? "").slice(0, 300);
      try {
        const j = JSON.parse(res.text ?? "") as { error?: { message?: string } | string };
        msg = typeof j.error === "string" ? j.error : (j.error?.message ?? msg);
      } catch {}
      throw new UserError(
        `llama-server ${path} failed for ${basename(s.model)}: HTTP ${res.status} ${msg}`,
        "Retry; if it fails again, check the model with testimus models verify <id>.",
      );
    }
    return JSON.parse(res.text || "{}") as T;
  } finally {
    s.busy--;
    s.lastUsed = serverIo.now();
  }
}

export async function stopServer(s: LlamaServer): Promise<void> {
  if (running.get(s.id) === s) running.delete(s.id);
  if (s.exitCode === undefined && s.proc.pid !== undefined) await serverIo.kill(s.proc.pid);
  if (running.size === 0 && sweeper) {
    sweeper();
    sweeper = null;
  }
}

export async function sweepIdle(now = serverIo.now()): Promise<string[]> {
  const idle = [...running.values()].filter((s) => s.busy === 0 && now - s.lastUsed >= IDLE_MS);
  for (const s of idle) await stopServer(s);
  return idle.map((s) => s.id);
}

export async function stopAllServers(): Promise<void> {
  generation++;
  await Promise.allSettled([...starting.values()].map((st) => st.promise));
  for (const s of [...running.values()]) await stopServer(s);
}

export function liveServers(): LlamaServer[] {
  return [...running.values()];
}

export function loadedServers(): LoadedModel[] {
  return liveServers().map((s) => ({
    name: s.catalogId ?? basename(s.model),
    sizeMB: s.sizeMB,
    vramMB: s.onGpu ? (s.vramMB ?? s.sizeMB) : 0,
    runtime: "llamacpp" as const,
  }));
}
