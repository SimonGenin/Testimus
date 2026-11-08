import { vi } from "vitest";
import type { ColumnLayout } from "../../../src/core/types.ts";
import type { TestimusDesktop } from "../../../src/desktop/bridge-types.ts";
import type { AppState } from "../../../src/ui/lib/app.ts";

export type Call = { name: string; input: Record<string, unknown> };

export const api = {
  calls: [] as Call[],
  routes: {} as Record<string, (input: Record<string, unknown>) => unknown>,
};

export const named = (n: string) => api.calls.filter((c) => c.name === n);

export function fakeFetch(): void {
  api.calls = [];
  api.routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      api.calls.push({ name, input });
      const h = api.routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      try {
        return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
      } catch (e) {
        if (!(e instanceof Error && "code" in e)) throw e;
        return new Response(JSON.stringify({ error: e.message, code: e.code }), { status: 400 });
      }
    }),
  );
}

export function fakeDesktop(o: { folder?: string | null; files?: string[]; paths?: Record<string, string> } = {}) {
  const d = {
    open: null as ((dir: string) => void) | null,
    version: vi.fn(async () => ({ shell: "0.2.0", electron: "45.2.1", chrome: "142" })),
    pickFolder: vi.fn(async () => (o.folder === undefined ? "C:\\Picked\\Folder" : o.folder)),
    pickFiles: vi.fn(async () => o.files ?? []),
    pathOf: vi.fn((f: File) => o.paths?.[f.name] ?? ""),
    reveal: vi.fn(async () => true),
    openExternal: vi.fn(async () => true),
    setProgress: vi.fn(async () => {}),
    notify: vi.fn(async (_o: { title: string; body: string }) => true),
    relaunch: vi.fn(async () => true),
    onOpenProject: vi.fn((cb: (dir: string) => void) => {
      d.open = cb;
      return () => {
        d.open = null;
      };
    }),
  };
  window.testimusDesktop = d as unknown as TestimusDesktop;
  return d;
}

export function noDesktop(): void {
  delete window.testimusDesktop;
}

export const xray: ColumnLayout = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  columns: [
    { name: "Action", id: "action", origin: "xray", builtin: true, status: "ok", description: "", mode: "open" },
    {
      name: "Expected Result",
      id: "result",
      origin: "xray",
      builtin: true,
      status: "ok",
      description: "",
      mode: "open",
    },
  ],
};

export const app = (over: Partial<AppState> = {}): AppState => ({
  info: {
    dir: "C:\\p",
    project: {
      name: "RATP Sosie",
      jiraProject: "LFRPS12",
      language: "fr",
      labelPrefix: "testimus-",
      folders: [],
      rag: {},
      claude: { model: "sonnet", effort: "medium", presets: [], contexts: [] },
    },
    xray,
  } as unknown as AppState["info"],
  xray,
  route: { screen: "documents" },
  focus: null,
  claudeRunning: null,
  lastRun: null,
  testsNonce: 0,
  navigate: vi.fn(),
  setFocus: vi.fn(),
  setClaudeRunning: vi.fn(),
  setLastRun: vi.fn(),
  testsChanged: vi.fn(),
  refreshInfo: vi.fn(),
  closeProject: vi.fn(),
  openSource: vi.fn(),
  askClaude: vi.fn(),
  runInDock: vi.fn(),
  askAbout: vi.fn(),
  openPalette: vi.fn(),
  ...over,
});

export class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close(): void {}
  emit(e: unknown): void {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
}
