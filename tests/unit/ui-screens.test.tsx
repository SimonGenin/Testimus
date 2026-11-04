// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, Test } from "../../src/core/types.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { GenerateScreen } from "../../src/ui/screens/generate/GenerateScreen.tsx";
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

const test1420: Test = {
  key: "LFRPS12-1420",
  project: "LFRPS12",
  summary: "Sectionneur sans TK — menu contextuel",
  folder: "/Traction/Sectionneurs",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "checked",
  steps: [
    {
      fields: { Action: "Ouvrir la vue de traction.", "Expected Result": "La vue s'affiche." },
      sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
      images: [],
    },
    {
      fields: {
        Action: "Clic droit sur le sectionneur S 12.",
        "Expected Result": "Le menu propose Propriétés.",
        Exigence: "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20",
      },
      sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
      images: [],
    },
  ],
  extra: {},
};

describe("Generate screen", () => {
  it("shows the tests as they land from the job events", async () => {
    const written: string[] = [];
    const show = (summary: string): Test => ({ ...test1420, key: undefined, summary, review: "draft" });
    routes["claude.status"] = () => ({ installed: true, signedIn: true });
    routes["jobs.list"] = () => [];
    routes["docs.list"] = () => [];
    routes["gen.tests"] = () => ({ jobId: "job-gen" });
    routes["jobs.show"] = () => ({
      job: { id: "job-gen", kind: "generate", subject: "x", status: "running", startedAt: new Date().toISOString() },
      events: [],
    });
    routes["tests.list"] = () =>
      written.map((id) => ({
        id,
        summary: id,
        folder: "/",
        review: "draft",
        sync: "local",
        dirty: false,
        synced: false,
        mtime: 1,
        stepCount: 2,
      }));
    routes["tests.show"] = (i) => ({
      id: i.id,
      test: show(i.id === "local-aaaaaaaa" ? "Premier test" : "Second test"),
    });
    wrap(appState({ route: { screen: "generate" } }), <GenerateScreen />);
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: "Les sectionneurs" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(named("gen.tests")).toHaveLength(1));
    expect(named("gen.tests")[0].input).toMatchObject({
      request: "Les sectionneurs",
      model: "sonnet",
      effort: "medium",
    });
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await screen.findByText("Getting ready");

    const at = new Date().toISOString();
    FakeEventSource.emit({ jobId: "job-gen", at, type: "progress", message: "Writing local-aaaaaaaa (1)" });
    expect(await screen.findByLabelText("Claude is writing a test")).toBeInTheDocument();
    written.push("local-aaaaaaaa");
    FakeEventSource.emit({ jobId: "job-gen", at, type: "progress", message: "Writing local-bbbbbbbb (2)" });
    expect(await screen.findByText("Premier test")).toBeInTheDocument();
    expect(named("tests.show").map((c) => c.input.id)).not.toContain("local-bbbbbbbb");

    written.push("local-bbbbbbbb");
    FakeEventSource.emit({
      jobId: "job-gen",
      at,
      type: "status",
      job: {
        id: "job-gen",
        kind: "generate",
        subject: "x",
        status: "done",
        startedAt: at,
        endedAt: at,
        result: {
          runId: "r1",
          ok: true,
          summary: "",
          tests: ["local-aaaaaaaa", "local-bbbbbbbb"],
          checks: [
            { id: "local-aaaaaaaa", ok: true, review: "checked", errors: 0, warnings: 0 },
            { id: "local-bbbbbbbb", ok: false, review: "draft", errors: 2, warnings: 1 },
          ],
          changed: [],
          skipped: [{ item: "Alarme de sectionneur", why: "no passage describes the alarm" }],
          reportFound: true,
          durationMs: 1000,
        },
      },
    });
    expect(await screen.findByText("Second test")).toBeInTheDocument();
    expect(screen.getByText("2 tests written")).toBeInTheDocument();
    expect(screen.getByText(/no passage describes the alarm/)).toBeInTheDocument();
    expect(screen.getByText(/All 2 tests went through the check: 1 has findings/)).toBeInTheDocument();
    const head = (title: string) =>
      screen.getByRole("region", { name: title }).querySelector(".gcard-head") as HTMLElement;
    expect(within(head("Second test")).getByText("2 errors")).toBeInTheDocument();
    expect(within(head("Premier test")).getByText("No findings")).toBeInTheDocument();
    expect(named("check.run")).toHaveLength(0);
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
