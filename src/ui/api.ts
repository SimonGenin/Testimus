import type { Job, JobEvent } from "../core/types.ts";

export class ApiError extends Error {
  readonly fix?: string;
  readonly status: number;
  // ponytail: a cancelled job can still have done work (a Claude run edits files as it goes) — its result rides here
  cancelled?: boolean;
  result?: unknown;
  constructor(message: string, fix?: string, status = 0) {
    super(message);
    this.fix = fix;
    this.status = status;
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

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (current) h["X-Testimus-Project"] = encodeURIComponent(current);
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
    const e = (value ?? {}) as { error?: string; fix?: string };
    throw new ApiError(e.error || `HTTP ${res.status}`, e.fix, res.status);
  }
  return value;
}

export async function call<T = unknown>(name: string, input: unknown = {}, signal?: AbortSignal): Promise<T> {
  const [group, verb] = name.split(".");
  const res = await fetch(`/api/${group}/${verb}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input ?? {}),
    signal,
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
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

function connect(): void {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
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
): Promise<T> {
  const r = await call<unknown>(name, input);
  if (!isJobRef(r)) return r as T;
  onStart?.(r.jobId);
  return await waitJob<T>(r.jobId, onEvent);
}
