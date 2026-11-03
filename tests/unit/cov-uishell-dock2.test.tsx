// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../src/ui/api.ts";
import { ClaudeDock, type DockRequest, metaLine } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { ContextsDialog } from "../../src/ui/components/claude/ContextsDialog.tsx";
import { AppContext, type AppState, type Focus } from "../../src/ui/lib/app.ts";
import { callsOf, deferred, fakeEvents, fakeNet, net } from "./cov-uishell-helpers.tsx";
import { app } from "./ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

type Props = { folded?: boolean; request?: DockRequest | null };

function mount(props: Props = {}, over: Partial<AppState> = {}) {
  const state = app(over);
  let current: Props = { folded: false, ...props };
  const ui = () => (
    <AppContext.Provider value={{ ...state }}>
      <ClaudeDock folded={!!current.folded} request={current.request} onFold={() => {}} />
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

  it("shows a failed run's raw output, even when empty, and marks the last run bad on the folded strip", async () => {
    net.routes["claude.run"] = () => ({ ok: false, raw: "", changedTests: [] });
    const { update } = mount({}, { focus: focus(), ...claude({ model: "" }) });
    ask("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("model");
    fireEvent.click(await screen.findByRole("button", { name: "Show raw output" }));
    expect(screen.getByText("(no output)")).toBeInTheDocument();
    update({ folded: true });
    expect(screen.getByText("Last run").parentElement).toHaveClass("dock-last-bad");
  });

  it("runs on the whole project and shows the changes on the first changed test", async () => {
    net.routes["claude.run"] = () => ({ ok: true, runId: "r1", changedTests: ["t9"], changedSteps: { t9: [1] } });
    const { state } = mount({}, { focus: null, ...claude({ contexts: undefined }) });
    ask("Tout");
    fireEvent.click(await screen.findByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t9");
  });

  it("falls back to an empty test id when a project run names no test", async () => {
    net.routes["claude.run"] = () => ({ ok: true, runId: "r2", changedSteps: [3] });
    const { state } = mount({}, { focus: null });
    ask("Tout");
    fireEvent.click(await screen.findByRole("button", { name: "Show changes" }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "");
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
});

describe("dock contexts", () => {
  it("lets a run leave a context out, import it back and add a note", async () => {
    net.routes["contexts.list"] = () => [{ id: "g", name: "Glossaire", paths: [], files: [], hasNotes: true }];
    net.routes["contexts.ofTest"] = () => ({ effective: ["g", "orphan"] });
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    mount({}, { focus: focus() });
    fireEvent.click(await screen.findByRole("button", { name: "Leave Glossaire out of this run" }));
    expect(screen.queryByRole("button", { name: "Leave Glossaire out of this run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import saved" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Glossaire/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use 1" }));
    expect(screen.getByRole("button", { name: "Leave Glossaire out of this run" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note for this run" }), { target: { value: " PCC " } });
    ask("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).toMatchObject({ contexts: ["g"], note: "PCC" });
  });

  it("reads empty answers as no contexts", async () => {
    net.routes["contexts.list"] = () => null;
    net.routes["contexts.ofTest"] = () => null;
    net.routes["claude.run"] = () => ({ ok: true, summary: "ok" });
    mount({}, { focus: focus() });
    await waitFor(() => expect(callsOf("contexts.ofTest")).toHaveLength(1));
    ask("Go");
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(callsOf("claude.run")[0].input).not.toHaveProperty("contexts");
  });
});

describe("ContextsDialog: an answer for a context left meanwhile", () => {
  it("keeps the context now open", async () => {
    const gate = deferred();
    const a = { id: "a", name: "A", paths: [], files: [], hasNotes: false };
    const b = { id: "b", name: "B", paths: [], files: [], hasNotes: false };
    net.routes["contexts.list"] = () => [a, b];
    net.routes["contexts.removeFile"] = async () => {
      await gate.promise;
      return { ...a, files: [], notes: "" };
    };
    net.routes["contexts.show"] = (i) => ({ ...(i.id === "a" ? { ...a, files: ["x.png"] } : b), notes: "" });
    render(<ContextsDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove file x.png" }));
    fireEvent.click(screen.getByRole("option", { name: /B/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /B/ })).toHaveAttribute("aria-selected", "true"));
    await act(async () => gate.resolve(null));
    expect(screen.getByLabelText("Name")).toHaveValue("B");
  });
});
