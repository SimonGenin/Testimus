import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isAlive } from "../shared/run/process.ts";
import { sleep } from "../shared/run/work.ts";
import { type Ctx, UserError } from "./command.ts";
import { env } from "./env.ts";
import { changedPaths, stampProject } from "./lib/changed.ts";
import { withPerfScope } from "./lib/models-perf.ts";
import type { Job, JobCause, JobEvent, JobProcess, JobStep } from "./types.ts";

type Live = { job: Job; ctrl: AbortController; events: JobEvent[]; project: string | null; done: Promise<unknown> };

const live = new Map<string, Live>();
const listeners = new Set<(e: JobEvent) => void>();
const current = new AsyncLocalStorage<{ ctx: Ctx; job: Job; live: Live; process?: string }>();

const runningStep = (job: Job): JobStep | undefined => job.steps?.find((s) => s.status === "running");

// ponytail: code deep under a job (the Jira/Xray client waiting out a 429) honours the job's cancel without being
// handed its context
export function jobSignal(): AbortSignal | undefined {
  return current.getStore()?.ctx.signal;
}

// ponytail: code deep under a job (the Jira/Xray client waiting out a 429) says so in the job's progress line
// without being handed the job's context; the returned function puts the previous line back if still ours
export function jobNotice(message: string): (() => void) | undefined {
  const c = current.getStore();
  if (!c) return undefined;
  const before = c.job.message ?? "";
  const bar = () => (c.job.progress ? { done: c.job.progress.done, total: c.job.progress.total } : {});
  c.ctx.progress({ message, ...bar() });
  return () => {
    if (c.job.status === "running" && c.job.message === message) c.ctx.progress({ message: before, ...bar() });
  };
}

// ponytail: the same line for work outside any job (a plain request waiting out a 429) — sent to every open page,
// and an empty message takes it down
export function notice(message: string): void {
  const e: JobEvent = { jobId: "", at: env.now().toISOString(), type: "notice", message };
  for (const fn of listeners) fn(e);
}

export function subscribe(fn: (e: JobEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ponytail: a job of no project (a model download, a models-folder move) logs under the machine's data folder
function jobsDir(project: string | null): string {
  return project ? join(project, ".testimus", "jobs") : join(env.localDir(), "jobs");
}

function logFile(project: string | null, id: string): string {
  return join(jobsDir(project), `${id}.jsonl`);
}

function emit(l: Live, e: JobEvent): void {
  l.events.push(e);
  if (l.events.length > 2000) l.events.splice(0, l.events.length - 2000);
  try {
    mkdirSync(jobsDir(l.project), { recursive: true });
    appendFileSync(logFile(l.project, l.job.id), `${JSON.stringify(e)}\n`);
  } catch {}
  for (const fn of listeners) fn(e);
}

function emitSteps(l: Live): void {
  emit(l, {
    jobId: l.job.id,
    at: env.now().toISOString(),
    type: "steps",
    steps: (l.job.steps ?? []).map((s) => ({ ...s })),
  });
}

function emitProcess(l: Live, p: JobProcess): void {
  emit(l, { jobId: l.job.id, at: env.now().toISOString(), type: "process", process: { ...p } });
}

// ponytail: a program a job starts (a Claude run, a model server) is recorded on the job with its pid and exit, and
// the Claude events it streams say which process they came from; outside a job fn just runs
export async function withProcess<T>(
  label: string,
  commandLine: string,
  fn: (pid: (n?: number) => void) => Promise<T>,
  exitOf: (r: T) => number | null,
): Promise<T> {
  const c = current.getStore();
  if (!c) return await fn(() => {});
  const l = c.live;
  const p: JobProcess = {
    id: `p${(l.job.processes?.length ?? 0) + 1}`,
    label,
    command: commandLine,
    startedAt: env.now().toISOString(),
    ...(runningStep(l.job) ? { step: runningStep(l.job)?.id } : {}),
  };
  l.job.processes = [...(l.job.processes ?? []), p];
  emitProcess(l, p);
  const end = (exit: number | null) => {
    p.endedAt = env.now().toISOString();
    p.exit = exit;
    emitProcess(l, p);
  };
  try {
    const r = await current.run({ ...c, process: p.id }, () =>
      fn((n) => {
        if (!n) return;
        p.pid = n;
        emitProcess(l, p);
      }),
    );
    end(exitOf(r));
    return r;
  } catch (e) {
    end(null);
    throw e;
  }
}

export function startJob(
  kind: string,
  subject: string,
  project: string | null,
  work: (ctx: Ctx) => Promise<unknown>,
  outer?: AbortSignal,
  extra: { cause?: JobCause; rerun?: { name: string; input: unknown } } = {},
): { job: Job; done: Promise<unknown> } {
  const id = `${kind.replace(/\W+/g, "-")}-${randomBytes(4).toString("hex")}`;
  const ctrl = new AbortController();
  outer?.addEventListener("abort", () => ctrl.abort(), { once: true });
  const parent = current.getStore();
  const job: Job = {
    id,
    kind,
    subject,
    status: "running",
    startedAt: env.now().toISOString(),
    pid: process.pid,
    ...(parent ? { parentId: parent.job.id } : {}),
    ...(extra.cause ? { cause: extra.cause } : {}),
    ...(extra.rerun ? { rerun: extra.rerun } : {}),
  };
  const l: Live = { job, ctrl, events: [], project, done: Promise.resolve() };
  live.set(id, l);
  // ponytail: a job started while its parent is in a step carries that step, so the step opens the child's row
  const carried = parent && runningStep(parent.job);
  if (parent && carried && !carried.jobId) {
    carried.jobId = id;
    emitSteps(parent.live);
  }
  const at = () => env.now().toISOString();
  const where = () => {
    const s = runningStep(job);
    return s ? { step: s.id } : {};
  };
  const ctx: Ctx = {
    project,
    signal: ctrl.signal,
    jobId: id,
    progress(p) {
      if (p.total !== undefined) job.progress = { done: p.done ?? 0, total: p.total };
      job.message = p.message;
      const s = runningStep(job);
      if (s) {
        s.message = p.message;
        if (p.total !== undefined) {
          s.done = p.done ?? 0;
          s.total = p.total;
        }
      }
      emit(l, {
        jobId: id,
        at: at(),
        type: "progress",
        message: p.message,
        done: p.done,
        total: p.total,
        ...(p.pull ? { pull: p.pull } : {}),
        ...where(),
      });
    },
    log(level, message) {
      emit(l, { jobId: id, at: at(), type: "log", level, message, ...where() });
    },
    claude(event) {
      const proc = current.getStore()?.process;
      emit(l, { jobId: id, at: at(), type: "claude", event, ...where(), ...(proc ? { process: proc } : {}) });
    },
    steps(list) {
      const known = new Map((job.steps ?? []).map((s) => [s.id, s]));
      job.steps = [
        ...list.map((x) => known.get(x.id) ?? { id: x.id, label: x.label, status: "waiting" as const }),
        ...[...known.values()].filter((s) => !list.some((x) => x.id === s.id)),
      ];
      emitSteps(l);
    },
    step(stepId, label) {
      const t = at();
      const cur = runningStep(job);
      if (cur?.id === stepId) return;
      if (cur) {
        cur.status = "done";
        cur.endedAt = t;
      }
      job.steps ??= [];
      let s = job.steps.find((x) => x.id === stepId);
      if (!s) {
        s = { id: stepId, label: label ?? stepId, status: "waiting" };
        job.steps.push(s);
      } else if (label) s.label = label;
      for (const x of job.steps.slice(0, job.steps.indexOf(s))) if (x.status === "waiting") x.status = "skipped";
      s.status = "running";
      s.startedAt = t;
      delete s.endedAt;
      emitSteps(l);
    },
  };
  emit(l, { jobId: id, at: at(), type: "status", job: { ...job } });
  const before = project ? stampProject(project) : null;
  l.done = (async () => {
    try {
      const result = await withPerfScope(
        { jobId: id, project: project ?? undefined },
        () => current.run({ ctx, job, live: l }, () => work(ctx)),
        ctrl.signal,
      );
      const said = (result as { cancelled?: unknown } | null)?.cancelled;
      job.status = (typeof said === "boolean" ? said : ctrl.signal.aborted) ? "cancelled" : "done";
      job.result = result;
      return result;
    } catch (e) {
      job.status = ctrl.signal.aborted ? "cancelled" : "failed";
      job.error = e instanceof Error ? e.message : String(e);
      if (e instanceof UserError && e.fix) job.fix = e.fix;
      throw e;
    } finally {
      job.endedAt = at();
      if (job.steps?.length) {
        const s = runningStep(job);
        if (s) {
          s.status = job.status === "done" ? "done" : job.status === "cancelled" ? "cancelled" : "failed";
          s.endedAt = job.endedAt;
        }
        if (job.status === "done") for (const x of job.steps) if (x.status === "waiting") x.status = "skipped";
        emitSteps(l);
      }
      // ponytail: a job says which project files it left changed (a Claude run, a pull, a conversion) before it
      // ends, so every view showing one of them reads it again — whoever started the job
      const paths = project && before ? changedPaths(before, stampProject(project)) : [];
      if (paths.length) emit(l, { jobId: id, at: at(), type: "changed", paths });
      emit(l, { jobId: id, at: at(), type: "status", job: { ...job } });
    }
  })();
  l.done.catch(() => {});
  return { job, done: l.done };
}

export function cancelJob(id: string, project?: string | null): boolean {
  const l = live.get(id);
  if (l?.job.status !== "running") return false;
  if (project !== undefined && l.project !== null && l.project !== project) return false;
  l.ctrl.abort();
  return true;
}

// ponytail: a job that ignores its signal past the grace is still logged cancelled — the process is about to exit
export async function cancelAll(graceMs: number): Promise<Job[]> {
  const running = [...live.values()].filter((l) => l.job.status === "running");
  for (const l of running) l.ctrl.abort();
  const grace = new AbortController();
  await Promise.race([Promise.allSettled(running.map((l) => l.done)), sleep(graceMs, grace.signal).catch(() => {})]);
  grace.abort();
  for (const l of running) {
    if (l.job.status !== "running") continue;
    l.job.status = "cancelled";
    l.job.interrupted = true;
    l.job.error = "Stopped with Testimus.";
    l.job.endedAt = env.now().toISOString();
    emit(l, { jobId: l.job.id, at: l.job.endedAt, type: "status", job: { ...l.job } });
  }
  return running.map((l) => ({ ...l.job }));
}

function alive(pid?: number): boolean {
  return !!pid && pid !== process.pid && isAlive(pid);
}

function fromDisk(project: string | null, id: string): { job: Job; events: JobEvent[] } | null {
  const file = logFile(project, id);
  if (!existsSync(file)) return null;
  const events: JobEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  let job: Job | null = null;
  for (const e of events) {
    if (e.type === "status") job = { ...e.job };
    else if (job && e.type === "steps") job.steps = e.steps;
    else if (job && e.type === "process")
      job.processes = [...(job.processes ?? []).filter((p) => p.id !== e.process.id), e.process];
  }
  if (!job) return null;
  if (job.status === "running" && !live.has(id) && !alive(job.pid))
    job = {
      ...job,
      status: "failed",
      interrupted: true,
      error: "Interrupted (the app stopped).",
      steps: job.steps?.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)),
    };
  return { job, events };
}

export function listJobs(project: string | null): Job[] {
  const out = new Map<string, Job>();
  if (project) {
    const dir = join(project, ".testimus", "jobs");
    if (existsSync(dir))
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const d = fromDisk(project, f.slice(0, -6));
        if (d) out.set(d.job.id, d.job);
      }
  }
  for (const l of live.values()) if (l.project === project || l.project === null) out.set(l.job.id, { ...l.job });
  return [...out.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ponytail: clearing forgets finished jobs — their logs go, a running job and its log are never touched
export function clearJobs(project: string | null, ids?: string[]): number {
  let n = 0;
  for (const j of listJobs(project)) {
    if (j.status === "running" || (ids && !ids.includes(j.id))) continue;
    const owner = live.get(j.id)?.project ?? project;
    for (const dir of new Set([owner, project]))
      if (existsSync(logFile(dir, j.id))) rmSync(logFile(dir, j.id), { force: true });
    live.delete(j.id);
    n++;
  }
  return n;
}

export function runsIn(project: string): boolean {
  return [...live.values()].some((l) => l.job.status === "running" && !!l.project && resolve(l.project) === project);
}

export function showJob(project: string | null, id: string): { job: Job; events: JobEvent[] } | null {
  if (!/^[\w.-]+$/.test(id)) return null;
  const l = live.get(id);
  if (l) return l.project === project || l.project === null ? { job: { ...l.job }, events: [...l.events] } : null;
  return fromDisk(project, id) ?? (project ? fromDisk(null, id) : null);
}

export function waitJob(id: string): Promise<unknown> {
  const l = live.get(id);
  return l ? l.done : Promise.resolve(undefined);
}
