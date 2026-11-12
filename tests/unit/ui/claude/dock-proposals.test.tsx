// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { ClaudeDock } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { setDockPlan } from "../../../../src/ui/components/claude/dockPlan.ts";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { setFlushHook } from "../../../../src/ui/lib/data/query.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { callsOf, dataWrapper, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
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

const onDoc: Partial<AppState> = { route: { screen: "documents", arg: "D" } };

function mount() {
  render(
    <AppContext.Provider value={app(onDoc)}>
      <ClaudeDock />
      <ToastProbe />
    </AppContext.Provider>,
  );
}

const box = () => screen.getByRole("textbox", { name: /^Ask/ });
const ask = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
};

const PROPOSAL: Proposal = {
  id: "prop-1",
  kind: "overview",
  target: "overview",
  name: "How the documents fit together",
  before: "## Le corpus\n\nDeux documents.",
  after: "## Le corpus\n\nDeux documents, un poste.",
  why: "La vue d'ensemble ne disait pas le poste.",
  runId: "run-1",
  at: "",
  mtime: 1,
  state: "open",
};

describe("Claude dock: a change the chat proposes", () => {
  it("shows it as a diff under the answer; Apply writes it, then Revert takes it back", async () => {
    net.routes["chat.ask"] = () => ({
      chatId: "chat-1",
      ok: true,
      answer: "Je propose une section.",
      proposals: [PROPOSAL],
    });
    net.routes["chat.learn"] = () => ({ jobId: "l1" });
    net.routes["chat.apply"] = () => ({ ...PROPOSAL, state: "applied" });
    net.routes["claude.revert"] = () => ({ reverted: [], files: ["docs/OVERVIEW.md"] });
    mount();
    ask("Corrige la vue d'ensemble");
    const card = await screen.findByText("How the documents fit together");
    const diff = screen.getByRole("list", { name: "Proposed change to How the documents fit together" });
    expect(within(diff).getByText("Deux documents, un poste.")).toBeInTheDocument();
    expect(screen.getByText("La vue d'ensemble ne disait pas le poste.")).toBeInTheDocument();
    expect(card).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(callsOf("chat.apply")[0]?.input).toEqual({ id: "prop-1" }));
    expect(await screen.findByText("Applied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(callsOf("claude.revert")[0]?.input).toEqual({ runId: "run-1" }));
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
  });

  it("Ignore writes nothing; a file that moved since is refused and said", async () => {
    net.routes["chat.ask"] = () => ({
      chatId: "chat-1",
      ok: true,
      answer: "Deux.",
      proposals: [PROPOSAL, { ...PROPOSAL, id: "prop-2", kind: "column", target: "Data", name: "Data" }],
    });
    net.routes["chat.learn"] = () => ({ jobId: "l1" });
    net.routes["chat.ignore"] = () => ({ ...PROPOSAL, state: "ignored" });
    net.routes["chat.apply"] = () => {
      throw new Fail("The description of Data changed since Claude proposed this.", 409);
    };
    mount();
    ask("Corrige");
    expect(await screen.findByText("Column « Data »")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore" })[0]);
    expect(await screen.findByText("Ignored")).toBeInTheDocument();
    expect(callsOf("chat.apply")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/Could not apply the change to Data/)).toBeInTheDocument();
  });
});

describe("Claude dock: the plan Generate shows", () => {
  it("asks with the plan waiting on Generate, shows the plan it proposes as a diff, and asks without it elsewhere", async () => {
    const plan: Proposal = {
      ...PROPOSAL,
      id: "prop-3",
      kind: "plan",
      target: "g1",
      name: "Le sectionneur",
      before: "## Sectionneurs\n- 1. Menu",
      after: "## Sectionneurs\n- 1. Menu\n- 2. Propriétés",
      why: "Un test de plus pour la fenêtre.",
    };
    net.routes["chat.ask"] = () => ({ chatId: "chat-1", ok: true, answer: "Voici le plan.", proposals: [plan] });
    net.routes["chat.learn"] = () => ({ jobId: "l1" });
    act(() => setDockPlan("g1"));
    render(
      <AppContext.Provider value={app({ route: { screen: "generate" } })}>
        <ClaudeDock />
      </AppContext.Provider>,
    );
    ask("Ajoute un test pour la fenêtre Propriétés");
    expect(await screen.findByText("Plan « Le sectionneur »")).toBeInTheDocument();
    expect(callsOf("chat.ask")[0]?.input).toMatchObject({ generation: "g1" });
    expect(screen.getByRole("list", { name: "Proposed change to Plan « Le sectionneur »" })).toBeInTheDocument();
    cleanup();
    act(() => setDockPlan(null));
    mount();
    ask("Et ailleurs ?");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(2));
    expect(callsOf("chat.ask")[1]?.input).not.toHaveProperty("generation");
  });
});

describe("Claude dock: remembering the conversation", () => {
  it("each answer starts the learning run, unless « Don't remember this conversation » is on, until Start over", async () => {
    net.routes["chat.ask"] = () => ({ chatId: "chat-1", ok: true, answer: "Oui." });
    net.routes["chat.learn"] = () => ({ jobId: "l1" });
    mount();
    const forget = screen.getByRole("switch", { name: "Don't remember this conversation" });
    expect(forget).not.toBeChecked();
    ask("Q1");
    await waitFor(() => expect(callsOf("chat.learn")).toHaveLength(1));
    expect(callsOf("chat.learn")[0].input).toEqual({ chatId: "chat-1" });
    fireEvent.click(forget);
    expect(forget).toBeChecked();
    ask("Q2");
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(2));
    await screen.findAllByText("Oui.");
    expect(callsOf("chat.learn")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByRole("switch", { name: "Don't remember this conversation" })).not.toBeChecked();
  });

  it("a question about a problem of the app teaches nothing", async () => {
    net.routes["chat.ask"] = () => ({ chatId: "chat-p", ok: true, answer: "Un proxy." });
    render(
      <AppContext.Provider value={app(onDoc)}>
        <ClaudeDock request={{ mode: "docs", problem: { where: "check:xray", text: "fetch failed" }, nonce: 1 }} />
      </AppContext.Provider>,
    );
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(1));
    expect(await screen.findByText("Un proxy.")).toBeInTheDocument();
    expect(callsOf("chat.learn")).toHaveLength(0);
  });
});
