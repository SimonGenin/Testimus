// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../src/core/types.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { DoctorScreen } from "../../src/ui/screens/doctor/DoctorScreen.tsx";
import { ColumnsSection } from "../../src/ui/screens/settings/ColumnsSection.tsx";
import { renderWithData } from "./cov-uishell-helpers.tsx";
import { layoutOf } from "./layout-helpers.ts";

type Handler = (input: Record<string, unknown>) => unknown;
type Call = { name: string; input: Record<string, unknown> };

let calls: Call[] = [];
let routes: Record<string, Handler> = {};

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close() {}
  static emit(e: JobEvent) {
    act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(e) }));
  }
}

beforeEach(() => {
  calls = [];
  routes = {};
  resetDoctor();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      if (!m) return new Response("", { status: 404 });
      const name = `${m[1]}.${m[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ name, input });
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      return new Response(JSON.stringify(h(input) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const xray = layoutOf(
  [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
    { id: "cf", name: "Exigence", type: "text-single", builtin: false },
  ],
  { order: ["Action", "Data", "Expected Result", "Exigence"], collapsed: ["Data"], hidden: [] },
);

function appState(over: Partial<AppState> = {}): AppState {
  return {
    info: {
      dir: "C:/p",
      project: {
        name: "RATP Sosie",
        jiraProject: "LFRPS12",
        language: "fr",
        labelPrefix: "testimus-",
        folders: ["/Traction/Sectionneurs"],
        rag: {},
        claude: { model: "sonnet", effort: "medium", presets: [], contexts: [] },
      },
      xray,
    },
    xray,
    route: { screen: "review" },
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
    openPalette: vi.fn(),
    ...over,
  };
}

const wrap = (app: AppState, node: ReactNode) =>
  renderWithData(<AppContext.Provider value={app}>{node}</AppContext.Provider>);

const named = (name: string) => calls.filter((c) => c.name === name);

describe("System check", () => {
  it("shows each check as an icon and a word, with what to do", async () => {
    routes["system.doctor"] = () => ({
      ok: false,
      checks: [
        { id: "claude", label: "Claude Code CLI", state: "ok", detail: "claude 2.1.0" },
        {
          id: "claudeLogin",
          label: "Claude signed in",
          state: "warn",
          detail: "Claude is installed but not signed in.",
          fix: "Type claude, then /login.",
          action: { label: "Check Claude sign-in", command: "system.doctor", input: { claude: true } },
        },
        { id: "jira", label: "Jira reachable", state: "fail", detail: "401", fix: "Check the token." },
      ],
    });
    wrap(appState({ route: { screen: "doctor" } }), <DoctorScreen />);
    const list = await screen.findByRole("list", { name: "Checks" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    const rows = within(list).getAllByRole("listitem");
    const words = rows.map((r) => r.querySelector(".badge"));
    expect(words.map((w) => w?.textContent)).toEqual(["OK", "To do", "Failed"]);
    for (const w of words) expect(w?.querySelector("svg")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("What to do: Type claude, then /login.");
    fireEvent.click(screen.getByRole("button", { name: "Check Claude sign-in" }));
    await waitFor(() => expect(named("system.doctor").some((c) => c.input.claude === true)).toBe(true));
  });
});

describe("Settings", () => {
  it("saves the step column preferences through columns.setModes and columns.order", async () => {
    routes["columns.setModes"] = () => [];
    routes["columns.order"] = () => [];
    const base = appState({ route: { screen: "settings" } });
    const columns = ["Action", "Data", "Expected Result", "Exigence"].map((name) => ({
      name,
      origin: "xray",
      builtin: name !== "Exigence",
      status: "ok",
      description: "",
      mode: "open",
    }));
    const app = { ...base, info: { ...base.info, columns } } as AppState;
    wrap(app, <ColumnsSection />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Exigence hidden" }));
    await waitFor(() => expect(named("columns.setModes")).toHaveLength(1));
    expect(named("columns.setModes")[0].input).toEqual({ modes: { Exigence: "hidden" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Data folding" }), { target: { value: "filled" } });
    await waitFor(() => expect(named("columns.setModes")).toHaveLength(2));
    expect(named("columns.setModes")[1].input).toEqual({ modes: { Data: "filled" } });
    expect(screen.getByRole("combobox", { name: "Action folding" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Exigence up" }));
    await waitFor(() => expect(named("columns.order")).toHaveLength(1));
    expect(named("columns.order")[0].input).toEqual({ names: ["Action", "Data", "Exigence", "Expected Result"] });
    expect(app.refreshInfo).toHaveBeenCalled();
  });
});
