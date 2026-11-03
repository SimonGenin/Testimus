import { useSyncExternalStore } from "react";
import type { PullInfo, PullStage } from "../../../core/types.ts";
import { call, project, run } from "../../api.ts";
import { message } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";

export type PullRead = Extract<PullStage, { phase: "read" }>;
export type Pull = {
  key: string;
  summary: string;
  message?: string;
  error?: string;
  startedAt?: number;
  phase?: PullStage["phase"];
  read?: PullRead;
  images?: { done: number; total: number };
};

type PullResult = { pulled?: string[]; failed?: { key: string; error: string }[] };
type Entry = { seq: number; dir: string | null; jobId?: string; dead: boolean; failed: boolean };
type Lander = (key: string, watched: boolean) => void | Promise<void>;

// ponytail: the queue outlives the Tests screen (a pull keeps going while the user reads a document),
// so it is a module store like the toasts; the pane follows the one key the screen says it is watching
let items: Pull[] = [];
let watched = "";
let seq = 0;
const live = new Map<string, Entry>();
const listeners = new Set<() => void>();
const landers = new Set<Lander>();

const emit = () => {
  for (const l of listeners) l();
};

const set = (next: Pull[]) => {
  items = next;
  emit();
};

const patch = (key: string, n: number, p: Partial<Pull>) => {
  if (live.get(key)?.seq !== n) return;
  set(items.map((x) => (x.key === key ? { ...x, ...p } : x)));
};

const staged = (p: PullInfo | undefined): Partial<Pull> => {
  if (!p) return {};
  if (p.phase === "read") return { phase: p.phase, read: p };
  if (p.phase === "images") return { phase: p.phase, images: { done: p.done, total: p.total } };
  return { phase: p.phase };
};

const forget = (key: string, n: number) => {
  if (live.get(key)?.seq !== n) return;
  live.delete(key);
  set(items.filter((x) => x.key !== key));
};

// ponytail: a job belongs to the project it was started in, and after a switch api.call would name the
// new one — the core refuses to cancel another project's job, so the call names the job's own project
async function cancelJob(id: string, dir: string | null): Promise<void> {
  await call("jobs.cancel", { id }, { project: dir }).catch(() => {});
}

export function watchPull(key: string): void {
  watched = key;
}

export function onPullLanded(fn: Lander): () => void {
  landers.add(fn);
  return () => {
    landers.delete(fn);
  };
}

export const isPulling = (key: string) => {
  const e = live.get(key);
  return !!e && !e.dead && !e.failed;
};

export function startPull(key: string, summary: string): void {
  if (isPulling(key)) return;
  const n = ++seq;
  const entry: Entry = { seq: n, dir: project(), dead: false, failed: false };
  live.set(key, entry);
  set([...items.filter((x) => x.key !== key), { key, summary, startedAt: Date.now() }]);
  const strip = (m: string) => (m.startsWith(`${key}: `) ? m.slice(key.length + 2) : m);
  run<PullResult>(
    "xray.pull",
    { key },
    (e) => {
      if (e.type === "progress" && !entry.dead) patch(key, n, { message: strip(e.message), ...staged(e.pull) });
    },
    (jobId) => {
      entry.jobId = jobId;
      if (entry.dead) void cancelJob(jobId, entry.dir);
    },
  )
    .then(async (r) => {
      if (entry.dead) return;
      const failed = r?.failed?.find((f) => f.key === key) ?? r?.failed?.[0];
      if (failed) throw new Error(failed.error);
      await Promise.all([...landers].map((fn) => fn(key, watched === key)));
      forget(key, n);
    })
    .catch((e) => {
      if (entry.dead) return;
      if (watched === key) {
        entry.failed = true;
        patch(key, n, { error: message(e) });
      } else {
        errorToast(e, `Could not pull ${key}`);
        forget(key, n);
      }
    });
}

// ponytail: Cancel and Back both abandon — the pane lets go at once, the core undoes its own writes
export function cancelPull(key: string): void {
  const e = live.get(key);
  if (!e) return;
  e.dead = true;
  if (e.jobId && !e.failed) void cancelJob(e.jobId, e.dir);
  live.delete(key);
  set(items.filter((x) => x.key !== key));
}

export function abandonPulls(keep: (dir: string | null) => boolean = () => false): void {
  for (const [key, e] of live) if (!keep(e.dir)) cancelPull(key);
}

export function usePulls(): Pull[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => items,
    () => items,
  );
}
