// @vitest-environment jsdom
import { runChoice } from "../../helpers/run-choice.ts";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeDock, metaLine } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { dockState } from "../../../../src/ui/components/claude/dockState.ts";
import { TopBar, useTopBarSlots } from "../../../../src/ui/components/shell/TopBar.tsx";
import { AppContext, type AppState, type Focus } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { restoreAlwaysOnTop } from "../../../../src/ui/lib/desktop.ts";
import { AppearanceSection } from "../../../../src/ui/screens/settings/AppearanceSection.tsx";
import { ClaudeSection } from "../../../../src/ui/screens/settings/ClaudeSection.tsx";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { dataWrapper } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

type Handler = (input: Record<string, unknown>) => unknown;
let calls: { name: string; input: Record<string, unknown> }[] = [];
let routes: Record<string, Handler> = {};
const callsOf = (n: string) => calls.filter((c) => c.name === n);

class FakeES {
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

let run = 0;

beforeEach(() => {
  setProject(`/p/dock-settings-${++run}`);
  calls = [];
  routes = { "claude.status": () => ({ installed: true, version: "2.1.0", signedIn: null, exe: "claude" }) };
  localStorage.clear();
  vi.stubGlobal("EventSource", FakeES);
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
      try {
        return new Response(JSON.stringify((await h(input)) ?? null), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400 });
      }
    }),
  );
});

afterEach(() => {
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
  delete window.testimusDesktop;
});

const withClaude = (
  claude: Partial<NonNullable<AppState["info"]>["project"]["claude"]>,
  over: Partial<AppState> = {},
) => {
  const base = app().info as NonNullable<AppState["info"]>;
  return app({
    info: { ...base, project: { ...base.project, claude: { ...base.project.claude, ...claude } } },
    ...over,
  });
};

const focus = (o: Partial<Focus> = {}): Focus => ({ testId: "local-1", summary: "Test", step: null, ...o });
const wrap = (state: AppState, ui: ReactNode) => <AppContext.Provider value={state}>{ui}</AppContext.Provider>;
const box = () => screen.getByRole("textbox", { name: /Ask Claude|Ask about/ });
const send = (text?: string) => {
  if (text !== undefined) fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Send/ }));
};
const ctxList = [
  { id: "ctx-a", name: "House style", paths: [], files: ["g.pdf"], hasNotes: true },
  { id: "ctx-b", name: "Glossary", paths: ["D:\\Specs"], files: [], hasNotes: false },
];
// ponytail: what claude.preview says a request is given — its instruction and the two saved contexts, on or not
const given = (on: string[]) => [
  piece("instruction", "Ask Claude"),
  ...ctxList.map((c) => piece(`context:${c.id}`, c.name, { on: on.includes(c.id), why: "Attached" })),
];
const context = () => screen.getByRole("button", { name: /^Context/ });
const graph = async () => {
  fireEvent.click(context());
  const dialog = await screen.findByRole("dialog", { name: "Context" });
  await within(dialog).findByRole("group", { name: "What Claude is given" });
  return dialog;
};
const leaveOut = async (name: string) => {
  const dialog = await graph();
  fireEvent.click(within(dialog).getByRole("checkbox", { name }));
  await waitFor(() => expect(within(dialog).getByRole("checkbox", { name })).not.toBeChecked());
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
};
const desktop = (more: Record<string, unknown> = {}) => {
  const d = {
    openExternal: vi.fn(async () => true),
    reveal: vi.fn(async () => true),
    pickFolder: vi.fn(async () => "D:\\Picked"),
    pickFiles: vi.fn(async () => []),
    setAlwaysOnTop: vi.fn(async (on: boolean) => on),
    ...more,
  };
  window.testimusDesktop = d as never;
  return d;
};

describe("dock: scope, presets, contexts, models", () => {
  it("without a test the scope is the whole project, with what a request on the project is given — the run attaches it itself", async () => {
    routes["claude.preview"] = (i) => previewOf(given(["ctx-b"]), i);
    routes["claude.run"] = () => ({ ok: true, summary: "Done", durationMs: 1200, changedTests: [], raw: "" });
    const state = withClaude({ contexts: [] });
    render(wrap(state, <ClaudeDock />));
    expect(screen.getByRole("tab", { name: /On the project/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Change every test" })).toBeNull();
    expect(screen.getByText("Whole project · its tests, documents and contexts")).toBeInTheDocument();
    await waitFor(() => expect(context()).toHaveTextContent(/^Context2$/));
    expect(callsOf("claude.preview")[0].input).toEqual({ use: "ask-project", scope: { kind: "project" } });
    const dialog = await graph();
    expect(within(dialog).getByRole("checkbox", { name: "Glossary" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "House style" })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    send("Uniformise les verbes");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toEqual({
      scope: { kind: "project" },
      prompt: "Uniformise les verbes",
      model: "sonnet",
      effort: "medium",
    });
    expect(await screen.findByText("1.2 s · no tokens reported · sonnet / medium")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Request · Whole project" })).toHaveTextContent("Uniformise les verbes");
    expect(state.setClaudeRunning).toHaveBeenCalledWith("*project*");
  });

  it("a preset of the Suggestions menu fills the box, even two of one label", async () => {
    routes["claude.preview"] = (i) => previewOf(given(["ctx-a", "ctx-b"]), i);
    routes["claude.run"] = () => ({
      ok: true,
      summary: "ok",
      durationMs: 12300,
      tokens: { input: 24100, output: 1200 },
      sessionId: "abcdef123456",
      changedTests: [],
      raw: "",
    });
    const presets = [
      { label: "Rephrase", prompt: "Rephrase in house style" },
      { label: "Rephrase", prompt: "Same label, other prompt" },
    ];
    render(
      wrap(
        withClaude({ presets, model: "opus", effort: "high" }, { focus: focus({ key: "LFRPS12-1" }) }),
        <ClaudeDock />,
      ),
    );
    const suggestions = () => fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
    suggestions();
    fireEvent.click(screen.getAllByRole("menuitem", { name: /^Rephrase/ })[1]);
    expect(box()).toHaveValue("Same label, other prompt");
    suggestions();
    fireEvent.click(screen.getAllByRole("menuitem", { name: /^Rephrase/ })[0]);
    expect(box()).toHaveValue("Rephrase in house style");
    expect(callsOf("claude.run")).toHaveLength(0);
    await leaveOut("Glossary");
    expect(context()).toHaveTextContent(/^Context3 · changed$/);
    send();
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toEqual({
      scope: { kind: "test", testId: "local-1" },
      prompt: "Rephrase in house style",
      without: ["context:ctx-b"],
      model: "opus",
      effort: "high",
    });
    expect(screen.getByText("LFRPS12-1 · Rephrase")).toBeInTheDocument();
    expect(
      await screen.findByText("12.3 s · 24k tokens in · 1.2k out · opus / high · session abcdef12…"),
    ).toBeInTheDocument();
    expect(box()).toHaveValue("Rephrase in house style");
  });

  it("Ctrl+Enter sends and Enter is a new line; raw output is offered after a run that went well too", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = () => ({ effective: [], own: null, project: [] });
    routes["claude.run"] = () => ({ ok: true, summary: "Done", changedTests: [], raw: "RAW-OUT" });
    render(wrap(withClaude({}, { focus: focus() }), <ClaudeDock />));
    fireEvent.change(box(), { target: { value: "Raccourcis" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(callsOf("claude.run")).toHaveLength(0);
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "Show raw output" }));
    expect(screen.getByText("RAW-OUT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("runs on the test with an empty box, as Xray Editor does; the documents need a question", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = () => ({ effective: [], own: null, project: [] });
    routes["claude.run"] = () => ({ ok: true, summary: "Done", changedTests: [], raw: "" });
    render(wrap(withClaude({}, { focus: focus() }), <ClaudeDock />));
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({ prompt: "", scope: { kind: "test", testId: "local-1" } });
    expect(screen.getByText(/No request — Claude works from the scope/)).toBeInTheDocument();
    expect(await screen.findByText("Done")).toBeInTheDocument();
    cleanup();
    render(wrap(withClaude({}), <ClaudeDock />));
    expect(screen.getByRole("tab", { name: /On the project/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /Send/ })).toBeEnabled();
  });

  it("on a test: every run stays until Clear and the next one carries it, the request kept in the box", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = () => ({ effective: [], own: null, project: [] });
    let n = 0;
    routes["claude.run"] = () => ({ ok: true, summary: `Answer ${++n}`, runId: `run-${n}`, changedTests: [], raw: "" });
    const state = withClaude({}, { focus: focus() });
    const r = render(wrap(state, <ClaudeDock />));
    send("Raccourcis");
    expect(await screen.findByText("Answer 1")).toBeInTheDocument();
    expect(box()).toHaveValue("Raccourcis");
    expect(callsOf("claude.run")[0].input.conversation).toBeUndefined();
    send();
    expect(await screen.findByText("Answer 2")).toBeInTheDocument();
    expect(screen.getByText("Answer 1")).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Request · This test" })).toHaveLength(2);
    for (const g of screen.getAllByRole("region", { name: "Request · This test" }))
      expect(g).toHaveTextContent("Raccourcis");
    expect(callsOf("claude.run")[1].input.conversation).toBe(
      "User (This test): Raccourcis\n\nClaude: Answer 1 (0 steps changed)",
    );
    r.rerender(wrap({ ...state, focus: focus({ testId: "local-2" }) }, <ClaudeDock />));
    expect(screen.getByText("Answer 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.queryByText("Answer 2")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    send("Encore");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(3));
    expect(callsOf("claude.run")[2].input.conversation).toBeUndefined();
  });

  it("a cancelled run still shows what Claude changed, tells the editor and offers Revert", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = () => ({ effective: [], own: null, project: [] });
    routes["claude.run"] = () => ({ jobId: "job-9" });
    routes["jobs.show"] = () => ({
      job: {
        id: "job-9",
        kind: "claude",
        status: "cancelled",
        startedAt: "",
        result: {
          runId: "run-9",
          ok: false,
          summary: "Cancelled",
          changedTests: ["local-1"],
          changedSteps: { "local-1": [2] },
          raw: "",
        },
      },
    });
    const state = withClaude({}, { focus: focus() });
    render(wrap(state, <ClaudeDock />));
    send("Raccourcis le pas 2");
    await waitFor(() =>
      expect(state.setLastRun).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-9", changedTests: ["local-1"], changedSteps: { "local-1": [2] } }),
      ),
    );
    expect(await screen.findByRole("button", { name: /Revert/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Cancelled/).length).toBeGreaterThan(0);
  });

  it("what was ticked for a run starts again when the focused test changes", async () => {
    routes["claude.preview"] = (i) =>
      previewOf(given((i.scope as { testId?: string }).testId === "t2" ? ["ctx-b"] : ["ctx-a", "ctx-b"]), i);
    routes["claude.run"] = () => ({ ok: true, summary: "ok", changedTests: [], raw: "" });
    const state = app({ focus: focus() });
    const r = render(wrap(state, <ClaudeDock />));
    await waitFor(() => expect(context()).toHaveTextContent(/^Context3$/));
    await leaveOut("Glossary");
    expect(context()).toHaveTextContent(/^Context2 · changed$/);
    r.rerender(wrap({ ...state, focus: focus({ testId: "t2" }) }, <ClaudeDock />));
    await waitFor(() => expect(context()).toHaveTextContent(/^Context2$/));
    expect(callsOf("claude.preview").at(-1)?.input).toEqual({
      use: "ask-test",
      scope: { kind: "test", testId: "t2" },
    });
    const dialog = await graph();
    expect(within(dialog).getByRole("checkbox", { name: "Glossary" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "House style" })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    send("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("without");
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("contexts");
  });

  it("switches between step, test and project", async () => {
    routes["claude.run"] = () => ({ ok: true, summary: "ok", changedTests: [], raw: "" });
    render(wrap(app({ focus: focus({ step: 2 }) }), <ClaudeDock />));
    fireEvent.click(screen.getByRole("radio", { name: "Whole project" }));
    expect(screen.getByRole("radio", { name: "Whole project" })).toHaveAttribute("aria-checked", "true");
    send("A");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input.scope).toEqual({ kind: "project" });
    fireEvent.click(screen.getByRole("radio", { name: "Step 2" }));
    send("B");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(2));
    expect(callsOf("claude.run")[1].input.scope).toEqual({ kind: "step", testId: "local-1", step: 2 });
  });

  it("offers fable, opus, sonnet and haiku only", async () => {
    routes["claude.run"] = () => ({ ok: true, summary: "a", changedTests: [], raw: "" });
    render(wrap(app(), <ClaudeDock />));
    fireEvent.click(runChoice());
    expect(
      within(screen.getByRole("group", { name: "Model" }))
        .getAllByRole("menuitemcheckbox")
        .map((o) => o.textContent),
    ).toEqual(["fable", "opus", "sonnet", "haiku"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "haiku" }));
    send("Q");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({ model: "haiku" });
  });
});

describe("dock: run details and failures", () => {
  it("counts seconds while running, and tells Claude's tab how the last run went", async () => {
    let finish: (v: unknown) => void = () => {};
    routes["claude.run"] = () => new Promise((res) => (finish = res));
    const state = app({ focus: focus() });
    render(wrap(state, <ClaudeDock />));
    send("Go");
    expect(await screen.findByText(/^\d+:\d\d$/)).toBeInTheDocument();
    await act(async () =>
      finish({ ok: true, summary: "Rewrote step 3\nmore", durationMs: 4500, changedTests: [], raw: "" }),
    );
    expect(await screen.findByText(/^4\.5 s · no tokens reported/)).toBeInTheDocument();
    expect(dockState()).toEqual({ running: false, failed: false, offline: false });
  });

  it("a failed run offers Retry, the raw output and the settings", async () => {
    routes["claude.run"] = () => ({
      ok: false,
      summary: "Usage limit reached",
      durationMs: 800,
      changedTests: [],
      raw: '{"type":"result","is_error":true}',
      diagnosis: { kind: "limit", title: "Usage limit reached", detail: "It frees up after a while." },
    });
    const state = app({ focus: focus() });
    render(wrap(state, <ClaudeDock />));
    send("Fix it");
    expect(await screen.findByText("It frees up after a while.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show raw output" }));
    expect(screen.getByText('{"type":"result","is_error":true}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide raw output" }));
    expect(screen.queryByText('{"type":"result","is_error":true}')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "claude");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(2));
    expect(callsOf("claude.run")[1].input).toEqual({
      ...callsOf("claude.run")[0].input,
      conversation: expect.stringContaining("Claude: Usage limit reached"),
    });
  });

  it("not installed: the panel says it is optional, sends to the program field, the folded dock says so", async () => {
    routes["claude.status"] = () => ({
      installed: false,
      signedIn: false,
      exe: "claude",
      detail: "not found",
      connect: [],
    });
    const state = app();
    render(wrap(state, <ClaudeDock />));
    expect(await screen.findByText(/^Claude is optional — everything else works without it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set the path myself…" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "claude-exe");
    expect(dockState().offline).toBe(true);
  });

  it("the connect panel shows what the Claude CLI probe answered, in the dock and in Settings", async () => {
    const probe = "Invalid API key · Please run /login";
    routes["claude.status"] = () => ({
      installed: true,
      version: "2.1.0",
      signedIn: false,
      exe: "claude",
      detail: probe,
    });
    const r = render(wrap(app(), <ClaudeDock />));
    const title = await screen.findByText("Claude is installed but not signed in");
    const panel = title.parentElement as HTMLElement;
    expect(within(panel).getByText("What Testimus saw")).toBeInTheDocument();
    expect(within(panel).getByText(probe)).toBeInTheDocument();
    expect(within(panel).getByText("/login")).toBeInTheDocument();
    r.unmount();
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    routes["claude.status"] = () => ({
      installed: false,
      signedIn: false,
      exe: "claude",
      detail: "spawn claude ENOENT",
    });
    render(wrap(app({ info: null }), <ClaudeSection />));
    await screen.findByText("Claude isn't installed on this PC yet");
    expect(screen.getByRole("status")).toHaveTextContent("spawn claude ENOENT · Claude is optional");
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("meta line words", () => {
    expect(metaLine({ durationMs: 12345, tokens: { input: 900, output: 41 }, model: "opus", effort: "high" })).toBe(
      "12.3 s · 900 tokens in · 41 out · opus / high",
    );
  });
});

function Bar() {
  return <TopBar title="Tests" onPalette={() => {}} slots={useTopBarSlots()} />;
}

describe("always on top", () => {
  it("always on top: hidden in the browser, a switch and a pin beside « Search everything » in the desktop app, remembered", async () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    const r = render(wrap(app(), <AppearanceSection />));
    expect(screen.queryByRole("switch", { name: /Always on top/ })).toBeNull();
    r.unmount();
    const d = desktop();
    render(
      wrap(
        app(),
        <>
          <AppearanceSection />
          <Bar />
          <ClaudeDock />
        </>,
      ),
    );
    const sw = screen.getByRole("switch", { name: /Always on top/ });
    const pin = screen.getByRole("button", { name: "Always on top" });
    expect(
      screen.getByRole("button", { name: /Search everything/ }).parentElement?.nextElementSibling,
    ).toContainElement(pin);
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(pin).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(d.setAlwaysOnTop).toHaveBeenCalledWith(true));
    expect(localStorage.getItem("testimus.alwaysOnTop")).toBe("1");
    expect(pin).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pin);
    await waitFor(() => expect(d.setAlwaysOnTop).toHaveBeenLastCalledWith(false));
    expect(sw).toHaveAttribute("aria-checked", "false");
    d.setAlwaysOnTop.mockClear();
    restoreAlwaysOnTop();
    expect(d.setAlwaysOnTop).not.toHaveBeenCalled();
    localStorage.setItem("testimus.alwaysOnTop", "true");
    restoreAlwaysOnTop();
    expect(d.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
