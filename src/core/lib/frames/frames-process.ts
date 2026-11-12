import { fileURLToPath } from "node:url";
import { killChildrenOnExit, type Proc, type Stream, start } from "../../../shared/run/process.ts";
import { every, reasonOf } from "../../../shared/run/work.ts";
import type { Box, FrameOp, FrameOps, FramesAnswer, Size, Tile } from "./frames-protocol.ts";

// ponytail: the same rule as the embed worker — ten minutes without a picture to draw and the worker goes, its memory
// with it; TESTIMUS_FRAMES_IDLE_MS shortens it to watch it happen
export const IDLE_MS = 10 * 60 * 1000;
const idleKnob = Number(process.env.TESTIMUS_FRAMES_IDLE_MS);
export const framesTimeouts = { idleMs: idleKnob > 0 ? idleKnob : IDLE_MS };

// ponytail: framesIo is the seam env does not have — the worker program, its priority and the clock; the tests start a
// fake worker, and the unit suite (every core busy at normal priority) its workers at normal priority
export const framesIo = {
  script: (): string => fileURLToPath(new URL("./frames-worker.ts", import.meta.url)),
  priority: "low" as "low" | undefined,
  start: (args: string[], onLine: (line: string, stream: Stream) => void): Proc =>
    start({ exe: process.execPath, args, keepStdin: true, keepStdout: false, priority: framesIo.priority, onLine }),
  now: () => Date.now(),
};

type Pending = { resolve(a: FramesAnswer): void; reject(e: Error): void };
export type FramesWorker = {
  proc: Proc;
  pending: Map<number, Pending>;
  busy: number;
  lastUsed: number;
  stderr: string[];
  exitCode?: number;
};

let worker: FramesWorker | null = null;
let sweeper: (() => void) | null = null;
let nextId = 0;

function tail(w: FramesWorker): string {
  return w.stderr.length ? `\n${w.stderr.slice(-10).join("\n")}` : "";
}

function spawnWorker(): FramesWorker {
  const w: FramesWorker = {
    pending: new Map(),
    busy: 0,
    lastUsed: framesIo.now(),
    stderr: [],
    proc: undefined as unknown as Proc,
  };
  w.proc = framesIo.start([framesIo.script()], (line, stream) => {
    if (stream === "stderr") {
      w.stderr.push(line);
      if (w.stderr.length > 40) w.stderr.shift();
      return;
    }
    let a: FramesAnswer;
    try {
      a = JSON.parse(line) as FramesAnswer;
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
      `The frames process stopped (exit code ${e.code}).${tail(w) || (e.error ? `\n${e.error}` : "")}`,
    );
    for (const p of w.pending.values()) p.reject(why);
    w.pending.clear();
    if (worker === w) worker = null;
    stopSweeper();
  });
  worker = w;
  sweeper ??= every(Math.min(60_000, Math.max(250, framesTimeouts.idleMs / 4)), () => sweepIdle());
  return w;
}

function stopSweeper(): void {
  if (worker || !sweeper) return;
  sweeper();
  sweeper = null;
}

function toWorker<K extends FrameOp>(
  op: K,
  args: FrameOps[K]["in"],
  signal?: AbortSignal,
): Promise<FrameOps[K]["out"]> {
  if (signal?.aborted) return Promise.reject(reasonOf(signal));
  const w = worker && worker.exitCode === undefined ? worker : spawnWorker();
  const id = ++nextId;
  return new Promise<FramesAnswer>((resolve, reject) => {
    w.busy++;
    const done = () => {
      w.busy--;
      w.lastUsed = framesIo.now();
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
    w.proc.write(`${JSON.stringify({ id, op, args })}\n`);
  }).then((a) => {
    if ("error" in a) throw new Error(a.error);
    return a.result as FrameOps[K]["out"];
  });
}

// ponytail: the picture work of a video and of an images document, done by the frames worker (draw.ts) — a Node
// child at low priority, so sharp's threads never take the process that answers the page (§3). Each call follows its
// job's signal: a cancel rejects it at once, and the worker stops at its next picture

export function sharpness(files: string[], signal?: AbortSignal): Promise<number[]> {
  return files.length ? toWorker("sharpness", { files }, signal) : Promise.resolve([]);
}

export async function distinct<T extends { file: string }>(
  frames: T[],
  signal?: AbortSignal,
): Promise<(T & { box?: Box })[]> {
  if (!frames.length) return [];
  const kept = await toWorker("distinct", { files: frames.map((f) => f.file) }, signal);
  return kept.map((k) => ({ ...frames[k.i], ...(k.box ? { box: k.box } : {}) }));
}

export function crop(file: string, box: Box, out: string, signal?: AbortSignal): Promise<Size | null> {
  return toWorker("crop", { file, box, out }, signal);
}

export async function mosaic(tiles: Tile[], out: string, first: number, signal?: AbortSignal): Promise<void> {
  await toWorker("mosaic", { tiles, out, first }, signal);
}

export function normalizeFrame(src: string, out: string, signal?: AbortSignal): Promise<Size> {
  return toWorker("frame", { src, out }, signal);
}

export function preparePicture(src: string, out: string, signal?: AbortSignal): Promise<Size & { takenAt?: string }> {
  return toWorker("picture", { src, out }, signal);
}

export async function stopFramesWorker(): Promise<void> {
  const w = worker;
  worker = null;
  if (w && w.exitCode === undefined) await w.proc.kill();
  stopSweeper();
}

export async function sweepIdle(now = framesIo.now()): Promise<boolean> {
  const w = worker;
  if (!w || w.busy > 0 || now - w.lastUsed < framesTimeouts.idleMs) return false;
  await stopFramesWorker();
  return true;
}

export function liveFramesWorker(): FramesWorker | null {
  return worker;
}
