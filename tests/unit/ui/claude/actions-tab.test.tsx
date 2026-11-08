// @vitest-environment jsdom
import { pickRun, runChoice } from "../../helpers/run-choice.ts";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProject } from "../../../../src/ui/api.ts";
import { ClaudeDock, type DockRequest } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import type { Action } from "../../../../src/ui/lib/actions.ts";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { callsOf, dataWrapper, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

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
  target: { kind: "document", id: DOC, name: "Traction", code: DOC },
  ...o,
});

let open: Action[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("D:/p");
  open = [];
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["actions.list"] = () => open;
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

const actionsTab = () => screen.getByRole("tab", { name: /^Actions/ });

describe("Ask Claude: the Actions tab", () => {
  it("holds every open action as a card, with the suggested model and effort, then runs and reverts it", async () => {
    open = [action({ suggest: { model: "opus", effort: "xhigh" } })];
    net.routes["actions.run"] = () => {
      open = [];
      return {
        ok: true,
        summary: "21 of the 23 figures are back.",
        runId: "run-9",
        durationMs: 3000,
        changedTests: [],
        changedSteps: {},
        changedFiles: [`docs/${DOC}/doc.md`, `docs/${DOC}/source.pdf`],
        raw: "",
        action: action({ state: "done" }),
      };
    };
    net.routes["claude.revert"] = () => ({ reverted: [], files: [`docs/${DOC}/doc.md`] });
    net.routes["contexts.list"] = () => [
      { id: "sosie", name: "Projet SOSIE" },
      { id: "other", name: "Other" },
    ];
    const { state } = dock(null, {
      info: {
        ...app().info,
        project: {
          ...app().info?.project,
          claude: { model: "sonnet", effort: "medium", presets: [], contexts: ["sosie", "gone"] },
        },
      } as never,
    });
    await waitFor(() => expect(actionsTab()).toHaveTextContent("1"));
    expect(screen.queryByRole("region", { name: /Claude action/ })).toBeNull();
    fireEvent.click(actionsTab());
    const card = await screen.findByRole("region", { name: "Claude action: Recover 23 figures from the PDF" });
    expect(card).toHaveTextContent("Whole document");
    expect(screen.getByRole("region", { name: "Document · Traction" })).toContainElement(card);
    expect(card).toHaveTextContent("caption without a picture");
    expect(card).not.toHaveTextContent("Find the PDF");
    fireEvent.click(within(card).getByRole("button", { name: "Show" }));
    expect(card).toHaveTextContent("Find the PDF");
    expect(card).toHaveTextContent("Every Testimus command · read and edit the project files");
    expect(card).toHaveTextContent("Suggested for this task: Opus · xhigh.");
    expect(card).not.toHaveTextContent("push");
    expect(await within(card).findByText("Projet SOSIE")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Ask/ })).toBeNull();
    expect(runChoice(within(card))).toHaveAccessibleName("opus · xhigh");
    pickRun("max", within(card));
    fireEvent.click(within(card).getByRole("button", { name: "Run" }));
    await waitFor(() => expect(callsOf("actions.run")).toHaveLength(1));
    expect(callsOf("actions.run")[0].input).toMatchObject({ id: "act-1", model: "opus", effort: "max" });
    expect(await screen.findByText("2 files changed")).toBeInTheDocument();
    expect(screen.getByText("21 of the 23 figures are back.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("documents", DOC);
    fireEvent.click(screen.getByRole("button", { name: /^Revert$/ }));
    expect(await screen.findByText("Reverted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /On the project/ }));
    expect(screen.queryByText("21 of the 23 figures are back.")).toBeNull();
  });

  it("puts a card aside with Not now, and dismisses it for good with Dismiss", async () => {
    open = [action(), action({ id: "act-2", title: "Second" })];
    net.routes["actions.dismiss"] = () => {
      open = open.filter((a) => a.id !== "act-2");
      return action({ id: "act-2", state: "dismissed" });
    };
    dock(null);
    await waitFor(() => expect(actionsTab()).toHaveTextContent("2"));
    fireEvent.click(actionsTab());
    expect(await screen.findAllByRole("button", { name: "Run" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Not now" })[0]);
    expect(screen.queryByRole("region", { name: /Recover 23 figures/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(callsOf("actions.dismiss")[0].input).toEqual({ id: "act-2" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /Second/ })).toBeNull());
    expect(screen.getByText(/Every action is put aside/)).toBeInTheDocument();
  });

  it("groups the cards under what they work on, in the core's order, and asks first for the target on screen", async () => {
    const test = { kind: "test" as const, id: "local-0000000a", name: "Sectionneur avec TK" };
    open = [
      action({
        id: "act-t1",
        title: "Fix « quote not found » in step 2",
        target: test,
        scope: { kind: "test", testId: test.id },
      }),
      action({
        id: "act-t2",
        title: "Add the missing negative path",
        target: test,
        scope: { kind: "test", testId: test.id },
      }),
      action({
        id: "act-p",
        title: "Define the step columns",
        target: { kind: "project", id: "", name: "RATP Sosie" },
      }),
      action({
        id: "act-g",
        title: "Write the 2 skipped tests",
        target: {
          kind: "generation",
          id: "job-1",
          name: "Le sectionneur avec et sans TK",
          at: new Date().toISOString(),
        },
      }),
    ];
    dock(null, {
      route: { screen: "tests", arg: test.id },
      focus: { testId: test.id, summary: test.name, step: null },
    });
    await waitFor(() => expect(actionsTab()).toHaveTextContent("4"));
    expect(callsOf("actions.list").at(-1)?.input).toEqual({ view: { kind: "test", id: test.id } });
    fireEvent.click(actionsTab());
    const groups = await screen.findAllByRole("region", { name: / · / });
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Test · Sectionneur avec TK",
      "Project · RATP Sosie",
      "Generation · Le sectionneur avec et sans TK",
    ]);
    expect(within(groups[0]).getByRole("heading", { level: 3 })).toHaveTextContent(/^TestSectionneur avec TK$/);
    expect(within(groups[0]).getAllByRole("button", { name: "Run" })).toHaveLength(2);
    expect(groups[0].textContent).not.toMatch(/local-/);
  });

  it("says when there is none, and stays open while the focus moves", async () => {
    const { r, state } = dock(null);
    fireEvent.click(actionsTab());
    expect(screen.getByText("No Claude action")).toBeInTheDocument();
    r.rerender(
      <AppContext.Provider value={{ ...state, route: { screen: "documents", arg: DOC } }}>
        <ClaudeDock folded={false} request={null} onFold={() => {}} />
      </AppContext.Provider>,
    );
    expect(actionsTab()).toHaveAttribute("aria-selected", "true");
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
