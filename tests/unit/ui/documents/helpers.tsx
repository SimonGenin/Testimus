import { act, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { DocRef, Job, JobEvent } from "../../../../src/core/types.ts";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { applyJobEvent } from "../../../../src/ui/lib/data/events.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";
import { api, app, FakeEventSource } from "../../helpers/ui-desktop.tsx";

configure({ asyncUtilTimeout: 4000 });

export const at = "2026-11-02T10:00:00.000Z";

export const doc = (id: string, over: Partial<DocRef> = {}): DocRef => ({
  id,
  code: `C-${id}`,
  title: `Title ${id}`,
  version: "01.01",
  date: "",
  kind: "spec",
  status: "validated",
  source: { name: "", sha256: "", file: "source.docx" },
  converted: { with: "", at, warnings: [] },
  indexed: "fresh",
  ...over,
});

// ponytail: the project's jobs as the server keeps them — a route made by startsJob lists its job, every event a test
// emits updates it (jobs.list answers with it)
export const served: { jobs: Job[] } = { jobs: [] };

export const emit = (e: JobEvent) => {
  served.jobs = applyJobEvent(served.jobs, e);
  act(() => FakeEventSource.last?.emit(e));
};

export const startsJob =
  (id: string, kind: string, subject = "", over: Partial<Job> = {}) =>
  (input: Record<string, unknown>) => {
    const job: Job = {
      id,
      kind,
      subject: subject || String(input.id ?? ""),
      status: "running",
      startedAt: at,
      ...over,
    };
    served.jobs = applyJobEvent(served.jobs, { jobId: id, at, type: "status", job });
    return { jobId: id };
  };

// ponytail: a screen of the zone with what the app gives it — the data layer (one SSE, no retries), the app state
// and the toasts
export function mountDocs(ui: ReactNode, over: Partial<AppState> = {}) {
  served.jobs = [];
  api.routes["jobs.list"] ??= () => served.jobs;
  const a = app(over);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  const r = render(
    <DataProvider client={client}>
      <AppContext.Provider value={a}>
        {ui}
        <Toaster />
      </AppContext.Provider>
    </DataProvider>,
  );
  return { app: a, client, ...r };
}

// ponytail: jsdom has no layout — the boxes and the scroll positions a test needs, by data-testid or attribute
export function boxes(rects: Record<string, Partial<DOMRect>>) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const k = Object.keys(rects).find((sel) => this.matches(sel));
    return { top: 0, bottom: 0, height: 0, ...(k ? rects[k] : {}) } as DOMRect;
  });
  const tops = new Map<Element, number>();
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return tops.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, v: number) {
    tops.set(this, v);
  });
  return { tops };
}

// ponytail: the next calls of one command that match are refused by the server (an error, a fix, a code)
export function refuse(
  name: string,
  when: (input: Record<string, unknown>) => boolean,
  answer: { error: string; fix?: string; code?: string },
  status = 400,
) {
  const f = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const input = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      if (`${m?.[1]}.${m?.[2]}` === name && when(input)) {
        api.calls.push({ name, input });
        return new Response(JSON.stringify(answer), { status });
      }
      return f(url, init);
    }),
  );
}
