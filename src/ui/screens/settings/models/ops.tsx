import { useEffect, useState } from "react";
import type { Job } from "../../../../core/types.ts";
import { useApp } from "../../../lib/app.ts";
import { useRead } from "../../../lib/data/query.ts";
import { errorToast } from "../../../lib/toast.ts";
import { useJob } from "../jobs.ts";

// ponytail: the long work of this page — a download, a pack being installed, the models moving, an index, a measure;
// what runs comes from jobs.list (so a job started before the page opened is followed too), what this page started
// keeps its words and what to do next
export type Op = { key: string; jobId: string; label: string; kind: string };

type Started = { key: string; kind: string; label: string; then?: (result: unknown) => void };

export const packLabel = (id: string) => `${id.charAt(0).toUpperCase()}${id.slice(1)}`;

export const MEASURE = "measure:";

function found(j: Job, name: (id: string) => string): Started | null {
  if (j.kind === "models-usePack") return { key: j.subject, kind: j.kind, label: `Installing ${packLabel(j.subject)}` };
  if (j.kind === "models-pull") return { key: j.subject, kind: j.kind, label: `Downloading ${name(j.subject)}` };
  if (j.kind === "models-verify") return { key: j.subject, kind: j.kind, label: `Verifying ${name(j.subject)}` };
  if (j.kind === "rag-index" || j.kind === "rag.index")
    return { key: "index", kind: j.kind, label: "Indexing the documents" };
  if (j.kind === "models-measure") return { key: `${MEASURE}${j.subject}`, kind: j.kind, label: "Measuring" };
  if (j.kind === "models-dir")
    return {
      key: "dir",
      kind: j.kind,
      label: j.subject.startsWith("copy ")
        ? "Copying the models"
        : j.subject.startsWith("move ")
          ? "Moving the models"
          : "Changing the models folder",
    };
  return null;
}

function Watch({ jobId, onEnd }: { jobId: string; onEnd: (job: Job) => void }) {
  useJob(jobId, onEnd);
  return null;
}

// ponytail: name gives a model's name from its id (the catalog's label), for a job found running after a reload
export function useOps(onEnded?: (op: Op, job: Job) => void, name: (id: string) => string = (id) => id) {
  const app = useApp();
  const running = useRead("jobs.list", { running: true }, { enabled: !!app.info });
  const [started, setStarted] = useState<Record<string, Started>>({});
  const [ended, setEnded] = useState<Set<string>>(new Set());
  const ops: Op[] = [];
  for (const j of running.data ?? []) {
    const f = started[j.id] ?? found(j, name);
    if (f && !ended.has(j.id)) ops.push({ key: f.key, jobId: j.id, label: f.label, kind: f.kind });
  }
  for (const [jobId, s] of Object.entries(started))
    if (!ops.some((o) => o.jobId === jobId) && !ended.has(jobId))
      ops.push({ key: s.key, jobId, label: s.label, kind: s.kind });

  const start = (jobId: string, key: string, kind: string, label: string, then?: (result: unknown) => void) =>
    setStarted((s) => ({ ...s, [jobId]: { key, kind, label, then } }));

  const end = (op: Op, job: Job) => {
    setEnded((e) => new Set(e).add(job.id));
    const s = started[job.id];
    setStarted((all) => {
      const { [job.id]: _, ...rest } = all;
      return rest;
    });
    if (job.status === "done") s?.then?.(job.result);
    else if (job.status === "failed" && op.kind !== "models-measure")
      errorToast(new Error(job.error ?? "The job failed."), `${op.label}: stopped`);
    onEnded?.(op, job);
  };

  // ponytail: a job seen once is watched until its end is read, even when jobs.list has already dropped it
  const [watching, setWatching] = useState<Record<string, Op>>({});
  const unseen = ops.filter((o) => !watching[o.jobId]);
  useEffect(() => {
    if (unseen.length) setWatching((w) => ({ ...w, ...Object.fromEntries(unseen.map((o) => [o.jobId, o])) }));
  });
  const watchers = Object.values({ ...watching, ...Object.fromEntries(unseen.map((o) => [o.jobId, o])) })
    .filter((op) => !ended.has(op.jobId))
    .map((op) => <Watch key={op.jobId} jobId={op.jobId} onEnd={(job) => end(op, job)} />);
  return { ops, start, watchers };
}
