// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProject } from "../../src/ui/api.ts";
import { ActionButton } from "../../src/ui/components/claude/ActionButton.tsx";
import { ActionCount } from "../../src/ui/components/claude/ActionCount.tsx";
import { ClaudeDock, type DockRequest, docOfRoute, kindOf } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { type Action, originLine, scopeWords } from "../../src/ui/lib/actions.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { callsOf, fakeEvents, fakeNet, net } from "./cov-uishell-helpers.tsx";
import { app } from "./ui-desktop-helpers.tsx";

const DOC = "SOSIE_211_D401-1_3";

const action = (o: Partial<Action> = {}): Action => ({
  id: "act-1",
  title: "Recover 23 figures from the PDF",
  scope: { kind: "doc", docId: DOC },
  where: `doc:${DOC}`,
  problem: "Figure 3, 23: caption without a picture in the .docx",
  why: "The PDF rendering has the pictures.",
  plan: ["Find the PDF", "Convert again"],
  stamp: "s",
  proposedBy: { run: "import", model: "opus", effort: "low", at: new Date(Date.now() - 120000).toISOString() },
  state: "open",
  at: "2026-11-03T10:00:00Z",
  stale: false,
  ...o,
});

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("D:/p");
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["actions.list"] = () => [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

function dock(request: DockRequest | null, over: Partial<AppState> = {}) {
  const state = app(over);
  const r = render(
    <AppContext.Provider value={state}>
      <ClaudeDock folded={false} request={request} onFold={() => {}} />
    </AppContext.Provider>,
  );
  return { state, r };
}

describe("action words", () => {
  it("say who proposed the action, with which model and effort, and when", () => {
    expect(originLine(action())).toBe("Proposed by Opus · low · during the import · 2 min ago");
    expect(originLine(action({ proposedBy: { run: "x", model: "", effort: "", at: "nope" } }))).toBe(
      "Proposed by Claude",
    );
    expect(scopeWords({ kind: "step", testId: "T-1", step: 4 })).toBe("T-1 · step 4");
    expect(scopeWords({ kind: "doc", docId: DOC })).toBe(`${DOC} · whole document`);
    expect(kindOf({ kind: "tests", testIds: ["a"] })).toBe("project");
    expect(docOfRoute({ screen: "documents", arg: `${DOC}#§5.6.6` })).toBe(DOC);
    expect(docOfRoute({ screen: "tests", arg: "x" })).toBeNull();
  });
});

describe("the Claude action button", () => {
  it("shows its title, explains itself on hover and opens the action in Ask Claude", () => {
    const state = app();
    render(
      <AppContext.Provider value={state}>
        <ActionButton action={action()} />
        <ActionCount actions={[action(), action({ id: "act-2", title: "Other" })]} />
      </AppContext.Provider>,
    );
    const b = screen.getByRole("button", { name: "Recover 23 figures from the PDF" });
    fireEvent.mouseEnter(b);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Claude can fix this");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Proposed by Opus · low · during the import");
    fireEvent.click(b);
    expect(state.openAction).toHaveBeenCalledWith(expect.objectContaining({ id: "act-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Claude actions/ }));
    expect(state.openAction).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "act-1" }),
      expect.objectContaining({ id: "act-2" }),
    ]);
  });

  it("is a logo alone in a dense list, and says when Claude is on it", () => {
    render(
      <AppContext.Provider value={app()}>
        <ActionButton action={action()} compact />
        <ActionButton action={action({ id: "act-3", state: "running" })} />
      </AppContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Recover 23 figures from the PDF" })).toHaveClass("cab-icon");
    expect(screen.getByText("Claude is on it…")).toBeInTheDocument();
  });
});

describe("Ask Claude: the action card", () => {
  it("comes in ready, with its scope, problem, plan, model and effort, then runs and reverts", async () => {
    net.routes["actions.run"] = () => ({
      ok: true,
      summary: "21 of the 23 figures are back.",
      runId: "run-9",
      durationMs: 3000,
      changedTests: [],
      changedSteps: {},
      changedFiles: [`docs/${DOC}/doc.md`, `docs/${DOC}/source.pdf`],
      raw: "",
      action: action({ state: "done" }),
    });
    net.routes["claude.revert"] = () => ({ reverted: [], files: [`docs/${DOC}/doc.md`] });
    const { state } = dock({ mode: "test", actions: [action()], nonce: 1 });
    const card = await screen.findByRole("region", { name: "Claude action: Recover 23 figures from the PDF" });
    expect(card).toHaveTextContent(`${DOC} · whole document`);
    expect(card).toHaveTextContent("caption without a picture");
    expect(card).toHaveTextContent("Find the PDF");
    expect(card).toHaveTextContent("A higher effort is usually worth it");
    expect(screen.getByRole("textbox", { name: /Ask/ })).toHaveValue("");
    const efforts = screen.getAllByRole("combobox", { name: "Effort" });
    fireEvent.change(efforts[0], { target: { value: "max" } });
    fireEvent.click(screen.getByRole("button", { name: "Run action" }));
    await waitFor(() => expect(callsOf("actions.run")).toHaveLength(1));
    expect(callsOf("actions.run")[0].input).toMatchObject({ id: "act-1", effort: "max" });
    expect(await screen.findByText("2 files changed")).toBeInTheDocument();
    expect(screen.getByText("21 of the 23 figures are back.")).toBeInTheDocument();
    expect(state.refreshInfo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("documents", DOC);
    fireEvent.click(screen.getByRole("button", { name: /^Revert$/ }));
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
  });

  it("is put aside with Not now, and dismissed for good with Dismiss", async () => {
    net.routes["actions.dismiss"] = () => action({ state: "dismissed" });
    dock({ mode: "test", actions: [action(), action({ id: "act-2", title: "Second" })], nonce: 1 });
    expect(await screen.findAllByRole("button", { name: "Run action" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]);
    expect(screen.queryByRole("region", { name: /Recover 23 figures/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(callsOf("actions.dismiss")[0].input).toEqual({ id: "act-2" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /Second/ })).toBeNull());
  });

  it("lists the open actions of the scope, and one click brings the card", async () => {
    net.routes["actions.list"] = (i) => (i.docId === DOC ? [action()] : []);
    dock(null, { route: { screen: "documents", arg: DOC } });
    expect(screen.getByRole("button", { name: "Document" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("1 Claude action on this document")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recover 23 figures from the PDF" }));
    expect(await screen.findByRole("button", { name: "Run action" })).toBeInTheDocument();
    expect(screen.queryByText("1 Claude action on this document")).toBeNull();
  });

  it("asks a document its questions, with the document named to Claude", async () => {
    net.routes["chat.ask"] = () => ({ chatId: "c1", ok: true, answer: "Oui.", sources: [] });
    dock(null, { route: { screen: "documents", arg: DOC } });
    const box = screen.getByRole("textbox", { name: `Ask about ${DOC}` });
    fireEvent.change(box, { target: { value: "Que dit le §5.6.6 ?" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(1));
    expect(String(callsOf("chat.ask")[0].input.note)).toContain(`docs/${DOC}/doc.md`);
    expect(await screen.findByText("Oui.")).toBeInTheDocument();
  });
});
