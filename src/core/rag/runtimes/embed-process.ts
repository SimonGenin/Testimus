import { fileURLToPath } from "node:url";
import { killChildrenOnExit, type Proc, type Stream, start } from "../../../shared/run/process.ts";
import { every, reasonOf } from "../../../shared/run/work.ts";
import { embedThreads } from "../../lib/fit/placement.ts";
import { knownMachine } from "../../lib/machine/profile.ts";
import { addTokens, currentOp, loadTimed, opSignal, perfFields } from "../../lib/models-perf.ts";
import type { EmbedMode, ResolvedModel } from "../../types.ts";
import { type EmbedAnswer, vectorOf } from "./embed-protocol.ts";
import { embedInputs, embedSpec, transformersRuntime } from "./transformers.ts";
import type { EmbedSpec } from "./transformers-engine.ts";
import type { Runtime } from "./types.ts";

// ponytail: the same rule as llama-server — ten minutes without an embedding and the worker goes, its memory with it;
// TESTIMUS_EMBED_IDLE_MS shortens it to watch it happen
export const IDLE_MS = 10 * 60 * 1000;
const idleKnob = Number(process.env.TESTIMUS_EMBED_IDLE_MS);
export const workerTimeouts = { idleMs: idleKnob > 0 ? idleKnob : IDLE_MS };

// ponytail: workerIo is the seam env does not have — the worker program and the clock; the tests start a fake worker
export const workerIo = {
  script: (): string => fileURLToPath(new URL("./embed-worker.ts", import.meta.url)),
  start: (args: string[], onLine: (line: string, stream: Stream) => void): Proc =>
    start({ exe: process.execPath, args, keepStdin: true, keepStdout: false, priority: "low", onLine }),
  now: () => Date.now(),
};

type Pending = { resolve(a: EmbedAnswer): void; reject(e: Error): void };
export type EmbedWorker = {
  key: string;
  proc: Proc;
  threads: number;
  pending: Map<number, Pending>;
  busy: number;
  lastUsed: number;
  stderr: string[];
  exitCode?: number;
};

const workers = new Map<string, EmbedWorker>();
let sweeper: (() => void) | null = null;
let nextId = 0;

function tail(w: EmbedWorker): string {
  return w.stderr.length ? `\n${w.stderr.slice(-10).join("\n")}` : "";
}

function spawnWorker(key: string): EmbedWorker {
  const threads = embedThreads(knownMachine());
  const w: EmbedWorker = {
    key,
    threads,
    pending: new Map(),
    busy: 0,
    lastUsed: workerIo.now(),
    stderr: [],
    proc: undefined as unknown as Proc,
  };
  w.proc = workerIo.start([workerIo.script(), "--threads", String(threads)], (line, stream) => {
    if (stream === "stderr") {
      w.stderr.push(line);
      if (w.stderr.length > 40) w.stderr.shift();
      return;
    }
    let a: EmbedAnswer;
    try {
      a = JSON.parse(line) as EmbedAnswer;
    } catch {
      return;
    }
    const p = w.pending.get(a?.id);
    if (!p) return;
    w.pending.delete(a.id);
    p.resolve(a);
  });
  killChildrenOnExit();
  w.proc.exited.then((e) => {
    w.exitCode = e.code;
    const why = new Error(
      `The embedding process stopped (exit code ${e.code}).${tail(w) || (e.error ? `\n${e.error}` : "")}`,
    );
    for (const p of w.pending.values()) p.reject(why);
    w.pending.clear();
    if (workers.get(key) === w) workers.delete(key);
    if (!workers.size && sweeper) {
      sweeper();
      sweeper = null;
    }
  });
  workers.set(key, w);
  sweeper ??= every(Math.min(60_000, Math.max(250, workerTimeouts.idleMs / 4)), () => sweepIdle());
  return w;
}

// ponytail: one worker per model; asking for another model lets an idle worker of the previous one go at once
function workerFor(key: string): EmbedWorker {
  const live = workers.get(key);
  if (live && live.exitCode === undefined) return live;
  for (const other of [...workers.values()]) if (other.busy === 0) void stopWorker(other);
  return spawnWorker(key);
}

function request(w: EmbedWorker, spec: EmbedSpec, inputs: string[], signal?: AbortSignal): Promise<EmbedAnswer> {
  const id = ++nextId;
  return new Promise<EmbedAnswer>((resolve, reject) => {
    if (signal?.aborted) return reject(reasonOf(signal));
    w.busy++;
    const done = () => {
      w.busy--;
      w.lastUsed = workerIo.now();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (!w.pending.delete(id)) return;
      done();
      w.proc.write(`${JSON.stringify({ id, op: "cancel" })}\n`);
      reject(reasonOf(signal as AbortSignal));
    };
    w.pending.set(id, {
      resolve: (a) => {
        done();
        resolve(a);
      },
      reject: (e) => {
        done();
        reject(e);
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    w.proc.write(`${JSON.stringify({ id, op: "embed", spec, inputs })}\n`);
  });
}

async function embedOut(
  m: ResolvedModel,
  texts: string[],
  mode: EmbedMode,
): Promise<{ vectors: Float32Array[]; maxTokens: number }> {
  const spec = embedSpec(m);
  const key = [m.entry.id, spec.path, spec.device, spec.dtype ?? ""].join("|");
  const target = currentOp();
  const a = await request(workerFor(key), spec, embedInputs(m, texts, mode), opSignal());
  if (a.load)
    loadTimed(
      perfFields(m),
      a.load.ms,
      "error" in a && a.load.failed
        ? { error: a.error }
        : { extra: a.load.peakRssMB ? { peakRssMB: a.load.peakRssMB } : {} },
      target,
    );
  if ("error" in a) throw new Error(a.error);
  addTokens(a.tokens);
  return { vectors: a.vectors.map(vectorOf), maxTokens: a.maxTokens };
}

export async function stopWorker(w: EmbedWorker): Promise<void> {
  if (workers.get(w.key) === w) workers.delete(w.key);
  if (w.exitCode === undefined) await w.proc.kill();
  if (!workers.size && sweeper) {
    sweeper();
    sweeper = null;
  }
}

export async function sweepIdle(now = workerIo.now()): Promise<string[]> {
  const idle = [...workers.values()].filter((w) => w.busy === 0 && now - w.lastUsed >= workerTimeouts.idleMs);
  for (const w of idle) await stopWorker(w);
  return idle.map((w) => w.key);
}

export async function stopEmbedWorkers(): Promise<void> {
  for (const w of [...workers.values()]) await stopWorker(w);
}

export function liveWorkers(): EmbedWorker[] {
  return [...workers.values()];
}

// ponytail: transformers.js embeddings run in the embed worker, a query's too — measured, starting the worker costs
// a fraction of loading the model, which the core would have to do as well; rerankers stay in the core
export const transformersProcessRuntime: Runtime = {
  probe: async (m) => {
    if (m.entry.kind !== "embedding") return transformersRuntime.probe(m);
    const { vectors, maxTokens } = await embedOut(m, ["probe"], "doc");
    return { dims: vectors[0]?.length ?? 0, maxTokens };
  },
  embed: async (m, texts, mode) => (texts.length ? (await embedOut(m, texts, mode)).vectors : []),
  rerank: (m, query, texts) => transformersRuntime.rerank(m, query, texts),
};
