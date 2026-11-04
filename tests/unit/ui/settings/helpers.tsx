import { act, cleanup, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";
import { clearToasts } from "../../cov-uiscreens-helpers.tsx";
import { app } from "../../ui-desktop-helpers.tsx";

configure({ asyncUtilTimeout: 4000 });

export const DIR = "C:\\p";

// ponytail: a field's label carries its save state (« Saved »), so a field is found by the start of its name
export const label = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

export type Call = { name: string; input: Record<string, unknown>; project: string | null };
export type Route = (input: Record<string, unknown>) => unknown;

export const net = { calls: [] as Call[], routes: {} as Record<string, Route>, gate: null as Promise<void> | null };

export const calls = (n: string) => net.calls.filter((c) => c.name === n);
export const inputs = (n: string) => calls(n).map((c) => c.input);

// ponytail: a refusal of the server, with its fix and its stable code (a 4xx: the data layer does not retry it)
export class Fail extends Error {
  status: number;
  fix?: string;
  code?: string;
  constructor(message: string, o: { status?: number; fix?: string; code?: string } = {}) {
    super(message);
    this.status = o.status ?? 400;
    this.fix = o.fix;
    this.code = o.code;
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body ?? null), { status });

export class FakeES {
  static all = new Set<FakeES>();
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeES.all.add(this);
  }
  close(): void {
    FakeES.all.delete(this);
  }
}

export const emit = (e: JobEvent) =>
  act(() => {
    for (const s of [...FakeES.all]) s.onmessage?.({ data: JSON.stringify(e) });
  });

// ponytail: every command answers from net.routes; an unknown one is a 404 as the server says it
export function fakeNet(): void {
  net.calls = [];
  net.routes = {};
  net.gate = null;
  FakeES.all.clear();
  vi.stubGlobal("EventSource", FakeES);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const header = init?.headers?.["X-Testimus-Project"];
      net.calls.push({ name, input, project: header ? decodeURIComponent(header) : null });
      if (net.gate) await net.gate;
      const h = net.routes[name];
      if (!h) return json(404, { error: `Unknown command ${name}` });
      try {
        return json(200, await h(input));
      } catch (e) {
        const f = e as Fail;
        return json(f.status ?? 400, { error: f.message, fix: f.fix, code: f.code });
      }
    }),
  );
}

export function hold(): () => void {
  let release = () => {};
  net.gate = new Promise<void>((r) => {
    release = () => {
      net.gate = null;
      r();
    };
  });
  return release;
}

export const column = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  origin: "xray",
  builtin: name === "Action" || name === "Data" || name === "Expected Result",
  status: "ok",
  description: `${name} text`,
  mode: "open",
  ...over,
});

const base = app().info as unknown as Record<string, unknown>;

// ponytail: what project.info answers: app()'s project, the step fields and columns given
export function info(
  project: Record<string, unknown> = {},
  more: { columns?: unknown[]; fields?: unknown[]; fetchedAt?: string } = {},
) {
  return {
    dir: DIR,
    project: { ...(base.project as object), ...project },
    xray: {
      ...(more.fetchedAt ? { fetchedAt: more.fetchedAt } : {}),
      fields: more.fields ?? [
        { id: "action", name: "Action", type: "text", builtin: true },
        { id: "result", name: "Expected Result", type: "text", builtin: true },
      ],
    },
    fieldOrder: [],
    columns: more.columns ?? [column("Action"), column("Expected Result")],
    counts: { docs: 0, tests: 0, review: {}, awaiting: 0, jobsRunning: 0 },
  };
}

export const job = (o: Partial<Job> = {}): Job => ({
  id: "j-00000001",
  kind: "x",
  subject: "",
  status: "running",
  startedAt: "2026-11-04T10:00:00.000Z",
  ...o,
});

export const status = (j: Job): JobEvent => ({ jobId: j.id, at: "2026-11-04T10:00:05.000Z", type: "status", job: j });

export const progress = (jobId: string, message: string, done?: number, total?: number): JobEvent => ({
  jobId,
  at: "2026-11-04T10:00:02.000Z",
  type: "progress",
  message,
  done,
  total,
});

// ponytail: a job of the fake server — jobs.show answers its state; finish() makes it end and tells the page
export function fakeJob(o: Partial<Job>) {
  let current = job(o);
  const prev = net.routes["jobs.show"];
  net.routes["jobs.show"] = (input) => {
    if (input.id === current.id) return { job: current, events: [] };
    if (prev) return prev(input);
    throw new Fail(`No job ${input.id}.`);
  };
  return {
    id: current.id,
    finish: async (end: Partial<Job>) => {
      current = { ...current, ...end };
      await emit(status(current));
    },
    progress: (message: string, done?: number, total?: number) => emit(progress(current.id, message, done, total)),
  };
}

// ponytail: a screen of the zone with what the app gives it — the data layer (one SSE, no retries), the app state, the
// toasts; the page's project is set as App sets it
export function mountSettings(ui: ReactNode, over: Partial<AppState> = {}) {
  const a = app(over);
  setProject(a.info ? DIR : null);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  const wrap = (node: ReactNode, state: AppState) => (
    <DataProvider client={client}>
      <AppContext.Provider value={state}>
        {node}
        <Toaster />
      </AppContext.Provider>
    </DataProvider>
  );
  const r = render(wrap(ui, a));
  return {
    app: a,
    client,
    ...r,
    rerender: (node: ReactNode, more: Partial<AppState> = {}) => r.rerender(wrap(node, { ...a, ...more })),
  };
}

export function reset(): void {
  cleanup();
  clearToasts();
  clearDrafts();
  setProject(null);
  localStorage.clear();
  delete window.testimusDesktop;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
