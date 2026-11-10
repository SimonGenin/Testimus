import type { Query, QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { events, onProjectChange, onStream, project } from "./client.ts";
import { invalidateProject, type Key, key, matches, type Prefix, setReachable } from "./query.ts";
import { keysOfKind, keysOfPaths } from "./refresh.ts";

// ponytail: the reads a job changes while it runs — an index run says in docs.list and rag.status which documents it
// reads and how far it got; they follow each step of it (a read in flight is not restarted, so a fast run cannot starve it)
const LIVE = /^rag-index$|^rag\.index$/;
const LIVE_KEYS: Prefix[] = [["docs.list"], ["rag.status"]];

// ponytail: a progress event names its job only — the kind is the one its status said, or, for a job that started
// before the page opened, the one the jobs read holds
const kinds = new Map<string, string>();

function kindOf(client: QueryClient, jobId: string, p: string | null): string | undefined {
  const known = kinds.get(jobId);
  if (known) return known;
  for (const [, jobs] of client.getQueriesData<Job[]>({ queryKey: key("jobs.list", undefined, p) }))
    if (Array.isArray(jobs)) {
      const j = jobs.find((x) => x.id === jobId);
      if (j) return j.kind;
    }
  return undefined;
}

function followLive(client: QueryClient, kind: string | undefined, p: string | null): void {
  if (!kind || !LIVE.test(kind)) return;
  void client.invalidateQueries(
    { predicate: (q) => LIVE_KEYS.some((x) => matches(q.queryKey, x, p)) },
    { cancelRefetch: false },
  );
}

const again = new WeakMap<QueryClient, Set<string>>();

function waitingOf(client: QueryClient): Set<string> {
  const known = again.get(client);
  if (known) return known;
  const waiting = new Set<string>();
  again.set(client, waiting);
  client.getQueryCache().subscribe(({ query }) => {
    if (!waiting.has(query.queryHash) || query.state.fetchStatus !== "idle") return;
    waiting.delete(query.queryHash);
    queueMicrotask(() => void client.invalidateQueries({ queryKey: query.queryKey, exact: true }));
  });
  return waiting;
}

// ponytail: what moved is read again by the reads a screen shows — at once when idle; when in flight, once it lands
// (it may have read the files before they moved), never dropped and started over: during a long generation or a
// pull a slow read was cancelled at every burst of writes and the server still worked each one out. Landed, it is
// marked stale again (its answer may be from before the move), so a screen left meanwhile reads it when shown. The
// reads no screen shows are only marked stale (read when shown)
export function readAgain(client: QueryClient, prefixes: Prefix[], p: string | null = project()): void {
  const predicate = (q: Query) => prefixes.some((x) => matches(q.queryKey, x, p));
  void client.invalidateQueries({ predicate, refetchType: "none" });
  const waiting = waitingOf(client);
  const idle: string[] = [];
  for (const q of client.getQueryCache().findAll({ predicate, type: "active" }))
    if (q.state.fetchStatus === "fetching") waiting.add(q.queryHash);
    else idle.push(q.queryHash);
  if (idle.length) void client.refetchQueries({ type: "active", predicate: (q) => idle.includes(q.queryHash) });
}

// ponytail: one job event applied to a list of jobs — a status replaces the job (or adds it on top), the others patch
// its bar, its steps or its processes
export function applyJobEvent(jobs: Job[], e: JobEvent): Job[] {
  if (e.type === "status") {
    const i = jobs.findIndex((j) => j.id === e.job.id);
    return i < 0 ? [e.job, ...jobs] : jobs.map((j) => (j.id === e.job.id ? e.job : j));
  }
  const patch = (f: (j: Job) => Job) => jobs.map((j) => (j.id === e.jobId ? f(j) : j));
  if (e.type === "progress")
    return patch((j) => ({
      ...j,
      message: e.message,
      progress: e.total !== undefined ? { done: e.done ?? 0, total: e.total } : j.progress,
      steps: j.steps?.map((s) =>
        s.id === e.step
          ? { ...s, message: e.message, ...(e.total !== undefined ? { done: e.done ?? 0, total: e.total } : {}) }
          : s,
      ),
    }));
  if (e.type === "steps") return patch((j) => ({ ...j, steps: e.steps }));
  if (e.type === "process")
    return patch((j) => ({
      ...j,
      processes: [...(j.processes ?? []).filter((x) => x.id !== e.process.id), e.process],
    }));
  return jobs;
}

const sig = (e: JobEvent) => JSON.stringify({ ...e, project: undefined });

// ponytail: a job's detail read that landed while its events waited for the frame already holds them — they are not
// added twice
function unseen(have: JobEvent[], mine: JobEvent[]): JobEvent[] {
  const from = mine[0]?.at ?? "";
  const known = new Set(have.filter((e) => e.at >= from).map(sig));
  return known.size ? mine.filter((e) => !known.has(sig(e))) : mine;
}

// ponytail: the jobs reads follow the events of the jobs without a round trip; a status still reads them again, since
// a list of the running jobs drops one that ended
// a list about one test or document (its history) takes only the jobs it holds — a new one comes with the read again
function follow(client: QueryClient, events: JobEvent[], p: string | null): void {
  for (const [k, jobs] of client.getQueriesData<Job[]>({ queryKey: key("jobs.list", undefined, p) })) {
    if (!Array.isArray(jobs)) continue;
    const about = !!(k[2] as { about?: string } | undefined)?.about;
    const mine = about ? events.filter((e) => e.type !== "status" || jobs.some((j) => j.id === e.job.id)) : events;
    client.setQueryData(k, mine.reduce(applyJobEvent, jobs));
  }
  for (const id of new Set(events.map((e) => e.jobId))) {
    const mine = events.filter((e) => e.jobId === id);
    client.setQueriesData<{ job: Job; events: JobEvent[] }>({ queryKey: key("jobs.show", { id }, p) }, (d) =>
      d?.job
        ? {
            job: mine.reduce((j, e) => applyJobEvent([j], e)[0], d.job),
            events: [...(d.events ?? []), ...unseen(d.events ?? [], mine)],
          }
        : d,
    );
  }
}

// ponytail: the events of a running job (Claude's words, progress, steps) reach the cache once per frame, all those
// that came meanwhile at once: a job's detail is worked out again at most once per frame, not at each of the
// thousands of events of a run, and its log is copied once. A status is applied at once, after those before it. A
// timer stands in for the frame in a hidden window, where frames stop (the taskbar's progress still follows)
let queued: { client: QueryClient; p: string | null; events: JobEvent[] } | null = null;

function flushJobs(): void {
  const q = queued;
  queued = null;
  if (q) follow(q.client, q.events, q.p);
}

function followSoon(client: QueryClient, e: JobEvent, p: string | null): void {
  if (queued && (queued.client !== client || queued.p !== p)) flushJobs();
  if (queued) {
    queued.events.push(e);
    return;
  }
  const mine = { client, p, events: [e] };
  queued = mine;
  const go = () => {
    if (queued === mine) flushJobs();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
  setTimeout(go, 250);
}

const jobListeners = new Map<string, Set<(e: JobEvent) => void>>();
const anyListeners = new Set<(e: JobEvent) => void>();

export function apply(client: QueryClient, e: JobEvent, p: string | null = project()): void {
  if (e.project !== undefined && e.project !== null && e.project !== p) return;
  for (const fn of jobListeners.get(e.jobId) ?? []) fn(e);
  for (const fn of anyListeners) fn(e);
  if (e.type === "notice") client.setQueryData(["notice"], e.message);
  else if (e.type === "changed") {
    if (e.paths.includes("")) void invalidateProject(client, p);
    else readAgain(client, keysOfPaths(e.paths), p);
  } else {
    if (e.type !== "status") {
      followSoon(client, e, p);
      if (e.type === "progress") followLive(client, kindOf(client, e.jobId, p), p);
      return;
    }
    flushJobs();
    follow(client, [e], p);
    if (e.job.status === "running") {
      kinds.set(e.jobId, e.job.kind);
      followLive(client, e.job.kind, p);
    } else kinds.delete(e.jobId);
    const keys: Prefix[] = [["jobs.list"], ["jobs.show", { id: e.jobId }], ["project.info"]];
    // ponytail: a run's record (.testimus/runs, not watched) is finished after the test.md it wrote — any job may have
    // been a Claude run
    if (e.job.status !== "running") keys.push(...keysOfKind(e.job.kind), ["claude.before"]);
    readAgain(client, keys, p);
  }
}

// ponytail: the stream is opened once for the whole page; a reopen marks every read stale (events missed while it was
// down) and reads again the ones shown, a drop says the server is unreachable until something answers again
export function connectEvents(client: QueryClient): () => void {
  let dropped = false;
  const offStream = onStream((up) => {
    setReachable(up);
    if (!up) dropped = true;
    else if (dropped) {
      dropped = false;
      void client.invalidateQueries();
    }
  });
  const offEvents = events((e) => apply(client, e));
  // ponytail: the events of a project the window left are not applied, so its reads are dropped rather than kept
  // stale — a project one comes back to is read again (a switch drops the caches)
  const offProject = onProjectChange((left) => {
    if (left !== null) client.removeQueries({ predicate: (q) => (q.queryKey as Key)[0] === left });
  });
  return () => {
    offEvents();
    offStream();
    offProject();
  };
}

export function onJobEvents(jobId: string, fn: (e: JobEvent) => void): () => void {
  const set = jobListeners.get(jobId) ?? new Set();
  set.add(fn);
  jobListeners.set(jobId, set);
  return () => {
    set.delete(fn);
    if (!set.size) jobListeners.delete(jobId);
  };
}

export function onAnyEvent(fn: (e: JobEvent) => void): () => void {
  anyListeners.add(fn);
  return () => anyListeners.delete(fn);
}

// ponytail: the live text of one job (a Claude run streaming, a download's progress) — the cache holds the job, this
// hands over each event as it comes
export function useJobEvents(jobId: string | null | undefined, fn: (e: JobEvent) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => (jobId ? onJobEvents(jobId, (e) => ref.current(e)) : undefined), [jobId]);
}
