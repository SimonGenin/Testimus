import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { reasonOf, scope, throwIfAborted } from "../../shared/run/work.ts";
import { activeModels } from "../rag/activation.ts";
import { indexFile, openDb } from "../rag/db.ts";
import { spaceOf } from "../rag/fingerprint.ts";
import { type LiveIndex, liveIndex } from "../rag/indexer.ts";
import type { DocIndexing, DocRef, IndexRun } from "../types.ts";
import { type AgentPool, conversionPool } from "./agents.ts";
import { listDocs } from "./docs.ts";

type Slots = { pool: AgentPool; users: number };
type Shared = { p: Promise<unknown>; ctl: AbortController; users: number; settled: boolean };
type Queue = {
  converting: Set<Promise<unknown>>;
  running: Promise<unknown> | null;
  reads: number | null;
  waiting: Shared | null;
  slots: Slots | null;
};

const queues = new Map<string, Queue>();

function queueOf(project: string): Queue {
  const key = resolve(project).toLowerCase();
  let q = queues.get(key);
  if (!q) {
    q = { converting: new Set(), running: null, reads: null, waiting: null, slots: null };
    queues.set(key, q);
  }
  return q;
}

const until = <T>(p: Promise<T>, signal?: AbortSignal): Promise<T> => (signal ? scope(() => p, { signal }) : p);

// ponytail: a conversion writing a document's folder — the work that reads every document once the import is over
// (the overview) waits for it; the index does not (queueIndex)
export function whileConverting<T>(project: string, work: () => Promise<T>): Promise<T> {
  const q = queueOf(project);
  const p = work();
  const done = () => q.converting.delete(p);
  q.converting.add(p);
  p.then(done, done);
  return p;
}

// ponytail: a project's conversions go through one adaptive pool (lib/agents.ts) — as many at once as the agents
// setting, the cores and the free memory allow, looked at again every few seconds; each weighs what it takes in memory
// (a video far more than a Word document) and starts only when the free memory covers it. The pool is made again once
// every conversion of the last batch ended (a changed setting is then read). One asked for meanwhile waits its turn
// (onWait); a conversion that fails frees its place like one that ends
export function conversionSlot<T>(
  project: string,
  work: () => Promise<T>,
  o: { signal?: AbortSignal; weightMB?: number; onWait?: (atOnce: number) => void } = {},
): Promise<T> {
  const q = queueOf(project);
  if (!q.slots?.users) q.slots = { pool: conversionPool(), users: 0 };
  const slots = q.slots;
  slots.users++;
  return whileConverting(project, () =>
    slots.pool
      .run(work, { weightMB: o.weightMB, signal: o.signal, onWait: () => o.onWait?.(slots.pool.limit()) })
      .finally(() => {
        slots.users--;
      }),
  );
}

// ponytail: the documents the pass reads (those not fresh when it starts) — what a conversion waiting for the next
// pass has before it
function readsOf(project: string): number | null {
  try {
    return listDocs(project).filter((d) => d.indexed !== "fresh").length;
  } catch {
    return null;
  }
}

function start<T>(q: Queue, project: string, run: () => Promise<T>): Promise<T> {
  q.reads = readsOf(project);
  const p = run();
  q.running = p;
  const done = () => {
    if (q.running === p) {
      q.running = null;
      q.reads = null;
    }
  };
  p.then(done, done);
  return p;
}

// ponytail: a caller of a shared run stops waiting for it when its own signal aborts; the run itself stops only once
// every caller has left (its signal is its own, never one caller's)
function join<T>(q: Queue, s: Shared, signal?: AbortSignal): Promise<T> {
  s.users++;
  const leave = () => {
    if (s.settled || --s.users > 0) return;
    if (q.waiting === s) q.waiting = null;
    s.ctl.abort(reasonOf(signal as AbortSignal));
  };
  if (signal?.aborted) leave();
  else signal?.addEventListener("abort", leave, { once: true });
  return until(s.p as Promise<T>, signal);
}

function shared<T>(work: (signal: AbortSignal) => Promise<T>): Shared {
  const ctl = new AbortController();
  const s: Shared = { p: Promise.resolve(), ctl, users: 0, settled: false };
  s.p = work(ctl.signal);
  const done = () => {
    s.settled = true;
  };
  s.p.then(done, done);
  return s;
}

const waitingLine = (reads: number | null) =>
  reads === null
    ? "Waiting for the running index"
    : `Waiting for the running index (${reads === 1 ? "1 document" : `${reads} documents`} before)`;

// ponytail: the index as documents come — one pass at a time per project, and a pass waits for nothing else: a
// document converted joins the next pass, which starts as soon as the running one ends and reads everything ready then
// (one document at first, several once the index is busy); the passes asked for while one waits share it. A document
// a conversion is writing while a pass reads it is read again by the next pass, the one its conversion asks for once
// done. A pass gets a signal of its own: it is cancelled when everyone who asked for it cancelled — one conversion's
// cancel only ends that conversion's wait — or when its own job is cancelled
export function queueIndex<T>(
  project: string,
  run: (signal: AbortSignal) => Promise<T>,
  o: { signal?: AbortSignal; waiting?: (message: string) => void } = {},
): Promise<T> {
  const q = queueOf(project);
  if (q.waiting) {
    o.waiting?.(waitingLine(q.reads));
    return join(q, q.waiting, o.signal);
  }
  if (!q.running)
    return join(
      q,
      shared((signal) => start(q, project, () => run(signal))),
      o.signal,
    );
  o.waiting?.(waitingLine(q.reads));
  const s: Shared = shared(async (signal) => {
    while (q.running) {
      await Promise.allSettled([q.running]);
      throwIfAborted(signal);
    }
    if (q.waiting === s) q.waiting = null;
    throwIfAborted(signal);
    return start(q, project, () => run(signal));
  });
  q.waiting = s;
  return join(q, s, o.signal);
}

async function vectorsComplete(project: string): Promise<boolean> {
  const m = (await activeModels(project)).embedding;
  if (!m) return true;
  if (!existsSync(indexFile(project))) return false;
  return scope(async (s) => {
    const db = openDb(indexFile(project));
    s.defer(() => db.close());
    return !!spaceOf(db, m)?.complete;
  });
}

// ponytail: the conversions and the index run going on or waiting for a project — work that reads every document
// (the overview after an import) waits for all of them
export function indexWork(project: string): Promise<unknown>[] {
  const q = queues.get(resolve(project).toLowerCase());
  return q ? [q.running, q.waiting, ...q.converting].filter((p): p is Promise<unknown> => !!p) : [];
}

// ponytail: whether an index run is going on for the project (running) or asked for and waiting its turn
export function indexRunState(project: string): IndexRun["state"] | null {
  const q = queues.get(resolve(project).toLowerCase());
  return q?.running ? "running" : q?.waiting ? "waiting" : null;
}

// ponytail: while a pass runs and the next one waits, the documents the running pass reads — what a document waiting
// for the next pass has before it; null otherwise
export function waitingBefore(project: string): number | null {
  const q = queues.get(resolve(project).toLowerCase());
  return q?.running && q.waiting ? q.reads : null;
}

const WAITING: DocIndexing = { state: "waiting", percent: 0, done: 0, total: 0 };

// ponytail: the document the run reads now, and those it has started embedding, are running; one with nothing to
// embed is done (100 %); the others wait their turn
function indexingOf(id: string, live: LiveIndex | null): DocIndexing {
  if (!live) return WAITING;
  const n = live.docs.get(id) ?? { done: 0, total: 0 };
  const embedding = live.docs.has(id);
  if (live.current !== id && n.done === 0 && !(embedding && n.total === 0)) return WAITING;
  return { state: "running", percent: n.total ? Math.floor((n.done / n.total) * 100) : embedding ? 100 : 0, ...n };
}

// ponytail: the one rule of index freshness (docs.list, rag.status): missing until a run read the document; fresh when
// its current text was read and the active model's vectors are complete (or no model is installed); stale otherwise.
// While an index run is under way (or waiting), a document that is not fresh is one it reads: it says so instead
export async function docsFreshness(project: string): Promise<DocRef[]> {
  const listed = listDocs(project);
  const complete = !listed.some((d) => d.indexed === "fresh") || (await vectorsComplete(project));
  const docs = complete ? listed : listed.map((d) => (d.indexed === "fresh" ? { ...d, indexed: "stale" as const } : d));
  const run = indexRunState(project);
  if (!run) return docs;
  const live = run === "running" ? liveIndex(project) : null;
  return docs.map((d) => (d.indexed === "fresh" ? d : { ...d, indexing: indexingOf(d.id, live) }));
}

// ponytail: the run under way in a few numbers — which document of how many, and the passages embedded so far
export function indexRunOf(project: string, docs: DocRef[]): IndexRun | null {
  const state = indexRunState(project);
  if (!state) return null;
  const read = docs.filter((d) => d.indexing);
  const sum = (k: "done" | "total") => read.reduce((n, d) => n + (d.indexing?.[k] ?? 0), 0);
  const doc = read.filter((d) => d.indexing?.state === "running").length;
  return {
    state,
    doc: Math.min(Math.max(doc, state === "running" ? 1 : 0), read.length),
    docs: read.length,
    done: sum("done"),
    total: sum("total"),
  };
}
