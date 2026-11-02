import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Job, JobEvent } from "../../src/core/types.ts";
import { AppContext, type AppState, useApp } from "../../src/ui/lib/app.ts";
import { app } from "./ui-desktop-helpers.tsx";

export function FakeScreen({ name }: { name: string }) {
  const a = useApp();
  return (
    <section aria-label={name}>
      <span>
        {name} nonce {a.testsNonce} arg {a.route.arg ?? "-"} fields {a.xray.fields.length}
      </span>
      <button type="button" onClick={() => a.askClaude("step", "why")}>
        ask from {name}
      </button>
      <button type="button" onClick={() => a.runInDock({ name: "review.fix", input: {}, label: "Fix", testId: "t1" })}>
        job from {name}
      </button>
      <button type="button" onClick={() => a.openSource({ docId: "D", anchor: "§1", quote: "q" })}>
        source from {name}
      </button>
      <button type="button" onClick={a.openPalette}>
        palette from {name}
      </button>
      <button type="button" onClick={a.testsChanged}>
        changed from {name}
      </button>
      <button type="button" onClick={() => a.navigate(a.route.screen, a.route.arg)}>
        same from {name}
      </button>
    </section>
  );
}

export const fakeScreen = (name: string) => () => <FakeScreen name={name} />;

export type Handler = (input: Record<string, unknown>) => unknown;

export const net = {
  calls: [] as { name: string; input: Record<string, unknown> }[],
  routes: {} as Record<string, Handler>,
  files: {} as Record<string, unknown>,
  api: null as Handler | null,
};

export const callsOf = (n: string) => net.calls.filter((c) => c.name === n);

export class Fail extends Error {
  status: number;
  fix?: string;
  constructor(message: string, status = 400, fix?: string) {
    super(message);
    this.status = status;
    this.fix = fix;
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body ?? null), { status });

export function fakeNet(): void {
  net.calls = [];
  net.routes = {};
  net.files = {};
  net.api = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.startsWith("/files/")) {
        const path = decodeURIComponent(u.slice(7).split("?")[0]);
        net.calls.push({ name: `file:${path}`, input: {} });
        const f = net.files[path];
        if (f instanceof Error) throw f;
        if (f === undefined) return json(404, { error: "not found" });
        return json(200, f);
      }
      if (u === "/api") {
        net.calls.push({ name: "api", input: {} });
        if (!net.api) return json(500, { error: "down" });
        try {
          return json(200, await net.api({}));
        } catch (e) {
          return json((e as Fail).status ?? 500, { error: (e as Error).message, fix: (e as Fail).fix });
        }
      }
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(u);
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      net.calls.push({ name, input });
      const h = net.routes[name];
      if (!h) return json(404, { error: `Unknown command ${name}` });
      try {
        return json(200, await h(input));
      } catch (e) {
        return json((e as Fail).status ?? 400, { error: (e as Error).message, fix: (e as Fail).fix });
      }
    }),
  );
}

export class FakeES {
  static all = new Set<FakeES>();
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeES.all.add(this);
  }
  close(): void {
    this.closed = true;
    FakeES.all.delete(this);
  }
  static emit(e: JobEvent | string): void {
    for (const s of [...FakeES.all]) s.onmessage?.({ data: typeof e === "string" ? e : JSON.stringify(e) });
  }
  static fail(): void {
    for (const s of [...FakeES.all]) s.onerror?.();
  }
}

export function fakeEvents(): void {
  FakeES.all.clear();
  vi.stubGlobal("EventSource", FakeES);
}

export const job = (o: Partial<Job> = {}): Job => ({
  id: "j1",
  kind: "generate",
  subject: "SOSIE D401-1",
  status: "running",
  startedAt: "2026-11-02T10:00:00.000Z",
  ...o,
});

export const status = (j: Job, at = "2026-11-02T10:00:05.000Z"): JobEvent => ({
  jobId: j.id,
  at,
  type: "status",
  job: j,
});

export function withApp(ui: ReactNode, over: Partial<AppState> = {}) {
  const state = app(over);
  const r = render(<AppContext.Provider value={state}>{ui}</AppContext.Provider>);
  return {
    ...r,
    state,
    rerenderWith: (more: Partial<AppState>) => {
      Object.assign(state, more);
      r.rerender(<AppContext.Provider value={{ ...state }}>{ui}</AppContext.Provider>);
    },
  };
}

export function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
