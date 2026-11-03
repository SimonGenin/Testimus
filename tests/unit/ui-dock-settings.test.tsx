// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredsStatus, DoctorCheck } from "../../src/core/types.ts";
import { ClaudeDock, metaLine } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { ContextsDialog, contextLine } from "../../src/ui/components/claude/ContextsDialog.tsx";
import { AppContext, type AppState, type Focus } from "../../src/ui/lib/app.ts";
import { restoreAlwaysOnTop } from "../../src/ui/lib/desktop.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { AccessSection, fileState } from "../../src/ui/screens/settings/AccessSection.tsx";
import { AppearanceSection } from "../../src/ui/screens/settings/AppearanceSection.tsx";
import { ClaudeSection, exeLine } from "../../src/ui/screens/settings/ClaudeSection.tsx";
import { jiraWords, savedAs, siteRoot, xrayWords } from "../../src/ui/screens/settings/ConnectAtlassian.tsx";
import { ProjectSection } from "../../src/ui/screens/settings/ProjectSection.tsx";
import { SettingsScreen } from "../../src/ui/screens/settings/SettingsScreen.tsx";
import { app } from "./ui-desktop-helpers.tsx";

type Handler = (input: Record<string, unknown>) => unknown;
let calls: { name: string; input: Record<string, unknown> }[] = [];
let routes: Record<string, Handler> = {};
const callsOf = (n: string) => calls.filter((c) => c.name === n);

class FakeES {
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  calls = [];
  routes = { "claude.status": () => ({ installed: true, version: "2.1.0", signedIn: null, exe: "claude" }) };
  resetDoctor();
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
const box = () => screen.getByRole("textbox", { name: /Ask Claude|Ask the documents/ });
const send = (text?: string) => {
  if (text !== undefined) fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Send/ }));
};
const ctxList = [
  { id: "ctx-a", name: "House style", paths: [], files: ["g.pdf"], hasNotes: true },
  { id: "ctx-b", name: "Glossary", paths: ["D:\\Specs"], files: [], hasNotes: false },
];
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
  it("without a test the scope is the whole project, with the project's default contexts", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["claude.run"] = () => ({ ok: true, summary: "Done", durationMs: 1200, changedTests: [], raw: "" });
    const state = withClaude({ contexts: ["ctx-b"] });
    render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
    const change = screen.getByRole("button", { name: "Change every test" });
    expect(change).toBeEnabled();
    fireEvent.click(change);
    const scope = screen.getByRole("group", { name: "Claude scope" });
    expect(within(scope).getByText("Whole project")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Leave Glossary out of this run" })).toBeInTheDocument();
    send("Uniformise les verbes");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toEqual({
      scope: { kind: "project" },
      prompt: "Uniformise les verbes",
      model: "sonnet",
      effort: "medium",
      contexts: ["ctx-b"],
    });
    expect(await screen.findByText("1.2 s · no tokens reported · sonnet / medium")).toBeInTheDocument();
    expect(screen.getAllByText("Whole project")).toHaveLength(2);
    expect(state.setClaudeRunning).toHaveBeenCalledWith("*project*");
  });

  it("a preset fills the box, shows pressed and labels the run; typing deselects it", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = () => ({ effective: ["ctx-a", "ctx-b"], own: null, project: [] });
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
        <ClaudeDock folded={false} onFold={() => {}} />,
      ),
    );
    const [first, second] = screen.getAllByRole("button", { name: "Rephrase" });
    expect(first).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(second);
    expect(box()).toHaveValue("Same label, other prompt");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(box(), { target: { value: "Same label, other prompt!" } });
    expect(second).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(first);
    fireEvent.change(box(), { target: { value: "Rephrase in house style" } });
    fireEvent.click(first);
    expect(callsOf("claude.run")).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Leave Glossary out of this run" }));
    expect(screen.queryByRole("button", { name: "Leave Glossary out of this run" })).toBeNull();
    send();
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({
      scope: { kind: "test", testId: "local-1" },
      prompt: "Rephrase in house style",
      contexts: ["ctx-a"],
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
    render(wrap(withClaude({}, { focus: focus() }), <ClaudeDock folded={false} onFold={() => {}} />));
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
    render(wrap(withClaude({}, { focus: focus() }), <ClaudeDock folded={false} onFold={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({ prompt: "", scope: { kind: "test", testId: "local-1" } });
    expect(screen.getByText(/No request — Claude works from the scope/)).toBeInTheDocument();
    expect(await screen.findByText("Done")).toBeInTheDocument();
    cleanup();
    render(wrap(withClaude({}), <ClaudeDock folded={false} onFold={() => {}} />));
    expect(screen.getByRole("button", { name: "Ask the documents" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Send/ })).toBeDisabled();
  });

  it("on a test: one result card per run, the request kept in the box, the card gone when the test changes", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = () => ({ effective: [], own: null, project: [] });
    let n = 0;
    routes["claude.run"] = () => ({ ok: true, summary: `Answer ${++n}`, runId: `run-${n}`, changedTests: [], raw: "" });
    const state = withClaude({}, { focus: focus() });
    const r = render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
    send("Raccourcis");
    expect(await screen.findByText("Answer 1")).toBeInTheDocument();
    expect(box()).toHaveValue("Raccourcis");
    send();
    expect(await screen.findByText("Answer 2")).toBeInTheDocument();
    expect(screen.queryByText("Answer 1")).toBeNull();
    expect(screen.getAllByText("Raccourcis", { selector: ".bubble" })).toHaveLength(1);
    r.rerender(
      wrap({ ...state, focus: focus({ testId: "local-2" }) }, <ClaudeDock folded={false} onFold={() => {}} />),
    );
    await waitFor(() => expect(screen.queryByText("Answer 2")).toBeNull());
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
    render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
    send("Raccourcis le pas 2");
    await waitFor(() =>
      expect(state.setLastRun).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-9", changedTests: ["local-1"], changedSteps: { "local-1": [2] } }),
      ),
    );
    expect(await screen.findByRole("button", { name: /Revert/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Cancelled/).length).toBeGreaterThan(0);
  });

  it("the per-run context switch resets when the focused test changes", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["contexts.ofTest"] = (i) => ({
      effective: i.testId === "t2" ? ["ctx-b"] : ["ctx-a", "ctx-b"],
      own: null,
      project: [],
    });
    const state = app({ focus: focus() });
    const r = render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
    fireEvent.click(await screen.findByRole("button", { name: "Leave Glossary out of this run" }));
    expect(screen.queryByRole("button", { name: "Leave Glossary out of this run" })).toBeNull();
    r.rerender(wrap({ ...state, focus: focus({ testId: "t2" }) }, <ClaudeDock folded={false} onFold={() => {}} />));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Leave House style out of this run" })).toBeNull());
    expect(screen.getByRole("button", { name: "Leave Glossary out of this run" })).toBeInTheDocument();
  });

  it("switches between step, test and project", async () => {
    routes["claude.run"] = () => ({ ok: true, summary: "ok", changedTests: [], raw: "" });
    render(wrap(app({ focus: focus({ step: 2 }) }), <ClaudeDock folded={false} onFold={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(screen.getByRole("button", { name: "Change every test" }));
    expect(within(screen.getByRole("group", { name: "Claude scope" })).getByText("Whole project")).toBeInTheDocument();
    send("A");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input.scope).toEqual({ kind: "project" });
    fireEvent.click(screen.getByRole("button", { name: "Step 2" }));
    send("B");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(2));
    expect(callsOf("claude.run")[1].input.scope).toEqual({ kind: "step", testId: "local-1", step: 2 });
  });

  it("offers fable, opus, sonnet, haiku and a custom model", async () => {
    routes["chat.ask"] = () => ({ chatId: "c", ok: true, answer: "a", sources: [] });
    render(wrap(app(), <ClaudeDock folded={false} onFold={() => {}} />));
    const model = screen.getByRole("combobox", { name: "Model" });
    expect(
      within(model)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Fable", "Opus", "Sonnet", "Haiku", "custom…"]);
    fireEvent.change(model, { target: { value: "custom" } });
    const custom = screen.getByRole("textbox", { name: "Custom model" });
    fireEvent.change(custom, { target: { value: "claude-opus-4-1" } });
    fireEvent.blur(custom);
    send("Q");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(1));
    expect(callsOf("chat.ask")[0].input).toMatchObject({ model: "claude-opus-4-1" });
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "haiku" } });
    expect(screen.queryByRole("textbox", { name: "Custom model" })).toBeNull();
  });
});

describe("dock: run details and failures", () => {
  it("counts seconds while running, and the folded dock shows the last run", async () => {
    let finish: (v: unknown) => void = () => {};
    routes["claude.run"] = () => new Promise((res) => (finish = res));
    const state = app({ focus: focus() });
    const r = render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
    send("Go");
    expect(await screen.findByTitle("Seconds running")).toHaveTextContent(/\d+\.\d s/);
    await act(async () =>
      finish({ ok: true, summary: "Rewrote step 3\nmore", durationMs: 4500, changedTests: [], raw: "" }),
    );
    expect(await screen.findByText(/^4\.5 s · no tokens reported/)).toBeInTheDocument();
    r.rerender(wrap(state, <ClaudeDock folded onFold={() => {}} />));
    expect(screen.getByText("Last run: 4.5 s — Rewrote step 3")).toHaveAttribute("title", "Rewrote step 3");
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
    render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
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
    expect(callsOf("claude.run")[1].input).toEqual(callsOf("claude.run")[0].input);
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
    const r = render(wrap(state, <ClaudeDock folded={false} onFold={() => {}} />));
    expect(await screen.findByText("Claude is optional — everything else works without it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set the path myself…" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "claude-exe");
    r.rerender(wrap(state, <ClaudeDock folded onFold={() => {}} />));
    expect(screen.getByText("not connected")).toBeInTheDocument();
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
    const r = render(wrap(app(), <ClaudeDock folded={false} onFold={() => {}} />));
    const title = await screen.findByText("Claude isn't signed in on this PC yet");
    const panel = title.closest(".connect") as HTMLElement;
    expect(within(panel).getByText(probe)).toHaveClass("connect-hint");
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
    const heading = await screen.findByText("Claude isn't installed on this PC yet");
    expect(within(heading.closest(".connect") as HTMLElement).getByText("spawn claude ENOENT")).toBeInTheDocument();
  });

  it("meta line words", () => {
    expect(metaLine({ durationMs: 12345, tokens: { input: 900, output: 41 }, model: "opus", effort: "high" })).toBe(
      "12.3 s · 900 tokens in · 41 out · opus / high",
    );
  });
});

describe("contexts dialog", () => {
  it("lists, creates, edits notes (debounced), paths and files, and deletes after a confirm", async () => {
    const store: Record<string, { id: string; name: string; notes: string; paths: string[]; files: string[] }> = {
      "ctx-a": { id: "ctx-a", name: "House style", notes: "", paths: [], files: ["g.pdf"] },
    };
    const detail = (id: string) => ({ ...store[id], hasNotes: !!store[id].notes.trim() });
    routes["contexts.list"] = () => Object.keys(store).map(detail);
    routes["contexts.show"] = (i) => detail(String(i.id));
    routes["contexts.create"] = () => {
      store["ctx-n"] = { id: "ctx-n", name: "New context", notes: "", paths: [], files: [] };
      return detail("ctx-n");
    };
    routes["contexts.set"] = (i) => {
      const c = store[String(i.id)];
      if (i.paths && (i.paths as string[]).some((p) => !/^[A-Z]:\\/.test(p))) throw new Error("Not an absolute path");
      Object.assign(c, Object.fromEntries(Object.entries(i).filter(([k]) => k !== "id")));
      return detail(c.id);
    };
    routes["contexts.addFile"] = (i) => {
      store[String(i.id)].files.push(String(i.name));
      return { ...detail(String(i.id)), added: i.name };
    };
    routes["contexts.removeFile"] = (i) => {
      const c = store[String(i.id)];
      c.files = c.files.filter((f) => f !== i.name);
      return detail(c.id);
    };
    routes["contexts.remove"] = (i) => {
      delete store[String(i.id)];
      return { id: i.id, removed: true };
    };
    const onClose = vi.fn();
    const changed = vi.fn();
    window.addEventListener("testimus:contexts", changed);
    render(<ContextsDialog onClose={onClose} initialId="ctx-a" />);
    expect(await screen.findByRole("option", { name: /House style/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("1 file")).toBeInTheDocument();
    const notes = await screen.findByRole("textbox", { name: /Notes/ });
    fireEvent.change(notes, { target: { value: "Une action par pas." } });
    expect(callsOf("contexts.set")).toHaveLength(0);
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(1), { timeout: 1500 });
    expect(callsOf("contexts.set")[0].input).toEqual({
      id: "ctx-a",
      name: "House style",
      notes: "Une action par pas.",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Style" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Name" }));
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(2));
    expect(await screen.findByText("1 file · notes")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Style/ })).toBeInTheDocument();
    const path = screen.getByRole("textbox", { name: "Path to add" });
    fireEvent.change(path, { target: { value: "D:\\Specs\\J5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("D:\\Specs\\J5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browse folder…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove path D:\\Specs\\J5" }));
    await waitFor(() => expect(screen.queryByText("D:\\Specs\\J5")).toBeNull());
    const input = screen.getByLabelText("Files to add");
    fireEvent.change(input, { target: { files: [new File(["hello"], "plan.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("plan.txt")).toBeInTheDocument();
    expect(callsOf("contexts.addFile")[0].input).toEqual({
      id: "ctx-a",
      name: "plan.txt",
      dataBase64: Buffer.from("hello").toString("base64"),
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove file g.pdf" }));
    await waitFor(() => expect(screen.queryByText("g.pdf")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "New context" }));
    expect(await screen.findByRole("option", { name: /New context/ })).toHaveAttribute("aria-selected", "true");
    expect(callsOf("contexts.create")[0].input).toEqual({ shared: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete context" }));
    await waitFor(() => expect(callsOf("contexts.remove")).toHaveLength(1));
    expect(await screen.findByRole("option", { name: /Style/ })).toHaveAttribute("aria-selected", "true");
    expect(changed).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    window.removeEventListener("testimus:contexts", changed);
  });

  it("flushes typed notes when it closes, and browses a folder in the desktop app", async () => {
    const d = desktop();
    routes["contexts.list"] = () => [{ id: "ctx-a", name: "A", paths: [], files: [], hasNotes: false }];
    routes["contexts.show"] = () => ({ id: "ctx-a", name: "A", paths: [], files: [], hasNotes: false, notes: "" });
    routes["contexts.set"] = (i) => ({
      id: "ctx-a",
      name: "A",
      paths: i.paths ?? [],
      files: [],
      hasNotes: false,
      notes: "",
    });
    const r = render(<ContextsDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Browse folder…" }));
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(1));
    expect(d.pickFolder).toHaveBeenCalled();
    expect(callsOf("contexts.set")[0].input).toEqual({ id: "ctx-a", paths: ["D:\\Picked"] });
    fireEvent.change(screen.getByRole("textbox", { name: /Notes/ }), { target: { value: "x" } });
    r.unmount();
    await waitFor(() => expect(callsOf("contexts.set")).toHaveLength(2));
    expect(callsOf("contexts.set")[1].input).toMatchObject({ notes: "x" });
  });

  it("copies a context from another project and opens the copy", async () => {
    const mine: { id: string; name: string; paths: string[]; files: string[]; hasNotes: boolean }[] = [
      { id: "ctx-a", name: "A", paths: [], files: [], hasNotes: false },
    ];
    routes["contexts.list"] = (i) =>
      i.from ? [{ id: "ctx-g", name: "Glossaire", paths: [], files: ["g.txt"], hasNotes: true }] : mine;
    routes["contexts.show"] = (i) => ({ ...(mine.find((c) => c.id === i.id) ?? mine[0]), notes: "" });
    routes["project.list"] = () => ({
      last: "",
      projects: [
        { dir: "D:\\Other", name: "Other", jiraProject: "BHPTCC", exists: true },
        { dir: "D:\\Gone", name: "Gone", jiraProject: "X", exists: false },
      ],
    });
    routes["contexts.copy"] = (i) => {
      mine.push({ id: "ctx-g", name: "Glossaire", paths: [], files: ["g.txt"], hasNotes: true });
      return { ...mine[1], notes: "", from: i.from };
    };
    render(<ContextsDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy from another project…" }));
    const pick = await screen.findByRole("combobox", { name: "Project to copy from" });
    expect(within(pick).queryByRole("option", { name: "Gone" })).toBeNull();
    fireEvent.change(pick, { target: { value: "D:\\Other" } });
    const ctx = await screen.findByRole("combobox", { name: "Context to copy" });
    expect(ctx).toHaveValue("ctx-g");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(callsOf("contexts.copy")[0]?.input).toEqual({ from: "D:\\Other", id: "ctx-g" }));
    expect(await screen.findByRole("option", { name: /Glossaire/, selected: true })).toBeVisible();
  });

  it("moves a context into the shared library and says so before deleting it", async () => {
    let shared = false;
    const one = () => ({ id: "ctx-a", name: "A", paths: [], files: [], hasNotes: false, shared });
    routes["contexts.list"] = () => [one()];
    routes["contexts.show"] = () => ({ ...one(), notes: "" });
    routes["contexts.share"] = (i) => {
      shared = i.shared === true;
      return { ...one(), notes: "" };
    };
    render(<ContextsDialog onClose={() => {}} />);
    const box = await screen.findByRole("checkbox", { name: /Shared with every project/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(callsOf("contexts.share")[0].input).toEqual({ id: "ctx-a", shared: true });
    expect(screen.getByRole("option", { name: /shared · empty/ })).toBeVisible();
    expect(screen.getByText("shared library · ctx-a/")).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete context" })).toHaveAttribute(
      "title",
      "Deleted for every project",
    );
  });

  it("says what a context holds", () => {
    expect(contextLine({ files: ["a", "b"], paths: ["p"], hasNotes: true })).toBe("2 files · 1 path · notes");
    expect(contextLine({ files: [], paths: [], hasNotes: false })).toBe("empty");
  });
});

describe("settings › Claude", () => {
  it("toggles default contexts by name, edits quick asks in place, removes by index", async () => {
    routes["contexts.list"] = () => ctxList;
    routes["project.set"] = (i) => i;
    const presets = [
      { label: "Same", prompt: "one" },
      { label: "Same", prompt: "two" },
    ];
    render(wrap(withClaude({ presets, contexts: ["ctx-a"] }), <ClaudeSection />));
    const group = await screen.findByRole("group", { name: "Default contexts" });
    expect(within(group).getByRole("button", { name: "House style" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Glossary" }));
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(1));
    expect(callsOf("project.set")[0].input).toEqual({ claude: { contexts: ["ctx-a", "ctx-b"] } });
    const label = screen.getByRole("textbox", { name: "Quick ask 2 label" });
    fireEvent.change(label, { target: { value: "Other" } });
    fireEvent.blur(label);
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(2));
    expect(callsOf("project.set")[1].input).toEqual({
      claude: {
        presets: [
          { label: "Same", prompt: "one" },
          { label: "Other", prompt: "two" },
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove quick ask 1" }));
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(3));
    expect(callsOf("project.set")[2].input).toEqual({ claude: { presets: [{ label: "Same", prompt: "two" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    expect(await screen.findByRole("dialog", { name: "Contexts" })).toBeInTheDocument();
  });

  it("the model can be a custom one", async () => {
    routes["project.set"] = (i) => i;
    render(wrap(withClaude({ model: "claude-opus-4-1" }), <ClaudeSection />));
    expect(screen.getByLabelText("Default model")).toHaveValue("custom");
    expect(screen.getByRole("textbox", { name: "Custom model" })).toHaveValue("claude-opus-4-1");
    fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "fable" } });
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(1));
    expect(callsOf("project.set")[0].input).toEqual({ claude: { model: "fable" } });
  });

  it("checks the Claude program and shows how to connect it when not found", async () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    routes["system.saveSettings"] = (i) => ({ claude: { exe: i.claudeExe }, models: { allowRemote: true } });
    render(wrap(app({ info: null }), <ClaudeSection />));
    expect(await screen.findByText("✓ 2.1.0 · found")).toBeInTheDocument();
    routes["claude.status"] = (i) => {
      expect(i).toEqual({ refresh: true });
      return { installed: false, signedIn: false, exe: "C:\\x\\claude.cmd", detail: "spawn ENOENT" };
    };
    const field = screen.getByLabelText("Claude program");
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    fireEvent.change(field, { target: { value: "C:\\x\\claude.cmd" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("✕ spawn ENOENT · not found · Claude is optional")).toBeInTheDocument();
    expect(callsOf("system.saveSettings")[0].input).toEqual({ claudeExe: "C:\\x\\claude.cmd" });
    expect(screen.getByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
    expect(exeLine({ installed: true, signedIn: null })).toBe("✓ Claude Code · found");
  });

  it("a Claude program path typed but not blurred is saved when Settings goes, once, as in Xray Editor", async () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    routes["system.saveSettings"] = (i) => ({ claude: { exe: i.claudeExe }, models: { allowRemote: true } });
    const r = render(wrap(app({ info: null }), <ClaudeSection />));
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(1));
    await screen.findByText("✓ 2.1.0 · found");
    fireEvent.change(screen.getByLabelText("Claude program"), { target: { value: "D:\\tools\\claude.cmd" } });
    expect(callsOf("system.saveSettings")).toHaveLength(0);
    r.unmount();
    await waitFor(() => expect(callsOf("system.saveSettings")).toHaveLength(1));
    expect(callsOf("system.saveSettings")[0].input).toEqual({ claudeExe: "D:\\tools\\claude.cmd" });
    const again = render(wrap(app({ info: null }), <ClaudeSection />));
    await waitFor(() => expect(callsOf("system.settings")).toHaveLength(2));
    again.unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(callsOf("system.saveSettings")).toHaveLength(1);
  });
});

describe("settings screen, notes, appearance", () => {
  it("shows the version beside the title, and opens on the Claude program field", () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    render(wrap(app({ info: null, route: { screen: "settings", arg: "claude-exe" } }), <SettingsScreen />));
    expect(screen.getByText(`v${__VERSION__}`)).toHaveClass("version-pill");
    expect(screen.getByLabelText("Claude program")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Claude" })).toHaveAttribute("aria-current", "true");
  });

  it("project notes: read, saved 400 ms after typing, flushed on blur", async () => {
    routes["project.notes"] = () => ({ file: "C:\\p\\CLAUDE.md", text: "# Notes" });
    routes["project.setNotes"] = (i) => ({ file: "C:\\p\\CLAUDE.md", bytes: String(i.text).length });
    render(wrap(app(), <ProjectSection />));
    const area = screen.getByLabelText("Project notes");
    await waitFor(() => expect(area).toHaveValue("# Notes"));
    expect(screen.getByText("C:\\p\\CLAUDE.md")).toBeInTheDocument();
    fireEvent.change(area, { target: { value: "# Notes\nPCC" } });
    expect(callsOf("project.setNotes")).toHaveLength(0);
    await waitFor(() => expect(callsOf("project.setNotes")).toHaveLength(1), { timeout: 1500 });
    expect(callsOf("project.setNotes")[0].input).toEqual({ text: "# Notes\nPCC" });
    fireEvent.change(area, { target: { value: "# Notes\nPCC\nSAE" } });
    fireEvent.blur(area);
    await waitFor(() => expect(callsOf("project.setNotes")).toHaveLength(2));
    expect(callsOf("project.setNotes")[1].input).toEqual({ text: "# Notes\nPCC\nSAE" });
  });

  it("a Jira project key and a label prefix typed but not blurred are saved when Settings goes", async () => {
    routes["project.notes"] = () => ({ file: "C:\\p\\CLAUDE.md", text: "" });
    routes["project.set"] = (i) => i;
    const state = app();
    const r = render(wrap(state, <ProjectSection />));
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: "bhptcc" } });
    fireEvent.change(screen.getByLabelText("Review label prefix"), { target: { value: "tm-" } });
    expect(callsOf("project.set")).toHaveLength(0);
    r.unmount();
    await waitFor(() => expect(callsOf("project.set")).toHaveLength(2));
    expect(callsOf("project.set").map((c) => c.input)).toEqual([{ jiraProject: "BHPTCC" }, { labelPrefix: "tm-" }]);
    const again = render(wrap(state, <ProjectSection />));
    fireEvent.blur(screen.getByLabelText("Jira project"));
    again.unmount();
    await new Promise((res) => setTimeout(res, 20));
    expect(callsOf("project.set")).toHaveLength(2);
  });

  it("always on top: hidden in the browser, a switch and a pin in the desktop app, remembered", async () => {
    routes["system.settings"] = () => ({ claude: { exe: "" }, models: { allowRemote: true } });
    const r = render(wrap(app(), <AppearanceSection />));
    expect(screen.queryByRole("switch")).toBeNull();
    r.unmount();
    const d = desktop();
    render(
      wrap(
        app(),
        <>
          <AppearanceSection />
          <ClaudeDock folded onFold={() => {}} />
        </>,
      ),
    );
    const sw = screen.getByRole("switch", { name: /Always on top/ });
    const pin = screen.getByRole("button", { name: "Always on top" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(pin).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(d.setAlwaysOnTop).toHaveBeenCalledWith(true));
    expect(localStorage.getItem("testimus.alwaysOnTop")).toBe("true");
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

const creds = (jira: Partial<CredsStatus["jira"]> = {}, xray: Partial<CredsStatus["xray"]> = {}): CredsStatus => ({
  jira: { file: "C:\\Users\\me\\.atlassian\\credentials.json", exists: true, complete: true, ...jira },
  xray: { file: "C:\\Users\\me\\.atlassian\\xray_credentials.json", exists: true, complete: true, ...xray },
});
const check = (id: string, state: DoctorCheck["state"], detail: string): DoctorCheck => ({
  id,
  label: id,
  state,
  detail,
});

describe("access: files and the guided connection", () => {
  it("reduces what people paste to the site root and previews what is saved", () => {
    expect(siteRoot("transurb")).toBe("https://transurb.atlassian.net");
    expect(siteRoot(" transurb.atlassian.net ")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("https://transurb.atlassian.net/browse/X-1?focus=1")).toBe("https://transurb.atlassian.net");
    expect(siteRoot("https://transurb.atlassian.net/wiki/spaces/A")).toBe("https://transurb.atlassian.net/wiki");
    expect(siteRoot("")).toBe("");
    expect(savedAs("https://transurb.atlassian.net")).toBe("https://transurb.atlassian.net");
    expect(savedAs("https://transurb.atlassian.net", "https://transurb.atlassian.net/wiki")).toBe(
      "https://transurb.atlassian.net/wiki",
    );
    expect(savedAs("https://jira.example.com")).toBe("https://jira.example.com");
    expect(fileState({ file: "f", exists: false, complete: false })).toBe("missing");
    expect(fileState({ file: "f", exists: true, complete: false, invalid: true })).toBe("invalid");
    expect(fileState({ file: "f", exists: true, complete: true })).toBe("found");
  });

  it("answers in words per service", () => {
    expect(jiraWords(check("jira", "ok", "Sébastien Genin on transurb.atlassian.net"))).toEqual({
      ok: true,
      text: "Connected as Sébastien Genin",
    });
    expect(jiraWords(check("jira", "fail", "Jira 401 — check ~/.atlassian/credentials.json")).text).toMatch(
      /refused this email and token.*scopes does not work/,
    );
    expect(jiraWords(check("jira", "fail", "Jira 404 on x.atlassian.net")).text).toMatch(
      /^No Jira Cloud site at that address/,
    );
    expect(jiraWords(check("jira", "fail", "x.atlassian.net unreachable: getaddrinfo ENOTFOUND")).text).toMatch(
      /^No Jira Cloud site/,
    );
    expect(jiraWords(undefined).text).toBe("Fill in the site, the email and the API token first.");
    expect(jiraWords(check("jira", "fail", "~/.atlassian/credentials.json needs baseUrl, email and token.")).ok).toBe(
      false,
    );
    expect(xrayWords(check("xray", "ok", "authenticated"))).toEqual({ ok: true, text: "Key accepted" });
    expect(xrayWords(check("xray", "fail", "Xray 401 — check")).text).toMatch(/secret is shown only once/);
    expect(xrayWords(check("xray", "fail", "Missing ~/.atlassian/xray_credentials.json.")).text).toBe(
      "Fill in the Client ID and the Client Secret first.",
    );
    expect(xrayWords(check("xray", "fail", "xray.cloud.getxray.app unreachable: timeout")).text).toMatch(
      /did not answer/,
    );
  });

  it("lists both files, then saves and tests with words, secrets hidden by default", async () => {
    const d = desktop();
    let st = creds(
      { baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" },
      { complete: false, invalid: true, problem: "missing clientSecret" },
    );
    routes["system.setup"] = (i) => {
      if (Object.keys(i).length === 0) return { status: st, saved: [], checks: [], ok: false };
      st = creds({ baseUrl: "https://transurb.atlassian.net/wiki", email: "me@acme.fr" });
      return {
        status: st,
        saved: ["baseUrl", "clientSecret"],
        checks: [check("jira", "fail", "Jira 401 — check"), check("xray", "ok", "authenticated on xray")],
        ok: false,
      };
    };
    routes["system.doctor"] = () => ({ checks: [] });
    routes["system.secrets"] = () => ({ token: "tok-1", clientId: "cid-1", clientSecret: "" });
    render(wrap(app(), <AccessSection />));
    expect(await screen.findByText("found · valid")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("API token")).toHaveValue("tok-1"));
    expect(screen.getByLabelText("Client ID")).toHaveValue("cid-1");
    expect(screen.getByText("invalid — missing clientSecret")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\me\\.atlassian\\xray_credentials.json")).toBeInTheDocument();
    const site = screen.getByLabelText("Jira site");
    expect(site).toHaveValue("https://acme.atlassian.net/wiki");
    fireEvent.change(site, { target: { value: "https://transurb.atlassian.net/browse/LFRPS12-1" } });
    expect(screen.getByText("https://transurb.atlassian.net")).toBeInTheDocument();
    expect(screen.getByText(/Will be saved as/)).toBeInTheDocument();
    const secret = screen.getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show secrets" }));
    expect(secret).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide secrets" }));
    fireEvent.click(screen.getByRole("button", { name: "Open API tokens" }));
    expect(d.openExternal).toHaveBeenCalledWith("https://id.atlassian.com/manage-profile/security/api-tokens");
    fireEvent.click(screen.getByRole("button", { name: "Open Jira apps" }));
    expect(d.openExternal).toHaveBeenLastCalledWith("https://transurb.atlassian.net/plugins/servlet/upm");
    expect(screen.getByText(/Create API token/)).toBeInTheDocument();
    expect(screen.getByText(/only a Jira admin sees that page/i)).toBeInTheDocument();
    fireEvent.change(secret, { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    expect(await screen.findByText(/Jira refused this email and token/)).toBeInTheDocument();
    expect(screen.getByText("Key accepted")).toBeInTheDocument();
    expect(callsOf("system.setup")[1].input).toEqual({
      check: true,
      site: "https://transurb.atlassian.net",
      clientSecret: "s3cret",
    });
    expect(secret).toHaveValue("s3cret");
    expect(screen.getAllByText("found · valid")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Saved in/ }));
    expect(d.reveal).toHaveBeenCalledWith("C:\\Users\\me\\.atlassian");
  });

  it("erases a saved secret the user empties", async () => {
    routes["system.setup"] = () => ({
      status: creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" }),
      saved: [],
      checks: [],
      ok: true,
    });
    routes["system.secrets"] = () => ({ token: "tok-1", clientId: "cid-1", clientSecret: "sec-1" });
    routes["system.doctor"] = () => ({ checks: [] });
    render(wrap(app(), <AccessSection />));
    await waitFor(() => expect(screen.getByLabelText("Client ID")).toHaveValue("cid-1"));
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(callsOf("system.setup")).toHaveLength(2));
    expect(callsOf("system.setup")[1].input).toEqual({ check: true, clear: ["clientId"] });
  });

  it("saves a site outside atlassian.net as given, as Xray Editor does", async () => {
    routes["system.setup"] = (i) =>
      Object.keys(i).length === 0
        ? {
            status: creds({ baseUrl: "https://acme.atlassian.net/wiki", email: "me@acme.fr" }),
            saved: [],
            checks: [],
            ok: true,
          }
        : {
            status: creds({ baseUrl: "https://jira.acme.com", email: "me@acme.fr" }),
            saved: ["baseUrl"],
            checks: [],
            ok: true,
          };
    routes["system.doctor"] = () => ({ checks: [] });
    render(wrap(app(), <AccessSection />));
    const site = await screen.findByLabelText("Jira site");
    fireEvent.change(site, { target: { value: "https://jira.acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test the connection" }));
    await waitFor(() => expect(callsOf("system.setup")).toHaveLength(2));
    expect(callsOf("system.setup")[1].input).toMatchObject({ site: "https://jira.acme.com", otherHost: true });
  });

  it("without the desktop app the links open a new tab and the folder is plain text", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    routes["system.setup"] = () => ({
      status: creds({}, { exists: false, complete: false }),
      saved: [],
      checks: [],
      ok: false,
    });
    render(wrap(app(), <AccessSection />));
    expect(await screen.findByText("missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open API tokens" }));
    expect(open).toHaveBeenCalledWith(
      "https://id.atlassian.com/manage-profile/security/api-tokens",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.queryByRole("button", { name: /Saved in/ })).toBeNull();
    expect(screen.getByText(/Saved in/)).toBeInTheDocument();
  });
});
