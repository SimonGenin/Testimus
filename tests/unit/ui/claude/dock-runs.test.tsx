// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { ClaudeDock, type DockRequest, metaLine } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { dockState } from "../../../../src/ui/components/claude/dockState.ts";
import { AppContext, type AppState, type Focus } from "../../../../src/ui/lib/app.ts";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { callsOf, dataWrapper, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
});

afterEach(() => {
  cleanup();
  clearDrafts();
  vi.unstubAllGlobals();
  setProject(null);
});

type Props = { request?: DockRequest | null };

function mount(props: Props = {}, over: Partial<AppState> = {}) {
  const state = app(over);
  let current: Props = { ...props };
  const ui = () => (
    <AppContext.Provider value={{ ...state }}>
      <ClaudeDock request={current.request} />
    </AppContext.Provider>
  );
  const r = render(ui());
  return {
    state,
    update: (p: Props) => {
      current = { ...current, ...p };
      r.rerender(ui());
    },
  };
}

const focus = (o: Partial<Focus> = {}): Focus => ({ testId: "local-1", summary: "T", step: null, ...o });
const box = () => screen.getByRole("textbox", { name: /^Ask/ });
const ask = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
};
const claude = (c: Partial<NonNullable<AppState["info"]>["project"]["claude"]>, dir?: string): Partial<AppState> => {
  const base = app().info as NonNullable<AppState["info"]>;
  return {
    info: {
      ...base,
      ...(dir === undefined ? {} : { dir }),
      project: { ...base.project, claude: { ...base.project.claude, ...c } },
    },
  } as Partial<AppState>;
};

describe("dock run details", () => {
  it("names the default model in the timing line", () => {
    expect(metaLine({ durationMs: 1234, model: "", effort: "low" })).toBe("1.2 s · no tokens reported · default / low");
    expect(
      metaLine({
        durationMs: 500,
        tokens: { input: 18412, output: 640 },
        sessionId: "abcdef123456",
        model: "opus",
        effort: "max",
      }),
    ).toBe("0.5 s · 18k tokens in · 640 out · opus / max · session abcdef12…");
    expect(metaLine({ durationMs: 500, tokens: { input: 2345, output: 0 }, model: "m", effort: "low" })).toBe(
      "0.5 s · 2.3k tokens in · 0 out · m / low",
    );
  });

  it("sends no model when the project names none, and copes with an answer without text", async () => {
    net.routes["claude.run"] = () => ({ ok: true });
    mount({}, claude({ model: "" }));
    ask("Q");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("model");
    await waitFor(() => expect(screen.getByRole("button", { name: /Send/ })).toBeInTheDocument());
  });

  it("shows a failed run's raw output, even when empty, and tells Claude's tab the last run failed", async () => {
    net.routes["claude.run"] = () => ({ ok: false, raw: "", changedTests: [] });
    mount({}, { focus: focus(), ...claude({ model: "" }) });
    ask("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("model");
    fireEvent.click(await screen.findByRole("button", { name: "Show raw output" }));
    expect(screen.getByText("(no output)")).toBeInTheDocument();
    expect(dockState().failed).toBe(true);
  });

  it("runs on the whole project and shows the changes on the first changed test", async () => {
    net.routes["claude.run"] = () => ({ ok: true, runId: "r1", changedTests: ["t9"], changedSteps: { t9: [1] } });
    const { state } = mount({}, { focus: null, ...claude({ contexts: undefined }) });
    ask("Tout");
    fireEvent.click(await screen.findByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t9");
  });

  it("shows the tests list when a project run names no test", async () => {
    net.routes["claude.run"] = () => ({ ok: true, runId: "r2", changedSteps: [3] });
    const { state } = mount({}, { focus: null });
    ask("Tout");
    fireEvent.click(await screen.findByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("tests");
  });

  it("runs a job handed by the app without a project read", async () => {
    net.routes["review.fix"] = () => ({ ok: true, summary: "ok" });
    mount(
      {
        request: {
          mode: "test",
          nonce: 1,
          job: { name: "review.fix", input: {}, label: "Fix", testId: "local-1" },
        },
      },
      { info: null, focus: focus() },
    );
    expect(await screen.findByText("ok")).toBeInTheDocument();
  });

  it("shows a run asked from a step's popover as its request under its scope, with the model it was asked with", async () => {
    net.routes["claude.run"] = () => ({ ok: true, summary: "done", durationMs: 1000 });
    mount(
      {
        request: {
          mode: "test",
          nonce: 1,
          job: {
            name: "claude.run",
            input: {
              scope: { kind: "step", testId: "local-1", step: 2 },
              prompt: "Cite §5.6",
              model: "haiku",
              effort: "low",
            },
            label: "Step 2",
            text: "Cite §5.6",
            testId: "local-1",
          },
        },
      },
      { focus: focus() },
    );
    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Request · Step 2" })).toHaveTextContent("Cite §5.6");
    expect(screen.getByText(/haiku \/ low/)).toBeInTheDocument();
  });
});

describe("dock contexts", () => {
  const pieces = () => [
    piece("instruction", "Ask Claude on a test"),
    piece("context:g", "Glossaire", { why: "A default of the project" }),
  ];
  const context = () => screen.getByRole("button", { name: /^Context/ });
  const graph = async () => {
    fireEvent.click(context());
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    await within(dialog).findByRole("group", { name: "What Claude is given" });
    return dialog;
  };
  const done = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

  it("lets a run leave a context out and take it back, with no separate note", async () => {
    let given = pieces();
    net.routes["claude.preview"] = (i) => previewOf(given, i);
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    mount({}, { focus: focus() });
    await waitFor(() => expect(context()).toHaveTextContent(/^Context2$/));
    expect(callsOf("claude.preview")[0].input).toEqual({ use: "ask-test", scope: { kind: "test", testId: "local-1" } });
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
    const first = await graph();
    const glossaire = () => within(first).getByRole("checkbox", { name: "Glossaire" });
    expect(glossaire()).toBeChecked();
    fireEvent.click(glossaire());
    await waitFor(() => expect(glossaire()).not.toBeChecked());
    expect(within(first).queryByRole("checkbox", { name: /note/i })).toBeNull();
    expect(within(first).getByRole("button", { name: "Save the text as a context…" })).toBeDisabled();
    done(first);
    expect(context()).toHaveTextContent(/^Context1 · changed$/);
    ask("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toEqual({
      scope: { kind: "test", testId: "local-1" },
      prompt: "Go",
      model: "sonnet",
      effort: "medium",
      without: ["context:g"],
    });
    await screen.findByText("ok");
    given = pieces();
    const again = await graph();
    fireEvent.click(within(again).getByRole("checkbox", { name: "Glossaire" }));
    await waitFor(() => expect(within(again).getByRole("checkbox", { name: "Glossaire" })).toBeChecked());
    done(again);
    ask("Again");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(2));
    expect(callsOf("claude.run")[1].input).not.toHaveProperty("without");
    expect(callsOf("claude.run")[1].input).not.toHaveProperty("contexts");
    expect(callsOf("claude.run")[1].input).not.toHaveProperty("note");
  });

  it("saves what is written in the box as a context and takes it for the run", async () => {
    const given = [piece("instruction", "Ask Claude on a test")];
    net.routes["claude.preview"] = (i) => previewOf(given, i);
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    net.routes["contexts.create"] = (i) => {
      given.push(piece("context:pcc", String(i.name), { on: false }));
      return { id: "pcc", name: i.name, notes: i.notes, paths: [], files: [], hasNotes: true };
    };
    mount({}, { focus: focus() });
    fireEvent.change(await screen.findByRole("textbox", { name: /^Ask/ }), { target: { value: "PCC means Poste" } });
    const dialog = await graph();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the text as a context…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Save as context" })).getByRole("button", { name: "Save" }),
    );
    await waitFor(() => expect(callsOf("contexts.create")).toHaveLength(1));
    expect(callsOf("contexts.create")[0].input).toMatchObject({ name: "PCC means Poste", notes: "PCC means Poste" });
    await waitFor(() => expect(box()).toHaveValue(""));
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: "PCC means Poste" })).toBeChecked());
    done(dialog);
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({ prompt: "", contexts: ["pcc"] });
  });

  it("a question to the documents is the chat's request; the panel's exchanges are part of what the next one is given", async () => {
    net.routes["claude.preview"] = (i) => previewOf([piece("instruction", "Ask the documents")], i);
    net.routes["claude.run"] = () => ({ ok: true, summary: "Fait" });
    mount({}, { focus: null });
    await waitFor(() => expect(context()).toHaveTextContent(/^Context1$/));
    expect(callsOf("claude.preview")[0].input).toEqual({ use: "ask-project", scope: { kind: "project" } });
    ask("Uniformise");
    await screen.findByText("Fait");
    expect(context()).toHaveTextContent(/^Context3$/);
    fireEvent.click(screen.getByRole("tab", { name: /Documents/ }));
    await waitFor(() => expect(callsOf("claude.preview").at(-1)?.input).toEqual({ use: "chat" }));
    const dialog = await graph();
    await within(dialog).findByRole("group", { name: "Your words" });
    expect(callsOf("claude.preview").at(-1)?.input).toEqual({
      use: "chat",
      note: "Uniformise",
      conversation: "User (Whole project): Uniformise\n\nClaude: Fait",
    });
    expect(within(dialog).getByRole("group", { name: "Your words" })).toHaveTextContent("The conversation so far");
  });

  it("when what the run is given cannot be read, the run goes as it is: nothing of its own is sent", async () => {
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    mount({}, { focus: focus() });
    await waitFor(() => expect(callsOf("claude.preview")).toHaveLength(1));
    expect(context()).toHaveTextContent(/^Context$/);
    ask("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("contexts");
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("without");
  });

  it("asks nothing about a run while no project is open", async () => {
    mount({}, { info: null, focus: focus() });
    await act(async () => {});
    expect(callsOf("claude.preview")).toHaveLength(0);
  });
});
