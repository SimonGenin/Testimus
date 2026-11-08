import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { scope } from "../../shared/run/work.ts";
import { activeModels } from "../rag/activation.ts";
import { indexFile, openDb } from "../rag/db.ts";
import { spaceOf } from "../rag/fingerprint.ts";
import { type LiveIndex, liveIndex } from "../rag/indexer.ts";
import type { DocIndexing, DocRef, IndexRun } from "../types.ts";
import { listDocs } from "./docs.ts";

type Queue = { converting: Set<Promise<unknown>>; running: Promise<unknown> | null; waiting: Promise<unknown> | null };

const queues = new Map<string, Queue>();

function queueOf(project: string): Queue {
  const key = resolve(project).toLowerCase();
  let q = queues.get(key);
  if (!q) {
    q = { converting: new Set(), running: null, waiting: null };
    queues.set(key, q);
  }
  return q;
}

const until = <T>(p: Promise<T>, signal?: AbortSignal): Promise<T> => (signal ? scope(() => p, { signal }) : p);

// ponytail: a conversion writing a document's folder — an index run that would read it half-written waits for it
export function whileConverting<T>(project: string, work: () => Promise<T>): Promise<T> {
  const q = queueOf(project);
  const p = work();
  const done = () => q.converting.delete(p);
  q.converting.add(p);
  p.then(done, done);
  return p;
}

function start<T>(q: Queue, run: () => Promise<T>): Promise<T> {
  const p = run();
  q.running = p;
  const done = () => {
    if (q.running === p) q.running = null;
  };
  p.then(done, done);
  return p;
}

// ponytail: one index run at a time per project, never while a conversion is writing a document: a run asked for
// meanwhile waits for both, and the runs asked for while it waits share it (it reads every document when it starts)
export function indexAfterConversions<T>(
  project: string,
  run: () => Promise<T>,
  o: { signal?: AbortSignal; waiting?: (message: string) => void } = {},
): Promise<T> {
  const q = queueOf(project);
  if (q.waiting) return until(q.waiting as Promise<T>, o.signal);
  if (!q.running && !q.converting.size) return start(q, run);
  o.waiting?.(q.converting.size ? "Waiting for the other conversions" : "Waiting for the index run");
  const waiting = (async () => {
    while (q.running || q.converting.size) await Promise.allSettled([q.running, ...q.converting]);
    q.waiting = null;
    return start(q, run);
  })();
  q.waiting = waiting;
  return until(waiting, o.signal);
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

// ponytail: whether an index run is going on for the project (running) or asked for and waiting its turn
export function indexRunState(project: string): IndexRun["state"] | null {
  const q = queues.get(resolve(project).toLowerCase());
  return q?.running ? "running" : q?.waiting ? "waiting" : null;
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
