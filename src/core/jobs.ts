import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./command.ts";
import { env } from "./env.ts";
import { changedPaths, stampProject } from "./lib/changed.ts";
import { withPerfScope } from "./lib/models-perf.ts";
import type { Job, JobEvent } from "./types.ts";

type Live = { job: Job; ctrl: AbortController; events: JobEvent[]; project: string | null; done: Promise<unknown> };

const live = new Map<string, Live>();
const listeners = new Set<(e: JobEvent) => void>();
const current = new AsyncLocalStorage<{ ctx: Ctx; job: Job }>();

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

export function startJob(
  kind: string,
  subject: string,
  project: string | null,
  work: (ctx: Ctx) => Promise<unknown>,
  outer?: AbortSignal,
): { job: Job; done: Promise<unknown> } {
  const id = `${kind.replace(/\W+/g, "-")}-${randomBytes(4).toString("hex")}`;
  const ctrl = new AbortController();
  outer?.addEventListener("abort", () => ctrl.abort(), { once: true });
  const job: Job = { id, kind, subject, status: "running", startedAt: env.now().toISOString(), pid: process.pid };
  const l: Live = { job, ctrl, events: [], project, done: Promise.resolve() };
  live.set(id, l);
  const at = () => env.now().toISOString();
  const ctx: Ctx = {
    project,
    signal: ctrl.signal,
    jobId: id,
    progress(p) {
      if (p.total !== undefined) job.progress = { done: p.done ?? 0, total: p.total };
      job.message = p.message;
      emit(l, { jobId: id, at: at(), type: "progress", message: p.message, done: p.done, total: p.total });
    },
    log(level, message) {
      emit(l, { jobId: id, at: at(), type: "log", level, message });
    },
    claude(event) {
      emit(l, { jobId: id, at: at(), type: "claude", event });
    },
  };
  emit(l, { jobId: id, at: at(), type: "status", job: { ...job } });
  const before = project ? stampProject(project) : null;
  l.done = (async () => {
    try {
      const result = await withPerfScope(
        { jobId: id, project: project ?? undefined },
        () => current.run({ ctx, job }, () => work(ctx)),
        ctrl.signal,
      );
      const said = (result as { cancelled?: unknown } | null)?.cancelled;
      job.status = (typeof said === "boolean" ? said : ctrl.signal.aborted) ? "cancelled" : "done";
      job.result = result;
      return result;
    } catch (e) {
      job.status = ctrl.signal.aborted ? "cancelled" : "failed";
      job.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      job.endedAt = at();
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
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled(running.map((l) => l.done)),
    new Promise<void>((r) => {
      timer = setTimeout(r, graceMs);
    }),
  ]);
  clearTimeout(timer);
  for (const l of running) {
    if (l.job.status !== "running") continue;
    l.job.status = "cancelled";
    l.job.error = "Stopped with Testimus.";
    l.job.endedAt = env.now().toISOString();
    emit(l, { jobId: l.job.id, at: l.job.endedAt, type: "status", job: { ...l.job } });
  }
  return running.map((l) => ({ ...l.job }));
}

function alive(pid?: number): boolean {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  for (const e of events) if (e.type === "status") job = e.job;
  if (!job) return null;
  if (job.status === "running" && !live.has(id) && !alive(job.pid))
    job = { ...job, status: "failed", error: "Interrupted (the app stopped)." };
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
