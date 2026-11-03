import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Finding, Test } from "../../../../src/core/types.ts";
import { Toasts } from "../../../../src/ui/components/legacy/index.ts";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { createQueryClient } from "../../../../src/ui/lib/data/query.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import type { QueueItem } from "../../../../src/ui/screens/review/ReviewQueue.tsx";
import { layoutOf } from "../../layout-helpers.ts";
import { app } from "../../ui-desktop-helpers.tsx";

configure({ asyncUtilTimeout: 4000 });

type Call = { name: string; input: Record<string, unknown> };
type Refusal = { refused: { error: string; fix?: string; code?: string }; status?: number };

export const net = {
  calls: [] as Call[],
  routes: {} as Record<string, (input: Record<string, unknown>) => unknown>,
  gate: null as ((name: string, input: Record<string, unknown>) => Promise<void> | undefined) | null,
};

export const named = (n: string) => net.calls.filter((c) => c.name === n);

export const refused = (error: string, code?: string, status = 400): Refusal => ({ refused: { error, code }, status });

// ponytail: the server as the screen sees it — a route answers, refuses (4xx with a code, as a UserError does) or is
// missing (404); a route that throws is refused with its message
export function fakeServer(): void {
  net.calls = [];
  net.routes = {};
  net.gate = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      net.calls.push({ name, input });
      await net.gate?.(name, input);
      const h = net.routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      let out: unknown;
      try {
        out = h(input);
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
      }
      const no = (out as Refusal | null)?.refused;
      if (no) return new Response(JSON.stringify(no), { status: (out as Refusal).status ?? 400 });
      return new Response(JSON.stringify(out ?? null), { status: 200 });
    }),
  );
}

export const xray = layoutOf(
  [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  { order: ["Action", "Expected Result"], collapsed: [], hidden: [] },
);

export function mountReview(ui: ReactNode, over: Partial<AppState> = {}) {
  const client: QueryClient = createQueryClient();
  const a = app({ xray, ...over });
  const tree = (node: ReactNode, value: AppState) => (
    <QueryClientProvider client={client}>
      <AppContext.Provider value={value}>
        {node}
        <Toasts />
      </AppContext.Provider>
    </QueryClientProvider>
  );
  const r = render(tree(ui, a));
  const rerender = (next: ReactNode, more: Partial<AppState> = {}) => {
    Object.assign(a, more);
    r.rerender(tree(next, { ...a }));
  };
  return { app: a, client, ...r, rerender };
}

let ids: number[] = [];

function ToastIds() {
  ids = useToasts().map((t) => t.id);
  return null;
}

export function clearToasts(): void {
  const r = render(<ToastIds />);
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  r.unmount();
}

export const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  summary: `Summary ${id}`,
  folder: "/F",
  review: "checked",
  unchecked: false,
  errors: 0,
  warnings: 0,
  infos: 0,
  stale: false,
  mtime: 1,
  ...over,
});

export const testOf = (id: string, over: Partial<Test> = {}): Test =>
  ({
    key: id.startsWith("K") ? id : undefined,
    summary: `Summary ${id}`,
    folder: "/F",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "checked",
    steps: [
      { fields: { Action: "One" }, sources: [], images: [] },
      { fields: { Action: "Two" }, sources: [{ docId: "D", anchor: "§2", quote: "q2" }], images: [] },
      { fields: { Action: "Three" }, sources: [{ docId: "D", anchor: "§2", quote: "q2" }], images: [] },
    ],
    extra: {},
    ...over,
  }) as Test;

export type Setup = {
  queue?: QueueItem[];
  tests?: Record<string, Partial<Test>>;
  findings?: Finding[];
  stale?: boolean;
  sync?: string;
};

export function reviewRoutes(s: Setup = {}) {
  let queue = s.queue ?? [item("K-1"), item("K-2"), item("L-3", { folder: "" })];
  net.routes["review.queue"] = () => ({ tests: queue, counts: { checked: 2, toFix: 1, draft: 0, unchecked: 1 } });
  net.routes["tests.show"] = (i) => ({
    id: i.id,
    test: testOf(String(i.id), s.tests?.[String(i.id)]),
    sync: s.sync ?? (String(i.id).startsWith("K") ? "synced" : "local"),
    edited: false,
  });
  net.routes["check.show"] = () => ({
    check: s.findings ? { at: "2026-10-30T10:02:00Z", testHash: "", findings: s.findings } : null,
    stale: !!s.stale,
  });
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["rag.passage"] = (i) => ({
    docId: "D",
    anchor: String(i.ref).split("#")[1],
    path: "",
    title: "",
    text: "texte",
    figures: [],
    doc: { code: "D", title: `Passage ${i.ref}`, version: "1", status: "validated" },
  });
  net.routes["review.evidence"] = () => ({
    testId: "K-1",
    jobId: "j",
    consulted: [],
    read: [
      { ref: "D#§2", title: "", cited: true },
      { ref: "E#§7", title: "Seven", cited: false },
    ],
    searched: [],
  });
  net.routes["review.set"] = () => ({});
  return { setQueue: (q: QueueItem[]) => (queue = q) };
}
