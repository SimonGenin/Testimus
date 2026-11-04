// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import {
  ClaudeDock,
  type DockRequest,
  fixOutcome,
  toolLabel,
} from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { AppContext, type AppState, type Focus } from "../../../../src/ui/lib/app.ts";
import { setFlushHook } from "../../../../src/ui/lib/data/query.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, dataWrapper, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

let toastIds: number[] = [];
function ToastProbe() {
  toastIds = useToasts().map((t) => t.id);
  return <Toaster />;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
});

afterEach(() => {
  act(() => {
    for (const id of toastIds) closeToast(id, true);
  });
  cleanup();
  vi.unstubAllGlobals();
  setFlushHook(async () => null);
  setProject(null);
});

type Props = { folded?: boolean; request?: DockRequest | null };

function mount(props: Props = {}, over: Partial<AppState> = {}) {
  const state = app(over);
  const onFold = vi.fn();
  let current: Props = { folded: false, ...props };
  const ui = () => (
    <AppContext.Provider value={{ ...state }}>
      <ClaudeDock folded={!!current.folded} request={current.request} onFold={onFold} />
      <ToastProbe />
    </AppContext.Provider>
  );
  const r = render(ui());
  return {
    state,
    onFold,
    update: (p: Props = {}, more: Partial<AppState> = {}) => {
      current = { ...current, ...p };
      Object.assign(state, more);
      r.rerender(ui());
    },
  };
}

const box = () => screen.getByRole("textbox", { name: /^Ask/ });
const ask = (text: string, key: Record<string, unknown> = {}) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true, ...key });
};

const focus = (o: Partial<Focus> = {}): Focus => ({ testId: "local-1", summary: "Test", step: null, ...o });

const withClaude = (claude: Partial<NonNullable<AppState["info"]>["project"]["claude"]>) => {
  const base = app().info as NonNullable<AppState["info"]>;
  return {
    info: { ...base, project: { ...base.project, claude: { ...base.project.claude, ...claude } } },
  } as Partial<AppState>;
};

describe("dock helpers", () => {
  it("names each tool use in plain words", () => {
    expect(toolLabel("mcp__testimus__rag_search", '{"query":"alarme"}')).toBe("Searched the documents for “alarme”");
    expect(toolLabel("mcp__testimus__rag_search", '{"question":"menu"}')).toBe("Searched the documents for “menu”");
    expect(toolLabel("mcp__testimus__rag_search", "{}")).toBe("Used rag.search");
    expect(toolLabel("mcp__testimus__rag_passage", '{"docId":"D","anchor":"§1"}')).toBe("Read D §1");
    expect(toolLabel("mcp__testimus__rag_passage", '{"docId":"D"}')).toBe("Read D ");
    expect(toolLabel("Read", '{"file_path":"tests/a.md"}')).toBe("Read tests/a.md");
    expect(toolLabel("Glob", '{"pattern":"**/*.md"}')).toBe("Read **/*.md");
    expect(toolLabel("Grep", "not json")).toBe("Read");
    expect(toolLabel("Edit", '{"file_path":"C:\\\\p\\\\tests\\\\x\\\\test.md"}')).toBe("Edited x/test.md");
    expect(toolLabel("Write", "{}")).toBe("Edited a file");
    expect(toolLabel("WebFetch", "{}")).toBe("Used WebFetch");
  });

  it("says how a fix ended", () => {
    expect(fixOutcome({})).toEqual({ word: "check queued" });
    expect(fixOutcome({ review: "checked" })).toEqual({ word: "checked again" });
    expect(fixOutcome({ review: "to-fix" }).note).toBe("The test did not go back to Checked.");
    expect(fixOutcome({ review: "to-fix", message: "Step 2 still has no source" }).note).toBe(
      "Step 2 still has no source",
    );
  });
});

const onDoc: Partial<AppState> = { route: { screen: "documents", arg: "D" } };

describe("Claude dock: asking the documents", () => {
  it("streams an answer with its tools and sources, and continues the same chat", async () => {
    net.routes["chat.ask"] = () => ({ jobId: "c1" });
    net.routes["jobs.show"] = () => ({ job: job({ id: "c1", kind: "chat" }) });
    const { state } = mount({}, onDoc);
    expect(screen.getByText("Ask anything about D")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ask/ })).toBeDisabled();
    ask("Quel menu ?");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(1));
    expect(callsOf("chat.ask")[0].input).toEqual({
      question: "Quel menu ?",
      model: "sonnet",
      effort: "medium",
      note: "The question is about the document D: answer from docs/D/doc.md first.",
    });
    expect(screen.getByText("Quel menu ?")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("button", { name: /Cancel/ })).toBeEnabled());
    act(() => {
      FakeES.emit({ jobId: "c1", at: "", type: "progress", message: "x" });
      FakeES.emit({ jobId: "c1", at: "", type: "claude", event: { type: "tool", name: "Read", input: "{}" } });
      FakeES.emit({ jobId: "c1", at: "", type: "claude", event: { type: "text", text: "Le menu " } });
      FakeES.emit({
        jobId: "c1",
        at: "",
        type: "claude",
        event: { type: "tool", name: "mcp__testimus__rag_search", input: '{"query":"menu"}' },
      });
      FakeES.emit({ jobId: "c1", at: "", type: "claude", event: { type: "stderr", text: "noise" } });
    });
    expect(screen.getByText(/Le menu/)).toBeInTheDocument();
    expect(screen.getByText(/Searched the documents for “menu”/)).toHaveTextContent("…");
    act(() =>
      FakeES.emit(
        status(
          job({
            id: "c1",
            status: "done",
            result: {
              chatId: "chat-1",
              ok: true,
              answer: 'Propriétés seulement D#§5.6 "ne propose que"',
              sources: [{ docId: "D", anchor: "§5.6", quote: "ne propose que" }],
            },
          }),
        ),
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /Ask/ })).toBeInTheDocument());
    const chips = screen.getAllByRole("button", { name: /D §5.6/ });
    fireEvent.click(chips[chips.length - 1]);
    expect(state.openSource).toHaveBeenCalledWith({ docId: "D", anchor: "§5.6", quote: "ne propose que" });
    net.routes["chat.ask"] = () => ({ chatId: undefined, answer: "" });
    ask("Et ensuite ?");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(2));
    expect(callsOf("chat.ask")[1].input.chatId).toBe("chat-1");
    await waitFor(() => expect(screen.getByRole("button", { name: /Ask/ })).toBeInTheDocument());
    ask("Encore ?");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(3));
    expect(callsOf("chat.ask")[2].input.chatId).toBe("chat-1");
  });

  it("shows why Claude could not answer and checks the sign-in again", async () => {
    net.routes["chat.ask"] = () => ({
      chatId: "c",
      ok: false,
      answer: "",
      diagnosis: { kind: "login", title: "Claude is signed out", detail: "Run claude /login" },
    });
    mount({}, onDoc);
    await waitFor(() => expect(callsOf("claude.status")).toHaveLength(1));
    ask("Q");
    expect(await screen.findByText("Claude is signed out")).toBeInTheDocument();
    expect(screen.getByText("Run claude /login")).toBeInTheDocument();
    await waitFor(() => expect(callsOf("claude.status")).toHaveLength(2));
    net.routes["chat.ask"] = () => ({ chatId: "c", ok: false, answer: "partial" });
    ask("Q2");
    expect(await screen.findByText("Claude could not answer")).toBeInTheDocument();
    net.routes["chat.ask"] = () => ({
      chatId: "c",
      ok: true,
      answer: "fine",
      diagnosis: { kind: "credit", title: "Low credit", detail: "" },
    });
    ask("Q3");
    expect(await screen.findByText("fine")).toBeInTheDocument();
    expect(callsOf("claude.status")).toHaveLength(2);
  });

  it("says Claude stopped when the request fails, and ignores empty or Shift+Enter input", async () => {
    net.routes["chat.ask"] = () => {
      throw new Fail("core went away", 500);
    };
    mount({}, onDoc);
    ask("   ");
    ask("draft", { shiftKey: true, ctrlKey: false });
    ask("draft", { ctrlKey: false });
    expect(callsOf("chat.ask")).toHaveLength(0);
    fireEvent.keyDown(box(), { key: "a" });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true, ctrlKey: true });
    expect(await screen.findByText("Claude stopped")).toBeInTheDocument();
    expect(screen.getByText("core went away")).toBeInTheDocument();
  });

  it("cancels a running answer from the button or Escape, and says when cancelling fails", async () => {
    net.routes["chat.ask"] = () => ({ jobId: "c9" });
    net.routes["jobs.show"] = () => ({ job: job({ id: "c9", kind: "chat" }) });
    let cancels = 0;
    net.routes["jobs.cancel"] = () => {
      cancels++;
      if (cancels > 1) throw new Fail("already gone");
      return null;
    };
    mount({}, onDoc);
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Claude" }), { key: "Escape" });
    expect(callsOf("jobs.cancel")).toHaveLength(0);
    ask("Long one");
    await waitFor(() => expect(screen.getByRole("button", { name: /Cancel/ })).toBeEnabled());
    ask("While busy");
    expect(callsOf("chat.ask")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Claude" }), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Claude" }), { key: "a" });
    await waitFor(() => expect(callsOf("jobs.cancel")).toHaveLength(2));
    expect(await screen.findByText("Could not cancel the run")).toBeInTheDocument();
    act(() => FakeES.emit(status(job({ id: "c9", status: "cancelled" }))));
    expect(await screen.findByText("Cancelled.")).toBeInTheDocument();
  });

  it("shows Running on the folded strip and opens with it", async () => {
    let finish: (v: unknown) => void = () => {};
    net.routes["chat.ask"] = () => new Promise((res) => (finish = res));
    const { update, onFold } = mount({}, onDoc);
    ask("Q");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(1));
    update({ folded: true });
    expect(screen.getByText(/Claude is working/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Claude" }));
    expect(onFold).toHaveBeenCalled();
    await act(async () => finish({ chatId: "c", answer: "done" }));
    expect(screen.queryByText(/Claude is working/)).toBeNull();
    update({ folded: false });
    fireEvent.click(screen.getByRole("button", { name: "Fold the dock (Ctrl+J)" }));
    expect(onFold).toHaveBeenCalledTimes(2);
  });
});

describe("Claude dock: connection", () => {
  it("guides the install, checks again with a sign-in probe and opens the system check", async () => {
    net.routes["claude.status"] = (i) =>
      i.refresh ? { installed: true, signedIn: true } : { installed: false, signedIn: null };
    const { state } = mount();
    expect(await screen.findByText("Claude isn't installed on this PC yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open system check" }));
    expect(state.navigate).toHaveBeenCalledWith("doctor");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByText(/isn't installed/)).toBeNull());
    expect(callsOf("claude.status")[1].input).toEqual({ refresh: true, signIn: true });
  });

  it("shows the sign-in steps when installed but signed out, and survives a failed status", async () => {
    net.routes["claude.status"] = () => ({ installed: true, signedIn: false });
    mount();
    expect(await screen.findByText("Claude isn't signed in on this PC yet")).toBeInTheDocument();
    cleanup();
    net.routes["claude.status"] = () => {
      throw new Fail("no");
    };
    mount();
    await waitFor(() => expect(callsOf("claude.status").length).toBeGreaterThan(1));
    expect(screen.getByText(/Ask anything about the project/)).toBeInTheDocument();
  });
});

describe("Claude dock: on a test", () => {
  it("runs on the whole test or one step and offers to show or revert the change", async () => {
    const flushed = vi.fn(async () => null);
    setFlushHook(flushed);
    net.routes["claude.run"] = () => ({
      ok: true,
      summary: "Done",
      runId: "run-1",
      changedSteps: [2, 3],
    });
    net.routes["claude.revert"] = () => ({ reverted: ["local-1"] });
    const { state } = mount({}, { focus: focus({ key: "LFRPS12-1", step: 2 }) });
    expect(screen.getByRole("radio", { name: "Whole test" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("LFRPS12-1").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: "Step 2" }));
    expect(screen.getByRole("radio", { name: "Step 2" })).toHaveAttribute("aria-checked", "true");
    ask("Ajoute une source");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toEqual({
      scope: { kind: "step", testId: "local-1", step: 2 },
      prompt: "Ajoute une source",
      model: "sonnet",
      effort: "medium",
    });
    expect(flushed).toHaveBeenCalledWith([["tests.show"]], null);
    expect(await screen.findByText("2 steps changed · check queued")).toBeInTheDocument();
    expect(state.setClaudeRunning).toHaveBeenCalledWith("local-1");
    expect(state.setClaudeRunning).toHaveBeenLastCalledWith(null);
    expect(state.setLastRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", changedTests: ["local-1"], changedSteps: { "local-1": [2, 3] } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "local-1");
    fireEvent.click(screen.getByRole("button", { name: /Revert/ }));
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
    expect(screen.getByText("Claude's changes reverted")).toBeInTheDocument();
    expect(screen.getByText("1 test restored.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Whole test" }));
    ask("Encore");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(2));
    expect(callsOf("claude.run")[1].input.scope).toEqual({ kind: "test", testId: "local-1" });
  });

  it("reports a review fix: checked again, still To fix, several tests", async () => {
    mount({}, { focus: focus() });
    expect(screen.getByText("local test")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Step" })).toBeDisabled();
    net.routes["claude.run"] = () => ({
      ok: true,
      summary: "",
      runId: "r",
      changedTests: ["a", "b"],
      changedSteps: { a: [1], b: [] },
      review: "checked",
    });
    ask("Fix");
    expect(await screen.findByText("1 step changed in 2 tests · checked again")).toBeInTheDocument();
    net.routes["claude.run"] = () => ({
      ok: true,
      summary: "Tried",
      runId: "r2",
      changedSteps: { "local-1": [4] },
      review: "to-fix",
      message: "Step 4 still has no source",
    });
    ask("Fix again");
    expect(await screen.findByText("Step 4 still has no source")).toBeInTheDocument();
    expect(screen.getByText("Still To fix")).toBeInTheDocument();
    expect(screen.getByText("1 step changed · still To fix")).toBeInTheDocument();
  });

  it("shows why a run did not finish, with no run card", async () => {
    net.routes["claude.run"] = () => ({ ok: false, summary: "Out of turns", changedSteps: [] });
    mount({}, { focus: focus() });
    await waitFor(() => expect(callsOf("claude.status")).toHaveLength(1));
    ask("Do it");
    expect(await screen.findByText("The run did not finish")).toBeInTheDocument();
    expect(screen.getAllByText("Out of turns").length).toBeGreaterThan(0);
    expect(screen.queryByText("Show changes")).toBeNull();
    net.routes["claude.run"] = () => ({
      ok: false,
      summary: "",
      changedTests: [],
      diagnosis: { kind: "connect", title: "Claude cannot connect", detail: "" },
    });
    ask("Again");
    expect(await screen.findByText("Claude cannot connect")).toBeInTheDocument();
    await waitFor(() => expect(callsOf("claude.status")).toHaveLength(2));
    net.routes["claude.run"] = () => ({ ok: true, summary: "Nothing to do", runId: "r3" });
    ask("Third");
    expect(await screen.findByText("Nothing to do")).toBeInTheDocument();
    expect(screen.getByText("Claude cannot connect")).toBeInTheDocument();
    expect(screen.getByText(/^0 steps changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Revert$/ })).toBeInTheDocument();
  });

  it("offers Revert for a run that did not finish but changed steps", async () => {
    net.routes["claude.run"] = () => ({ ok: false, summary: "Out of turns", runId: "run-half", changedSteps: [1, 2] });
    net.routes["claude.revert"] = () => ({ reverted: ["local-1"] });
    mount({}, { focus: focus() });
    ask("Do it");
    expect(await screen.findByText("The run did not finish")).toBeInTheDocument();
    expect(screen.getByText(/^2 steps changed/)).toBeInTheDocument();
    const order: string[] = [];
    setFlushHook(async () => {
      order.push("flush");
      return null;
    });
    net.routes["claude.revert"] = () => {
      order.push("revert");
      return { reverted: ["local-1"] };
    };
    fireEvent.click(screen.getByRole("button", { name: /^Revert$/ }));
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
    expect(callsOf("claude.revert").map((c) => c.input)).toEqual([{ runId: "run-half" }]);
    expect(order).toEqual(["flush", "revert"]);
  });

  it("asks before reverting a test edited after the run, and reports other revert errors", async () => {
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok", runId: "run-x", changedSteps: [1] });
    let forced = false;
    net.routes["claude.revert"] = (i) => {
      if (i.force) {
        forced = true;
        return {};
      }
      throw new Fail("The test changed after the Claude run");
    };
    const served = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("/claude/revert") && !JSON.parse(init?.body ?? "{}").force)
        return new Response(
          JSON.stringify({ error: "The test changed after the Claude run", code: "edited-after-run" }),
          { status: 409 },
        );
      return served(url, init as RequestInit);
    });
    mount({}, { focus: focus() });
    ask("Go");
    fireEvent.click(await screen.findByRole("button", { name: /Revert/ }));
    const ask2 = await screen.findByRole("alertdialog", { name: "Revert anyway?" });
    expect(ask2).toHaveTextContent("The test changed after the Claude run");
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    await waitFor(() => expect(forced).toBe(true));
    expect(await screen.findByText("0 tests restored.")).toBeInTheDocument();
    vi.stubGlobal("fetch", served);
    net.routes["claude.revert"] = () => {
      throw new Fail("disk full");
    };
    ask("Go again");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Revert$/ })).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /^Revert$/ }));
    expect(await screen.findByText("Could not revert Claude's changes")).toBeInTheDocument();
  });

  it("stops on a failed run and on a flush error", async () => {
    net.routes["claude.run"] = () => {
      throw new Fail("refused");
    };
    const { state } = mount({}, { focus: focus() });
    ask("Go");
    expect(await screen.findByText("refused")).toBeInTheDocument();
    expect(state.setClaudeRunning).toHaveBeenLastCalledWith(null);
  });

  it("puts a preset in the box, labels the run with it, and starts from a typed model", async () => {
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    mount(
      {},
      {
        focus: focus({ key: "LFRPS12-7" }),
        ...withClaude({
          model: "my-model-1",
          effort: "high",
          presets: [{ label: "Add sources", prompt: "Cite them" }],
        }),
      },
    );
    expect(screen.getByRole("textbox", { name: "Custom model" })).toHaveValue("my-model-1");
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "opus" } });
    expect(screen.queryByRole("textbox", { name: "Custom model" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Effort" }), { target: { value: "max" } });
    const chip = screen.getByRole("button", { name: "Add sources" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(box()).toHaveValue("Cite them");
    expect(callsOf("claude.run")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({ prompt: "Cite them", model: "opus", effort: "max" });
    expect(screen.getByText("LFRPS12-7 · Add sources")).toBeInTheDocument();
  });

  it("follows the focus: whole test without a step, the whole project without a test", async () => {
    net.routes["claude.run"] = () => ({ ok: true, summary: "all done" });
    const { update } = mount({}, { focus: focus({ step: 1 }) });
    fireEvent.click(screen.getByRole("radio", { name: "Step 1" }));
    update({}, { focus: focus({ step: null }) });
    expect(screen.getByRole("radio", { name: "Whole test" })).toHaveAttribute("aria-checked", "true");
    update({}, { focus: null });
    expect(screen.getByRole("tab", { name: /On the project/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Ask anything about the project/)).toBeInTheDocument();
    ask("Tout relire");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input.scope).toEqual({ kind: "project" });
    expect(callsOf("chat.ask")).toHaveLength(0);
    update({}, { focus: focus() });
    expect(screen.getByRole("textbox", { name: "Ask Claude about this test" })).toBeInTheDocument();
    expect(screen.getByText("Tout relire", { ignore: "textarea, script, style" })).toBeInTheDocument();
  });
});

describe("Claude dock: requests from the app", () => {
  it("opens on a mode with a prompt, once per request", async () => {
    const { update } = mount({ request: { mode: "docs", prompt: "Pré-rempli", nonce: 1 } });
    expect(box()).toHaveValue("Pré-rempli");
    await waitFor(() => expect(box()).toHaveFocus());
    fireEvent.change(box(), { target: { value: "edited" } });
    update({ request: { mode: "docs", prompt: "Pré-rempli", nonce: 1 } });
    expect(box()).toHaveValue("edited");
    update({ request: { mode: "test", scope: "step", nonce: 2 } }, { focus: focus({ step: 3 }) });
    expect(box()).toHaveValue("edited");
    expect(screen.getByRole("radio", { name: "Step 3" })).toHaveAttribute("aria-checked", "true");
  });

  it("a whole-test request from the test header leaves the step scope even while a step has the focus (PARITY #5)", async () => {
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    const { update } = mount(
      { request: { mode: "test", scope: "step", nonce: 1 } },
      { focus: focus({ key: "LFRPS12-1", step: 2 }) },
    );
    const scope = (name: string) => screen.getByRole("radio", { name });
    expect(scope("Step 2")).toHaveAttribute("aria-checked", "true");
    update({ request: { mode: "test", scope: "test", nonce: 2 } });
    expect(scope("Whole test")).toHaveAttribute("aria-checked", "true");
    expect(scope("Step 2")).toHaveAttribute("aria-checked", "false");
    ask("Relis tout");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input.scope).toEqual({ kind: "test", testId: "local-1" });
  });

  it("counts the running seconds of a Claude job and cancels it with jobs.cancel (PARITY #74)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      net.routes["claude.run"] = () => ({ jobId: "r7" });
      net.routes["jobs.show"] = () => ({ job: job({ id: "r7", kind: "claude" }) });
      net.routes["jobs.cancel"] = () => null;
      mount({}, { focus: focus() });
      ask("Long run");
      expect(await screen.findByText("0:00")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: /Cancel/ })).toBeEnabled());
      act(() => vi.advanceTimersByTime(3000));
      expect(screen.getByText("0:03")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByText("0:04")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
      for (let i = 0; i < 5 && !callsOf("jobs.cancel").length; i++) await act(async () => {});
      expect(callsOf("jobs.cancel")).toHaveLength(1);
      expect(callsOf("jobs.cancel")[0].input).toEqual({ id: "r7" });
      act(() => FakeES.emit(status(job({ id: "r7", kind: "claude", status: "cancelled" }))));
      await waitFor(() => expect(screen.queryByText("0:04")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a job handed by the app, refusing a second one while busy", async () => {
    let finish: (v: unknown) => void = () => {};
    net.routes["review.fix"] = () => new Promise((res) => (finish = res));
    const jobReq = (nonce: number): DockRequest => ({
      mode: "test",
      nonce,
      job: { name: "review.fix", input: { id: "local-1" }, label: "Fix this test", testId: "local-1" },
    });
    const { update } = mount({ request: jobReq(1) }, { focus: focus() });
    expect(screen.getByText("Fix this test")).toBeInTheDocument();
    await waitFor(() => expect(callsOf("review.fix")).toHaveLength(1));
    update({ request: jobReq(2) });
    expect(await screen.findByText("Claude is busy")).toBeInTheDocument();
    await act(async () => finish({ ok: true, summary: "Fixed", runId: "f1", changedSteps: [1], review: "checked" }));
    expect(await screen.findByText("1 step changed · checked again")).toBeInTheDocument();
    net.routes["review.fix"] = () => {
      throw new Fail("no such test");
    };
    update({ request: jobReq(3) });
    expect(await screen.findByText("no such test")).toBeInTheDocument();
  });
});
