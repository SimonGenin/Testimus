// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { Toasts } from "../../src/ui/components/legacy/index.ts";
import { Activity } from "../../src/ui/components/shell/Activity.tsx";
import { ScreenHeader } from "../../src/ui/components/shell/ScreenHeader.tsx";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { resetLocalWork } from "../../src/ui/lib/localActivity.ts";
import { closeToast, toast } from "../../src/ui/lib/toast.ts";
import { layoutOf } from "./layout-helpers.ts";

type Handler = (input: Record<string, unknown>) => unknown;
type Call = { name: string; input: Record<string, unknown>; project: string | null };

let calls: Call[] = [];
let routes: Record<string, Handler> = {};

// ponytail: api.ts keeps one stream for every listener, and a pull abandoned by an earlier test still
// listens — the event goes to whichever stream is open, not to the last one built
class FakeEventSource {
  static open: FakeEventSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.open.push(this);
  }
  close() {
    FakeEventSource.open = FakeEventSource.open.filter((x) => x !== this);
  }
  static emit(e: JobEvent) {
    act(() => FakeEventSource.open.at(-1)?.onmessage?.({ data: JSON.stringify(e) }));
  }
}

class FakeIO {
  static all: FakeIO[] = [];
  el: Element | null = null;
  dead = false;
  cb: (entries: { isIntersecting: boolean }[]) => void;
  opts: { rootMargin?: string };
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void, opts: { rootMargin?: string }) {
    this.cb = cb;
    this.opts = opts;
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.el = el;
  }
  disconnect() {
    this.dead = true;
  }
  static fire() {
    for (const io of FakeIO.all.filter((x) => !x.dead && x.el)) act(() => io.cb([{ isIntersecting: true }]));
  }
}

beforeEach(() => {
  calls = [];
  routes = {};
  FakeIO.all = [];
  localStorage.clear();
  setProject("C:/p");
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      if (!m) return new Response("", { status: 404 });
      const name = `${m[1]}.${m[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const p = init?.headers?.["X-Testimus-Project"];
      calls.push({ name, input, project: p ? decodeURIComponent(p) : null });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      try {
        return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
      }
    }),
  );
});

afterEach(() => {
  resetLocalWork();
  const last = toast({ kind: "info", title: "" });
  for (let i = 1; i <= last; i++) closeToast(i, true);
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
});

const named = (name: string) => calls.filter((c) => c.name === name);

function appState(route: AppState["route"], navigate: AppState["navigate"], dir: string): AppState {
  return {
    info: {
      dir,
      project: { jiraProject: "LFRPS12" } as never,
      xray: layoutOf([], { order: [], collapsed: [], hidden: [] }),
    },
    xray: layoutOf([], { order: [], collapsed: [], hidden: [] }),
    route,
    focus: null,
    claudeRunning: null,
    lastRun: null,
    testsNonce: 0,
    navigate,
    setFocus: vi.fn(),
    setClaudeRunning: vi.fn(),
    setLastRun: vi.fn(),
    testsChanged: vi.fn(),
    refreshInfo: vi.fn(),
    closeProject: vi.fn(),
    openSource: vi.fn(),
    askClaude: vi.fn(),
    runInDock: vi.fn(),
    openPalette: vi.fn(),
  };
}

describe("Activity and toasts", () => {
  it("shows running jobs with their progress and elapsed time, cancels one, and closes", async () => {
    const started = new Date(Date.now() - 5000).toISOString();
    routes["jobs.list"] = () => [
      {
        id: "j1",
        kind: "pull",
        subject: "LFRPS12-9",
        status: "running",
        startedAt: started,
        message: "1 test to pull",
      },
    ];
    routes["jobs.cancel"] = () => ({ cancelled: true });
    render(<Activity />);
    const btn = await screen.findByRole("button", { name: "1 job running" });
    fireEvent.click(btn);
    const pop = screen.getByRole("dialog", { name: "Running jobs" });
    expect(within(pop).getByText("LFRPS12-9")).toBeInTheDocument();
    expect(within(pop).getByText("1 test to pull")).toBeInTheDocument();
    expect(within(pop).getByText(/^[5-6] s$/)).toBeInTheDocument();
    expect(within(pop).getByTitle("pull")).toHaveClass("busy-tile");
    FakeEventSource.emit({ jobId: "j1", at: "", type: "progress", message: "LFRPS12-9: steps fetched" });
    expect(within(pop).getByText("LFRPS12-9: steps fetched")).toBeInTheDocument();
    fireEvent.click(within(pop).getByRole("button", { name: "Cancel LFRPS12-9" }));
    await waitFor(() => expect(named("jobs.cancel")[0]?.input).toEqual({ id: "j1" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Running jobs" })).toBeNull();
    fireEvent.click(btn);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Running jobs" })).toBeNull();
    fireEvent.click(btn);
    FakeEventSource.emit({
      jobId: "j1",
      at: "",
      type: "status",
      job: { id: "j1", kind: "pull", subject: "LFRPS12-9", status: "cancelled", startedAt: started },
    });
    expect(screen.queryByRole("button", { name: /job running/ })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Running jobs" })).toBeNull();
  });

  it("shows a rate-limit wait that happens outside any job, until it ends", async () => {
    routes["jobs.list"] = () => [];
    render(<Activity />);
    await waitFor(() => expect(named("jobs.list")).toHaveLength(1));
    act(() => FakeEventSource.emit({ jobId: "", at: "", type: "notice", message: "Rate limited — waiting 7s" }));
    expect(screen.getByRole("status")).toHaveTextContent("Rate limited — waiting 7s");
    act(() => FakeEventSource.emit({ jobId: "", at: "", type: "notice", message: "" }));
    expect(screen.queryByText(/Rate limited/)).toBeNull();
  });

  it("every other screen's header shows the running jobs too", async () => {
    routes["jobs.list"] = () => [
      { id: "j2", kind: "generate", subject: "Generate J5", status: "running", startedAt: new Date().toISOString() },
    ];
    render(
      <AppContext.Provider value={appState({ screen: "documents" }, () => {}, "D:/P")}>
        <ScreenHeader title="Documents" />
      </AppContext.Provider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "1 job running" }));
    expect(within(screen.getByRole("dialog", { name: "Running jobs" })).getByText("Generate J5")).toBeInTheDocument();
  });

  it("counts a timed toast down inside its action button", async () => {
    render(<Toasts />);
    act(() => {
      toast({ kind: "info", title: "Step deleted", action: { label: "Undo", run: () => {} } });
    });
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toHaveTextContent("Undo · 6 s");
    await waitFor(() => expect(undo).toHaveTextContent("Undo · 5 s"), { timeout: 2500 });
    act(() => {
      toast({ kind: "error", title: "Broken", action: { label: "Retry", run: () => {} } });
    });
    expect(screen.getByRole("button", { name: "Retry" })).toHaveTextContent(/^Retry$/);
  });
});
