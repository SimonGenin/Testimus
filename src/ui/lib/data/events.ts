import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { JobEvent } from "../../../core/types.ts";
import { events, onStream, project } from "./client.ts";
import { invalidate, invalidateProject, type Prefix, setReachable } from "./query.ts";

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
      ["tests.columns", { id: m[1] }],
    ],
  ],
  [/^tests\/([^/]+)\/\.state\.json$/, (m) => [["tests.show", { id: m[1] }], ["tests.list"]]],
  [/^tests\/([^/]+)(\/|$)/, (m) => [["tests.show", { id: m[1] }], ["tests.list"], ["review.queue"], ["project.info"]]],
  [
    /^docs\/([^/]+)\/doc\.json$/,
    (m) => [["docs.list"], ["docs.show", { id: m[1] }], ["rag.status"], ["project.info"], ["rag.passage"]],
  ],
  [
    /^docs\/([^/]+)\/(doc\.md|figures|figures\.json)/,
    (m) => [["docs.show", { id: m[1] }], ["rag.passage"], ["rag.figure"], ["docs.page"]],
  ],
  [/^docs\/([^/]+)\/context\.md$/, (m) => [["docs.show", { id: m[1] }]]],
  [/^docs\/([^/]+)(\/|$)/, () => [["docs.list"], ["rag.status"], ["project.info"]]],
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
    () => [["rag.status"], ["rag.spaces"], ["docs.list"], ["docs.show"], ["search.all"], ["models.advice"]],
  ],
  [/^search-index$/, () => [["search.all"]]],
  [/^generate$/, () => [["review.evidence"], ["review.queue"]]],
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
  } else if (e.type === "status") {
    const done = e.job.status !== "running";
    const keys: Prefix[] = [["jobs.list"], ["jobs.show", { id: e.jobId }], ["project.info"]];
    if (done) keys.push(...keysOfKind(e.job.kind));
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
  return () => {
    offEvents();
    offStream();
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
