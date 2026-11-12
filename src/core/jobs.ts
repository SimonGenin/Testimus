import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { isAlive } from "../shared/run/process.ts";
import { debounce, every, sleep } from "../shared/run/work.ts";
import { readActivity } from "./claude/activity.ts";
import { type Ctx, type Progress, UserError } from "./command.ts";
import { env } from "./env.ts";
import { type Changes, recordChanges } from "./lib/changed.ts";
import { fileMemo } from "./lib/file-memo.ts";
import { withPerfScope } from "./lib/models-perf.ts";
import type { Job, JobCause, JobEvent, JobProcess, JobStep } from "./types.ts";

type Line = Extract<JobEvent, { type: "progress" }>;
type Gate = {
  sig: string;
  gen: string;
  at: number;
  pending: Line | null;
  tick: { push(v: number): void; cancel(): void };
};

type Live = {
  job: Job;
  ctrl: AbortController;
  events: JobEvent[];
  project: string | null;
  done: Promise<unknown>;
  ended: boolean;
  // ponytail: when it last gave a sign (any event, a progress line not written included), the progress gate, and the
  // folders and files it says are its own (its subject's, what its Claude runs wrote, its children's)
  lastAt: number;
  gate: Gate;
  owns: Set<string>;
  say: (p: Progress, now: boolean) => void;
};

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
  c.live.say({ message, ...bar() }, true);
  return () => {
    if (c.job.status === "running" && c.job.message === message) c.live.say({ message: before, ...bar() }, true);
  };
}

// ponytail: the work names its job once it knows what it is about (an index run: how many documents) — only a job of
// that kind, so work called from inside another job never renames it
export function nameJob(kind: string, label: string): void {
  const c = current.getStore();
  if (!c || c.job.kind !== kind || c.job.label === label) return;
  c.job.label = label;
  emit(c.live, { jobId: c.job.id, at: env.now().toISOString(), type: "status", job: { ...c.job } });
}

// ponytail: the files and folders (project-relative) the work of a job writes — a Claude run's tests, the index —
// so the job's `changed` keeps them and leaves out what other jobs wrote meanwhile; with a kind, only a job of that kind
export function jobWrote(paths: string[], kind?: string): void {
  const l = current.getStore()?.live;
  if (!l || (kind && l.job.kind !== kind)) return;
  for (const p of paths) l.owns.add(p.replace(/\\/g, "/").replace(/\/+$/, ""));
}

// ponytail: the same line for work outside any job (a plain request waiting out a 429) — sent to every open page,
// and an empty message takes it down
export function notice(message: string): void {
  const e: JobEvent = { jobId: "", at: env.now().toISOString(), type: "notice", message, project: null };
  for (const fn of listeners) fn(e);
}

// ponytail: files of a project changed outside any job (an edit, a save, Claude Code in a terminal, a sync) — the
// pages re-read what they show from those paths
export function filesChanged(project: string, paths: string[]): void {
  const e: JobEvent = { jobId: "", at: env.now().toISOString(), type: "changed", paths, project };
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

const made = new Set<string>();

const KEEP_DAYS = 30;
const pruned = new Set<string>();

// ponytail: a finished job's log is kept 30 days, then goes — looked at once per folder and process, at its first job;
// a finished log never moves again, so its last write is when the job ended
function prune(project: string | null): void {
  const dir = jobsDir(project);
  if (pruned.has(dir)) return;
  pruned.add(dir);
  const before = env.now().getTime() - KEEP_DAYS * 86_400_000;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl") || live.has(f.slice(0, -6))) continue;
      const file = join(dir, f);
      if (statSync(file).mtimeMs < before) rmSync(file, { force: true });
    }
  } catch {}
}

// ponytail: what a job is about, by the folder of a test or a document — files of it the job changed, or its id given
const folderOf = (path: string) => /^(tests|docs)\/[^/]+(?=\/)/.exec(path.replace(/\\/g, "/"))?.[0];

export function isAbout(job: Job, folder: string): boolean {
  return !!job.touched?.includes(folder) || folder.slice(folder.indexOf("/") + 1) === job.subject;
}

// ponytail: a job's file keeps at most 200 changed paths — a folder import's thousands are said by their count and
// the folders they are in (the page got them all live)
const KEEP_PATHS = 200;

function stored(e: JobEvent): JobEvent {
  if (e.type !== "changed" || e.paths.length <= KEEP_PATHS) return e;
  const n = new Map<string, number>();
  for (const p of e.paths) {
    const f = folderOf(p) ?? (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : p);
    n.set(f, (n.get(f) ?? 0) + 1);
  }
  const folders = [...n].map(([path, files]) => ({ path, files }));
  return { jobId: e.jobId, at: e.at, type: "changed", paths: [], count: e.paths.length, folders, project: e.project };
}

type Out = { file?: boolean; push?: boolean };

function append(l: Live, e: JobEvent): void {
  // ponytail: the folder is made once, not at every line of a long run — and again if it went away meanwhile
  const dir = jobsDir(l.project);
  const line = `${JSON.stringify(e)}\n`;
  for (const fresh of [made.has(dir), false])
    try {
      if (!fresh) mkdirSync(dir, { recursive: true });
      appendFileSync(logFile(l.project, l.job.id), line);
      made.add(dir);
      break;
    } catch {
      made.delete(dir);
    }
}

function write(l: Live, e: JobEvent, o: Out = {}): void {
  e.project = l.project;
  l.lastAt = env.now().getTime();
  l.events.push(e);
  if (l.events.length > 2000) l.events.splice(0, l.events.length - 2000);
  if (o.file !== false) append(l, stored(e));
  if (o.push !== false) for (const fn of listeners) fn(e);
}

// ponytail: a progress line held back by the gate goes out before anything else the job says, so the log keeps its order
function flush(l: Live): void {
  const e = l.gate.pending;
  if (!e) return;
  l.gate.pending = null;
  said(l.gate, e);
  write(l, e);
}

function said(g: Gate, e: Line): void {
  g.sig = sigOf(e);
  g.at = env.now().getTime();
  if (e.gen) g.gen = JSON.stringify(e.gen);
}

function emit(l: Live, e: JobEvent, o?: Out): void {
  flush(l);
  write(l, e, o);
}

// ponytail: a progress line is written and sent only when it says something new (the line, the counts, a pull's or a
// generation's state), and at most once a second per job — a video's conversion said the same thing 648 times in 5
// min. One held back goes out a second later at most, or before the job's next event (a step's end, its last status);
// back to what was last written, the one held is dropped. Never held: a check's verdict about one test, a generation's
// board that moved (a few lines per test written), a notice (a 429's wait); a pull's state held is carried by the next
const PROGRESS_MS = 1000;
const sigOf = (e: Line) => JSON.stringify([e.message, e.done, e.total, e.pull, e.gen, e.step]);

function progressed(l: Live, e: Line, now: boolean): void {
  const g = l.gate;
  const t = env.now().getTime();
  l.lastAt = t;
  if (g.pending?.pull && !e.pull) e.pull = g.pending.pull;
  const sig = sigOf(e);
  if (now || e.test || (e.gen && JSON.stringify(e.gen) !== g.gen)) {
    flush(l);
    said(g, e);
    write(l, e);
    return;
  }
  if (sig === g.sig) {
    g.pending = null;
    return;
  }
  if (g.pending && sig === sigOf(g.pending)) return;
  if (!g.pending && t - g.at >= PROGRESS_MS) {
    said(g, e);
    write(l, e);
    return;
  }
  g.pending = e;
  g.tick.push(0);
}

const NO_TICK = { push() {}, cancel() {} };

function emitSteps(l: Live): void {
  emit(l, {
    jobId: l.job.id,
    at: env.now().toISOString(),
    type: "steps",
    steps: (l.job.steps ?? []).map((s) => ({ ...s })),
  });
}

// ponytail: once declared, a job's steps move one at a time — only the one that changed is written
function emitStep(l: Live, s: JobStep): void {
  emit(l, { jobId: l.job.id, at: env.now().toISOString(), type: "step", step: { ...s } });
}

function emitProcess(l: Live, p: JobProcess): void {
  emit(l, { jobId: l.job.id, at: env.now().toISOString(), type: "process", process: { ...p } });
}

// ponytail: a program a job runs is looked at every 5 s while it runs — alive by its pid, it is « seen » then. A core
// held still for hours (a long synchronous read, the PC asleep) hears of a program's end only when it wakes: that end
// is put at the last time it was seen alive, not at the wake (3 h 30 runs « exit 0 » on 2026-11-10 were 2 min ones)
const LOOK_MS = 5000;
const HELD_MS = 3 * LOOK_MS;
const open = new Map<JobProcess, number>();
let stopLooking: (() => void) | null = null;

export function lookAtProcesses(): void {
  const t = env.now().getTime();
  for (const p of open.keys()) if (p.pid && isAlive(p.pid)) open.set(p, t);
  if (!open.size && stopLooking) {
    stopLooking();
    stopLooking = null;
  }
}

function endOf(p: JobProcess): string {
  const t = env.now().getTime();
  const seen = open.get(p) ?? Date.parse(p.startedAt);
  return new Date(t - seen > HELD_MS ? seen : t).toISOString();
}

// ponytail: a program a job starts (a Claude run, ffmpeg, whisper, a model server) is recorded on the job with its pid
// and exit, and the Claude events it streams say which process they came from; outside a job fn just runs. `more`
// adds to the record at its start and at its end (a Claude run's summary)
export async function withProcess<T>(
  label: string,
  commandLine: string,
  fn: (pid: (n?: number) => void) => Promise<T>,
  exitOf: (r: T) => number | null,
  more: { start?: Partial<JobProcess>; end?: (r: T) => Partial<JobProcess> } = {},
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
    ...more.start,
  };
  l.job.processes = [...(l.job.processes ?? []), p];
  open.set(p, env.now().getTime());
  stopLooking ??= every(LOOK_MS, lookAtProcesses);
  emitProcess(l, p);
  const end = (exit: number | null) => {
    p.endedAt = endOf(p);
    p.exit = exit;
    open.delete(p);
    emitProcess(l, p);
  };
  try {
    const r = await current.run({ ...c, process: p.id }, () =>
      fn((n) => {
        if (!n) return;
        p.pid = n;
        emit(l, { jobId: l.job.id, at: env.now().toISOString(), type: "process", process: { ...p } }, { file: false });
      }),
    );
    try {
      Object.assign(p, more.end?.(r));
    } catch {}
    end(exitOf(r));
    return r;
  } catch (e) {
    end(null);
    throw e;
  }
}

// ponytail: what a job's `changed` keeps — the files under the folders it owns (its subject's document or test, what
// its Claude runs wrote, its children's, the index); a job that owns none (a pull, a check of several tests) keeps all
// but what another job running meanwhile owns. Concurrent jobs no longer each get the other's thousands of files
function ancestors(l: Live): Set<string> {
  const out = new Set<string>();
  for (let p = l.job.parentId; p && !out.has(p); p = live.get(p)?.job.parentId) out.add(p);
  return out;
}

const SUBJECT_ID = /^\w[\w.-]*$/;

function ownSubject(l: Live, paths: string[] = []): void {
  const s = l.job.subject;
  if (!l.project || !SUBJECT_ID.test(s)) return;
  for (const f of [`docs/${s}`, `tests/${s}`])
    if (paths.some((p) => p.startsWith(`${f}/`)) || existsSync(join(l.project, f))) l.owns.add(f);
}

const ownedBy = (owns: Set<string>) => (p: string) =>
  owns.has(p) || owns.has(folderOf(p) ?? "") || owns.has(p.split("/")[0]);

function othersOwn(l: Live): Set<string> {
  const mine = ancestors(l);
  const end = l.job.endedAt ?? env.now().toISOString();
  const out = new Set<string>();
  for (const o of live.values()) {
    if (o === l || o.project !== l.project || mine.has(o.job.id) || ancestors(o).has(l.job.id)) continue;
    if (o.job.startedAt > end || (o.job.endedAt && o.job.endedAt < l.job.startedAt)) continue;
    for (const f of o.owns) out.add(f);
  }
  return out;
}

function scoped(l: Live, moved: Changes): Changes {
  ownSubject(l, moved.paths);
  const others = l.owns.size ? null : ownedBy(othersOwn(l));
  const mine = ownedBy(l.owns);
  const keep = (p: string) => (others ? !others(p) : mine(p));
  return { paths: moved.paths.filter(keep), added: moved.added.filter(keep), removed: moved.removed.filter(keep) };
}

export function startJob(
  kind: string,
  subject: string,
  project: string | null,
  work: (ctx: Ctx) => Promise<unknown>,
  outer?: AbortSignal,
  extra: { cause?: JobCause; rerun?: { name: string; input: unknown }; label?: string } = {},
): { job: Job; done: Promise<unknown> } {
  prune(project);
  const id = `${kind.replace(/\W+/g, "-")}-${randomBytes(4).toString("hex")}`;
  const ctrl = new AbortController();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener("abort", () => ctrl.abort(), { once: true });
  const parent = current.getStore();
  const job: Job = {
    id,
    kind,
    subject,
    ...(extra.label ? { label: extra.label } : {}),
    status: "running",
    startedAt: env.now().toISOString(),
    pid: process.pid,
    ...(parent ? { parentId: parent.job.id } : {}),
    ...(extra.cause ? { cause: extra.cause } : {}),
    ...(extra.rerun ? { rerun: extra.rerun } : {}),
  };
  const l: Live = {
    job,
    ctrl,
    events: [],
    project,
    done: Promise.resolve(),
    ended: false,
    lastAt: env.now().getTime(),
    gate: { sig: "", gen: "", at: Number.NEGATIVE_INFINITY, pending: null, tick: NO_TICK },
    owns: new Set(),
    say: () => {},
  };
  l.gate.tick = debounce(PROGRESS_MS, () => flush(l), PROGRESS_MS);
  ownSubject(l);
  live.set(id, l);
  // ponytail: a job started while its parent is in a step carries that step, so the step opens the child's row
  const carried = parent && runningStep(parent.job);
  if (parent && carried && !carried.jobId) {
    carried.jobId = id;
    emitStep(parent.live, carried);
  }
  const at = () => env.now().toISOString();
  const where = () => {
    const s = runningStep(job);
    return s ? { step: s.id } : {};
  };
  l.say = (p, now) => {
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
    progressed(
      l,
      {
        jobId: id,
        at: at(),
        type: "progress",
        message: p.message,
        done: p.done,
        total: p.total,
        ...(p.pull ? { pull: p.pull } : {}),
        ...(p.test ? { test: p.test } : {}),
        ...(p.gen ? { gen: p.gen } : {}),
        ...where(),
      },
      now,
    );
  };
  const ctx: Ctx = {
    project,
    signal: ctrl.signal,
    jobId: id,
    progress: (p) => l.say(p, false),
    log(level, message) {
      emit(l, { jobId: id, at: at(), type: "log", level, message, ...where() });
    },
    // ponytail: Claude's words and tool calls go live to the page and stay in memory for jobs.show — not in the job's
    // file: their record is the run's own (.testimus/runs/<run>/activity.jsonl), the file keeps the run's summary
    claude(event) {
      const proc = current.getStore()?.process;
      emit(
        l,
        { jobId: id, at: at(), type: "claude", event, ...where(), ...(proc ? { process: proc } : {}) },
        { file: false },
      );
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
      const moved: JobStep[] = [];
      if (cur) {
        cur.status = "done";
        cur.endedAt = t;
        moved.push(cur);
      }
      job.steps ??= [];
      let s = job.steps.find((x) => x.id === stepId);
      if (!s) {
        s = { id: stepId, label: label ?? stepId, status: "waiting" };
        job.steps.push(s);
      } else if (label) s.label = label;
      for (const x of job.steps.slice(0, job.steps.indexOf(s)))
        if (x.status === "waiting") {
          x.status = "skipped";
          moved.push(x);
        }
      s.status = "running";
      s.startedAt = t;
      delete s.endedAt;
      moved.push(s);
      for (const x of moved) emitStep(l, x);
    },
  };
  emit(l, { jobId: id, at: at(), type: "status", job: { ...job } });
  const changes = project ? recordChanges(project, id) : null;
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
      if (e instanceof UserError && e.code) job.code = e.code;
      throw e;
    } finally {
      l.gate.tick.cancel();
      job.endedAt = at();
      if (job.steps?.length) {
        const moved: JobStep[] = [];
        const s = runningStep(job);
        if (s) {
          s.status = job.status === "done" ? "done" : job.status === "cancelled" ? "cancelled" : "failed";
          s.endedAt = job.endedAt;
          moved.push(s);
        }
        if (job.status === "done")
          for (const x of job.steps)
            if (x.status === "waiting") {
              x.status = "skipped";
              moved.push(x);
            }
        for (const x of moved) emitStep(l, x);
      }
      // ponytail: a job says which of its files it left changed (a Claude run, a pull, a conversion) before it ends,
      // so every view showing one of them reads it again — whoever started the job. A job inside a batch (a conversion
      // of a folder import) hands its folders to its parent and keeps its paths to its own file: the parent sends
      // them all once, at its end
      const moved = changes ? await changes() : null;
      const mine = moved ? scoped(l, moved) : null;
      const up = job.parentId ? live.get(job.parentId) : undefined;
      const handed = up?.job.status === "running";
      if (up && handed) for (const f of l.owns) up.owns.add(f);
      if (mine?.paths.length) {
        const touched = [...new Set(mine.paths.map(folderOf).filter((f) => f !== undefined))];
        if (touched.length) job.touched = touched;
        emit(l, { jobId: id, at: at(), type: "changed", ...mine }, { push: !handed });
      }
      emit(l, { jobId: id, at: at(), type: "status", job: { ...job } });
      l.ended = true;
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

// ponytail: a job that ignores its signal past the grace is still logged cancelled — the process is about to exit; one
// already stopped but still saying what it changed (its last status not written) is waited for the same way
export async function cancelAll(graceMs: number): Promise<Job[]> {
  const running = [...live.values()].filter((l) => l.job.status === "running" || !l.ended);
  for (const l of running) if (l.job.status === "running") l.ctrl.abort();
  const grace = new AbortController();
  await Promise.race([Promise.allSettled(running.map((l) => l.done)), sleep(graceMs, grace.signal).catch(() => {})]);
  grace.abort();
  for (const l of running) {
    if (l.ended) continue;
    l.ended = true;
    l.gate.tick.cancel();
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

// ponytail: a running job says when it last gave a sign — its own or a running child's — and is « stuck » after 10 min
// of silence with no program of its alive, unless it waits its turn (a conversion queued behind the others). Worked
// out when read: the core keeps no timer for it
const STUCK_MS = 10 * 60_000;

const waits = (job: Job) => runningStep(job)?.id === "queue" || /^Waiting\b/.test(job.message ?? "");
const busy = (job: Job) => (job.processes ?? []).some((p) => !p.endedAt && (!p.pid || isAlive(p.pid)));

function signed(job: Job, last: number): Job {
  if (job.status !== "running") return job;
  const out: Job = { ...job, lastEventAt: new Date(last).toISOString() };
  if (env.now().getTime() - last > STUCK_MS && !busy(job) && !waits(job)) out.stuck = true;
  return out;
}

function lastSign(l: Live, seen = new Set<string>()): number {
  seen.add(l.job.id);
  let t = l.lastAt;
  for (const c of live.values())
    if (c.job.parentId === l.job.id && c.job.status === "running" && !seen.has(c.job.id))
      t = Math.max(t, lastSign(c, seen));
  return t;
}

const shownLive = (l: Live): Job => signed({ ...l.job }, lastSign(l));

function readLog(file: string): JobEvent[] {
  const events: JobEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events;
}

// ponytail: a job as its log last said it — its status, steps and programs; the other lines (the progress, the logs)
// say nothing of it, so they are not parsed
const SAYS_JOB = /"type":"(status|steps?|process)"/;

function jobOf(events: Iterable<JobEvent>): Job | null {
  let job: Job | null = null;
  for (const e of events) {
    if (e.type === "status") job = { ...e.job };
    else if (job && e.type === "steps") job.steps = e.steps;
    else if (job && e.type === "step") {
      const steps = job.steps ?? [];
      job.steps = steps.some((s) => s.id === e.step.id)
        ? steps.map((s) => (s.id === e.step.id ? e.step : s))
        : [...steps, e.step];
    } else if (job && e.type === "process")
      job.processes = [...(job.processes ?? []).filter((p) => p.id !== e.process.id), e.process];
  }
  return job;
}

function summaryLines(lines: string[]): JobEvent[] {
  const out: JobEvent[] = [];
  for (const line of lines) {
    if (!SAYS_JOB.test(line)) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

const TAIL = 64 * 1024;

// ponytail: a job's summary is its last status line and the steps and processes after it — read from the end of the
// log, a few KB growing until a status line is whole in it, not the whole log (a long run's is 750 KB; 120 of them
// took 0.9 s to read at the first jobs list of a big project)
function summaryOf(file: string): Job | null {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    for (let want = TAIL; ; want *= 4) {
      const start = Math.max(0, size - want);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString("utf8").split("\n");
      const events = summaryLines(start > 0 ? lines.slice(1) : lines);
      const last = events.findLastIndex((e) => e.type === "status");
      if (last >= 0 || start === 0) return jobOf(events.slice(Math.max(0, last)));
    }
  } finally {
    closeSync(fd);
  }
}

const summaries = fileMemo<Job | null>();

// ponytail: a job left « running » by a Testimus that is gone was interrupted; one another Testimus still runs gave its
// last sign when its log was last written
function settled(id: string, job: Job, file: string): Job {
  if (job.status !== "running" || live.has(id)) return job;
  if (alive(job.pid)) {
    let at = Date.parse(job.startedAt);
    try {
      at = statSync(file).mtimeMs;
    } catch {}
    return signed(job, at);
  }
  return {
    ...job,
    status: "failed",
    interrupted: true,
    error: "Interrupted (the app stopped).",
    steps: job.steps?.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)),
  };
}

function fromDisk(project: string | null, id: string): { job: Job; events: JobEvent[] } | null {
  const file = logFile(project, id);
  if (!existsSync(file)) return null;
  const events = readLog(file);
  const job = jobOf(events);
  return job ? { job: settled(id, job, file), events } : null;
}

// ponytail: the list reads each log once per version of it (a finished job's log never moves again)
function summaryFromDisk(project: string | null, id: string): Job | null {
  const file = logFile(project, id);
  const job = summaries(file, [file], () => (existsSync(file) ? summaryOf(file) : null));
  return job ? settled(id, job, file) : null;
}

export function listJobs(project: string | null): Job[] {
  const out = new Map<string, Job>();
  if (project) {
    const dir = join(project, ".testimus", "jobs");
    if (existsSync(dir))
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const j = summaryFromDisk(project, f.slice(0, -6));
        if (j) out.set(j.id, { ...j });
      }
  }
  for (const l of live.values()) if (l.project === project || l.project === null) out.set(l.job.id, shownLive(l));
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

// ponytail: the jobs of a kind running on a project — what work that must not overlap them waits for
export function runningOf(project: string, kind: string): Promise<unknown>[] {
  const here = resolve(project);
  return [...live.values()]
    .filter((l) => l.job.status === "running" && l.job.kind === kind && !!l.project && resolve(l.project) === here)
    .map((l) => l.done);
}

// ponytail: a job started from here is nobody's child — work a batch asks for once (the overview after an import)
// would otherwise hang under whichever conversion asked first
export function outsideJobs<T>(fn: () => T): T {
  return current.exit(fn);
}

export function runsIn(project: string): boolean {
  return [...live.values()].some((l) => l.job.status === "running" && !!l.project && resolve(l.project) === project);
}

export function showJob(project: string | null, id: string): { job: Job; events: JobEvent[] } | null {
  if (!/^[\w.-]+$/.test(id)) return null;
  const l = live.get(id);
  if (l) return l.project === project || l.project === null ? { job: shownLive(l), events: [...l.events] } : null;
  return fromDisk(project, id) ?? (project ? fromDisk(null, id) : null);
}

// ponytail: what Claude said and did in a job's runs (or one of them, by its process id) — from memory while the run
// goes, from the run's own folder once it ended: the job's file holds only each run's summary
export function jobActivity(project: string | null, id: string, process?: string): JobEvent[] | null {
  const shown = showJob(project, id);
  if (!shown) return null;
  const out: JobEvent[] = [];
  for (const p of shown.job.processes ?? []) {
    if (process && p.id !== process) continue;
    const kept = p.endedAt && p.run && project ? readActivity(project, p.run.id) : [];
    if (!kept.length) {
      out.push(...shown.events.filter((e) => e.type === "claude" && e.process === p.id));
      continue;
    }
    for (const s of kept)
      out.push({
        jobId: id,
        at: s.at,
        type: "claude",
        event: s.event,
        process: p.id,
        ...(p.step ? { step: p.step } : {}),
        project,
      });
  }
  return out;
}

export function waitJob(id: string): Promise<unknown> {
  const l = live.get(id);
  return l ? l.done : Promise.resolve(undefined);
}
