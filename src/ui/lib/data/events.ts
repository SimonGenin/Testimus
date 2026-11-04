import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { events, onProjectChange, onStream, project } from "./client.ts";
import { invalidate, invalidateProject, type Key, key, type Prefix, setReachable } from "./query.ts";

type Rule = [pattern: RegExp, keys: (m: RegExpMatchArray) => Prefix[]];

// ponytail: a file changed in the project → the reads that show it (SPEC §3: the files are the state)
const PATHS: Rule[] = [
  [
    /^tests\/([^/]+)\/test\.md$/,
    (m) => [
      ["tests.show", { id: m[1] }],
      ["check.show", { id: m[1] }],
      ["tests.list"],
      ["review.queue"],
      ["xray.plan", { id: m[1] }],
      ["search.all"],
      ["project.info"],
      ["gen.preview"],
    ],
  ],
  [
    /^tests\/([^/]+)\/\.remote\.md$/,
    (m) => [["tests.show", { id: m[1] }], ["tests.list"], ["xray.plan", { id: m[1] }], ["xray.status", { id: m[1] }]],
  ],
  [
    /^tests\/([^/]+)\/check\.json$/,
    (m) => [["check.show", { id: m[1] }], ["tests.show", { id: m[1] }], ["review.queue"], ["tests.list"]],
  ],
  [/^tests\/([^/]+)\/images\//, (m) => [["tests.show", { id: m[1] }]]],
  [
    /^tests\/([^/]+)\/local\.json$/,
    (m) => [
      ["contexts.ofTest", { testId: m[1] }],
      ["tests.folds", { id: m[1] }],
    ],
  ],
  [/^tests\/([^/]+)\/\.state\.json$/, (m) => [["tests.show", { id: m[1] }], ["tests.list"]]],
  [
    /^tests\/([^/]+)(\/|$)/,
    (m) => [["tests.show", { id: m[1] }], ["tests.list"], ["review.queue"], ["project.info"], ["gen.preview"]],
  ],
  [
    /^docs\/([^/]+)\/doc\.json$/,
    (m) => [
      ["docs.list"],
      ["docs.show", { id: m[1] }],
      ["rag.status"],
      ["project.info"],
      ["rag.passage"],
      ["gen.preview"],
    ],
  ],
  [
    /^docs\/([^/]+)\/(doc\.md|figures|figures\.json)/,
    (m) => [["docs.show", { id: m[1] }], ["rag.passage"], ["rag.figure"], ["docs.page"], ["docs.list"]],
  ],
  [/^docs\/([^/]+)\/context\.md$/, (m) => [["docs.show", { id: m[1] }]]],
  [/^docs\/([^/]+)(\/|$)/, () => [["docs.list"], ["rag.status"], ["project.info"], ["gen.preview"]]],
  [
    /^project\.json$/,
    () => [
      ["project.info"],
      ["contexts.ofProject"],
      ["contexts.ofTest"],
      ["models.packs"],
      ["models.advice"],
      ["rag.status"],
      ["system.doctor"],
    ],
  ],
  [/^(xray|columns)\.json$/, () => [["project.info"], ["columns.list"]]],
  [/^CLAUDE\.md$/, () => [["project.notes"]]],
  [/^contexts\//, () => [["contexts.list"], ["contexts.show"], ["contexts.ofTest"], ["contexts.ofProject"]]],
  [/^\.testimus\/actions\//, () => [["actions.list"], ["actions.show"]]],
];

// ponytail: what a finished job changed outside the project files (the index, the models folder, Jira)
const KINDS: Rule[] = [
  [
    /^rag-index$|^rag\.index$/,
    () => [
      ["rag.status"],
      ["rag.spaces"],
      ["docs.list"],
      ["docs.show"],
      ["search.all"],
      ["models.advice"],
      ["gen.preview"],
    ],
  ],
  [/^search-index$/, () => [["search.all"]]],
  [/^docs\.(add|addFiles|convert)$|^docs-|^describe-figures$/, () => [["docs.list"], ["docs.show"], ["rag.status"]]],
  [/^generate$/, () => [["review.evidence"], ["review.queue"], ["gen.preview"]]],
  [
    /^models-/,
    () => [
      ["models.list"],
      ["models.catalog"],
      ["models.packs"],
      ["models.advice"],
      ["models.hardware"],
      ["rag.status"],
      ["system.doctor"],
      ["models.dirs"],
      ["models.planPack"],
      ["models.planDir"],
    ],
  ],
  [/^agents-test$/, () => [["system.settings"]]],
  [/^push$/, () => [["xray.status"], ["xray.folders"], ["xray.search"]]],
  [/^pull$/, () => [["xray.search"]]],
];

export function keysOfPaths(paths: string[]): Prefix[] {
  const out: Prefix[] = [];
  for (const path of paths)
    for (const [re, keys] of PATHS) {
      const m = path.match(re);
      if (m) {
        out.push(...keys(m));
        break;
      }
    }
  return out;
}

export function keysOfKind(kind: string): Prefix[] {
  return KINDS.flatMap(([re, keys]) => {
    const m = kind.match(re);
    return m ? keys(m) : [];
  });
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

// ponytail: the jobs reads follow each event of a job without a round trip; a status still reads them again, since a
// list of the running jobs drops one that ended
function follow(client: QueryClient, e: JobEvent, p: string | null): void {
  client.setQueriesData<Job[]>({ queryKey: key("jobs.list", undefined, p) }, (jobs) =>
    Array.isArray(jobs) ? applyJobEvent(jobs, e) : jobs,
  );
  client.setQueriesData<{ job: Job; events: JobEvent[] }>({ queryKey: key("jobs.show", { id: e.jobId }, p) }, (d) =>
    d?.job ? { job: applyJobEvent([d.job], e)[0], events: [...(d.events ?? []), e] } : d,
  );
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
    else void invalidate(client, keysOfPaths(e.paths), p);
  } else {
    follow(client, e, p);
    if (e.type !== "status") return;
    const keys: Prefix[] = [["jobs.list"], ["jobs.show", { id: e.jobId }], ["project.info"]];
    if (e.job.status !== "running") keys.push(...keysOfKind(e.job.kind));
    void invalidate(client, keys, p);
  }
}

// ponytail: the stream is opened once for the whole page; a reopen re-reads every active query (events missed while it
// was down), a drop says the server is unreachable until something answers again
export function connectEvents(client: QueryClient): () => void {
  let dropped = false;
  const offStream = onStream((up) => {
    setReachable(up);
    if (!up) dropped = true;
    else if (dropped) {
      dropped = false;
      void client.invalidateQueries({ type: "active" });
    }
  });
  const offEvents = events((e) => apply(client, e));
  // ponytail: the events of a project the window left are not applied, so its reads are dropped rather than kept
  // stale — a project one comes back to is read again (SPEC §13: a switch drops the caches)
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
