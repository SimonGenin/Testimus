import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { scope } from "../../shared/run/work.ts";
import { activeModels } from "../rag/activation.ts";
import { indexFile, openDb } from "../rag/db.ts";
import { spaceOf } from "../rag/fingerprint.ts";
import type { DocRef } from "../types.ts";
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

// ponytail: the one rule of index freshness (docs.list, rag.status): missing until a run read the document; fresh when
// its current text was read and the active model's vectors are complete (or no model is installed); stale otherwise
export async function docsFreshness(project: string): Promise<DocRef[]> {
  const docs = listDocs(project);
  if (!docs.some((d) => d.indexed === "fresh")) return docs;
  const complete = await vectorsComplete(project);
  return complete ? docs : docs.map((d) => (d.indexed === "fresh" ? { ...d, indexed: "stale" } : d));
}
