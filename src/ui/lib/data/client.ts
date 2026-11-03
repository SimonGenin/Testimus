import type { Job, JobCause, JobEvent } from "../../../core/types.ts";

export class ApiError extends Error {
  readonly fix?: string;
  readonly status: number;
  readonly code?: string;
  // ponytail: a cancelled job can still have done work (a Claude run edits files as it goes) — its result rides here
  cancelled?: boolean;
  result?: unknown;
  constructor(message: string, fix?: string, status = 0, code?: string) {
    super(message);
    this.fix = fix;
    this.status = status;
    this.code = code;
  }
}

export type CommandInfo = { name: string; summary: string; mutates: boolean; job: boolean; input: JsonSchema };
export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  default?: unknown;
  anyOf?: JsonSchema[];
};
export type ApiInfo = { project: string | null; mock: boolean; commands: CommandInfo[] };

let current: string | null = null;

export function setProject(dir: string | null): void {
  current = dir;
}

export function project(): string | null {
  return current;
}

function headers(project: string | null = current): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (project) h["X-Testimus-Project"] = encodeURIComponent(project);
  return h;
}

async function read(res: Response): Promise<unknown> {
  const text = await res.text();
  let value: unknown = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = { error: text };
  }
  if (!res.ok) {
    const e = (value ?? {}) as { error?: string; fix?: string; code?: string };
    throw new ApiError(e.error || `HTTP ${res.status}`, e.fix, res.status, e.code);
  }
  return value;
}

export type CallOptions = { signal?: AbortSignal; cause?: JobCause; project?: string | null };

// ponytail: cause ties the job a call starts to the one it follows (a re-index after a conversion, a retry); project
// sends the call to a project other than the page's (a pull cancelled after the page moved on)
export async function call<T = unknown>(
  name: string,
  input: unknown = {},
  options?: AbortSignal | CallOptions,
  cause?: JobCause,
): Promise<T> {
  const o: CallOptions = options instanceof AbortSignal ? { signal: options, cause } : { cause, ...options };
  const [group, verb] = name.split(".");
  const h = headers(o.project === undefined ? current : o.project);
  const res = await fetch(`/api/${group}/${verb}`, {
    method: "POST",
    headers: o.cause ? { ...h, "X-Testimus-Cause": `${o.cause.why} ${o.cause.jobId}` } : h,
    body: JSON.stringify(input ?? {}),
    signal: o.signal,
  });
  return (await read(res)) as T;
}

export async function commands(): Promise<ApiInfo> {
  return (await read(await fetch("/api", { headers: headers() }))) as ApiInfo;
}

export function fileUrl(relPath: string): string {
  const path = relPath.split("/").map(encodeURIComponent).join("/");
  return `/files/${path}${current ? `?project=${encodeURIComponent(current)}` : ""}`;
}

const listeners = new Set<(e: JobEvent) => void>();
const streamListeners = new Set<(up: boolean) => void>();
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

// ponytail: told when the event stream opens (again) or drops — the data layer re-reads what it shows on a reopen and
// says the server is unreachable on a drop
export function onStream(fn: (up: boolean) => void): () => void {
  streamListeners.add(fn);
  return () => streamListeners.delete(fn);
}

function connect(): void {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.onopen = () => {
    for (const fn of streamListeners) fn(true);
  };
  source.onmessage = (m) => {
    let e: JobEvent;
    try {
      e = JSON.parse(m.data) as JobEvent;
    } catch {
      return;
    }
    for (const fn of listeners) fn(e);
  };
  source.onerror = () => {
    for (const fn of streamListeners) fn(false);
    source?.close();
    source = null;
    clearTimeout(retry);
    if (listeners.size) retry = setTimeout(connect, 2000);
  };
}

export function events(onEvent: (e: JobEvent) => void): () => void {
  listeners.add(onEvent);
  connect();
  return () => {
    listeners.delete(onEvent);
    if (!listeners.size) {
      clearTimeout(retry);
      source?.close();
      source = null;
    }
  };
}

const isJobRef = (v: unknown): v is { jobId: string } =>
  !!v && typeof v === "object" && typeof (v as { jobId?: unknown }).jobId === "string";

export function waitJob<T = unknown>(jobId: string, onEvent?: (e: JobEvent) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (job: Job) => {
      if (settled || job.status === "running") return;
      settled = true;
      off();
      if (job.status === "done") resolve(job.result as T);
      else {
        const e = new ApiError(job.error || (job.status === "cancelled" ? "Cancelled." : "The job failed."));
        if (job.status === "cancelled") {
          e.cancelled = true;
          e.result = job.result;
        }
        reject(e);
      }
    };
    let heard = false;
    const unsubscribe = events((e) => {
      if (e.jobId !== jobId) return;
      heard = true;
      onEvent?.(e);
      if (e.type === "status") finish(e.job);
    });
    // ponytail: the event stream can drop a status between two reconnects (or be missing), so the job
    // is also asked for directly now and then — whichever answer comes first settles it; the job starts before
    // this subscribes, so while the stream says nothing its last progress stands in for the events missed
    const check = () => {
      const quiet = !heard;
      heard = false;
      return call<{ job: Job }>("jobs.show", { id: jobId })
        .then((r) => {
          const j = r?.job;
          if (!j) return;
          if (quiet && !heard && j.status === "running" && j.message)
            onEvent?.({ jobId, at: new Date().toISOString(), type: "progress", message: j.message, ...j.progress });
          finish(j);
        })
        .catch(() => {});
    };
    const poll = setInterval(check, 1500);
    const off = () => {
      clearInterval(poll);
      unsubscribe();
    };
    void check();
  });
}

export async function run<T = unknown>(
  name: string,
  input: unknown,
  onEvent?: (e: JobEvent) => void,
  onStart?: (jobId: string) => void,
  cause?: JobCause,
): Promise<T> {
  const r = await call<unknown>(name, input, undefined, cause);
  if (!isJobRef(r)) return r as T;
  onStart?.(r.jobId);
  return await waitJob<T>(r.jobId, onEvent);
}
