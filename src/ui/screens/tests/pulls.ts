import { useSyncExternalStore } from "react";
import type { Job, PullInfo, PullStage } from "../../../core/types.ts";
import { call, project, run } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { useProjectJobs } from "../../lib/projectJobs.ts";
import { errorToast } from "../../lib/toast.ts";

export type PullRead = Extract<PullStage, { phase: "read" }>;
export type Pull = {
  key: string;
  summary: string;
  jobId?: string;
  message?: string;
  error?: string;
  startedAt?: number;
  phase?: PullStage["phase"];
  read?: PullRead;
  images?: { done: number; total: number };
};

type PullResult = { pulled?: string[]; failed?: { key: string; error: string }[] };
type Mine = { key: string; dir: string | null; summary: string; startedAt: number; jobId?: string; error?: string };
type Lander = (key: string, watched: boolean) => void | Promise<void>;

// ponytail: a pull is its job (kind pull, subject the key, in jobs.list; its stages in jobs.show) — a reload or another
// window shows it as it goes; the page keeps only the pulls it started (to abandon them on a project switch, and to show
// one whose job has not started or was refused), the summary the list showed, which failures the reader let go, and the
// key the screen is watching
const view = {
  mine: [] as Mine[],
  summaries: new Map<string, string>(),
  dismissed: new Set<string>(),
  since: Date.now(),
  watched: "",
  version: 0,
};
const listeners = new Set<() => void>();
const landers = new Set<Lander>();
const emit = () => {
  view.version++;
  for (const l of listeners) l();
};
// ponytail: a summary, a failure let go — each belongs to a key or a job of one project
const at = (dir: string | null, id: string) => `${dir ?? ""}\n${id}`;
const mineOf = (key: string, dir = project()) => view.mine.find((m) => m.key === key && m.dir === dir);
const drop = (m: Mine) => {
  view.mine = view.mine.filter((x) => x !== m);
  emit();
};

const staged = (p: PullInfo | undefined): Partial<Pull> => {
  if (!p) return {};
  if (p.phase === "read") return { phase: p.phase, read: p };
  if (p.phase === "images") return { phase: p.phase, images: { done: p.done, total: p.total } };
  return { phase: p.phase };
};

const strip = (key: string, m?: string) => (m?.startsWith(`${key}: `) ? m.slice(key.length + 2) : m);

// ponytail: a job belongs to the project it was started in, and after a switch call would name the new one — the core
// refuses to cancel another project's job, so the call names the job's own project
async function cancelJob(id: string, dir: string | null): Promise<void> {
  await call("jobs.cancel", { id }, { project: dir }).catch(() => {});
}

function failureOf(j: Job): string | undefined {
  if (j.status === "failed" || j.status === "cancelled")
    return j.error || (j.status === "cancelled" ? "Cancelled." : "The pull failed.");
  if (j.status !== "done") return undefined;
  const r = j.result as PullResult | null | undefined;
  return (r?.failed?.find((f) => f.key === j.subject) ?? r?.failed?.[0])?.error;
}

// ponytail: one row per key — the page's own pull while its job is not listed, else the key's latest pull job while it
// runs or after it failed (not before the page opened, not once let go); a pull that landed has no row
export function pullsOf(
  jobs: Job[],
  o: { project: string | null; mine: Mine[]; dismissed: Set<string>; since: number },
) {
  const listed = new Set(jobs.map((j) => j.id));
  const out = new Map<string, Pull>();
  const latest = [...jobs]
    .filter(
      (j) =>
        j.kind === "pull" && !o.dismissed.has(at(o.project, j.id)) && !(j.endedAt && Date.parse(j.endedAt) < o.since),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const j of latest) {
    const summary = view.summaries.get(at(o.project, j.subject)) ?? "";
    const error = failureOf(j);
    if (j.status === "running")
      out.set(j.subject, {
        key: j.subject,
        summary,
        jobId: j.id,
        startedAt: Date.parse(j.startedAt),
        ...(j.message ? { message: strip(j.subject, j.message) } : {}),
      });
    else if (error) out.set(j.subject, { key: j.subject, summary, jobId: j.id, error });
    else out.delete(j.subject);
  }
  for (const m of o.mine)
    if (m.dir === o.project && !(m.jobId && listed.has(m.jobId)))
      out.set(m.key, {
        key: m.key,
        summary: m.summary,
        startedAt: m.startedAt,
        ...(m.jobId ? { jobId: m.jobId } : {}),
        ...(m.error ? { error: m.error } : {}),
      });
  return [...out.values()];
}

export function usePulls(): Pull[] {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => view.version,
    () => view.version,
  );
  const jobs = useProjectJobs(view.mine.map((m) => m.jobId));
  return pullsOf(jobs, { project: project(), mine: view.mine, dismissed: view.dismissed, since: view.since });
}

// ponytail: where the pull of the open test is — the stages its job's progress carried (jobs.show, live)
export function usePullStage(jobId: string | undefined): Partial<Pull> {
  const shown = useRead("jobs.show", { id: jobId ?? "" }, { enabled: !!jobId });
  let out: Partial<Pull> = {};
  for (const e of shown.data?.events ?? [])
    if (e.type === "progress" && e.pull) out = { ...out, ...staged(e.pull as PullInfo) };
  return out;
}

export function watchPull(key: string): void {
  view.watched = key;
}

export function onPullLanded(fn: Lander): () => void {
  landers.add(fn);
  return () => {
    landers.delete(fn);
  };
}

export function startPull(key: string, summary: string): void {
  const dir = project();
  const was = mineOf(key, dir);
  if (was && !was.error) return;
  if (was) drop(was);
  const m: Mine = { key, dir, summary, startedAt: Date.now() };
  view.summaries.set(at(dir, key), summary);
  view.mine = [...view.mine, m];
  emit();
  const alive = () => view.mine.includes(m);
  run<PullResult>("xray.pull", { key }, undefined, (jobId) => {
    if (!alive()) {
      void cancelJob(jobId, dir);
      return;
    }
    m.jobId = jobId;
    emit();
  })
    .then(async (r) => {
      if (!alive()) return;
      const failed = r?.failed?.find((f) => f.key === key) ?? r?.failed?.[0];
      if (failed) throw new Error(failed.error);
      await Promise.all([...landers].map((fn) => fn(key, view.watched === key)));
      drop(m);
    })
    .catch((e) => {
      if (!alive()) return;
      if (view.watched === key) {
        m.error = message(e);
        emit();
        return;
      }
      errorToast(e, `Could not pull ${key}`);
      if (m.jobId) view.dismissed.add(at(dir, m.jobId));
      drop(m);
    });
}

// ponytail: Cancel and Back both abandon — the pane lets go at once, the core undoes its own writes
export function cancelPull(pull: Pick<Pull, "key" | "jobId" | "error">): void {
  const m = mineOf(pull.key);
  const jobId = pull.jobId ?? m?.jobId;
  if (jobId) view.dismissed.add(at(m?.dir ?? project(), jobId));
  if (m) drop(m);
  else emit();
  if (jobId && !pull.error) void cancelJob(jobId, m?.dir ?? project());
}

export function abandonPulls(keep: (dir: string | null) => boolean = () => false): void {
  for (const m of [...view.mine])
    if (!keep(m.dir)) {
      drop(m);
      if (m.jobId && !m.error) {
        view.dismissed.add(at(m.dir, m.jobId));
        void cancelJob(m.jobId, m.dir);
      }
    }
}
