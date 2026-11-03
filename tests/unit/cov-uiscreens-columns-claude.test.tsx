// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StepColumn } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { Toasts } from "../../src/ui/components/legacy/index.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { ColumnsClaude } from "../../src/ui/screens/settings/ColumnsClaude.tsx";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status, withApp } from "./cov-uishell-helpers.tsx";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["contexts.list"] = () => [];
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

const col = (o: Partial<StepColumn>): StepColumn => ({
  name: "Action",
  origin: "xray",
  builtin: true,
  status: "ok",
  description: "",
  ...o,
});

const COLUMNS = [
  col({ name: "Expected Result", description: "Ce que voit l'opérateur." }),
  col({ name: "Écran", builtin: false, description: "" }),
  col({ name: "Remarque", origin: "local", builtin: false, description: "Une remarque." }),
];

const PROPOSALS = [
  {
    name: "Expected Result",
    kind: "xray",
    builtin: true,
    current: "Ce que voit l'opérateur.",
    description: "Une observation par ligne.",
    why: "LFRPS12-1420 le fait.",
  },
  { name: "Écran", kind: "xray", builtin: false, current: "", description: "La fenêtre où se fait le geste.", why: "" },
  { name: "Remarque", kind: "local", builtin: false, current: "Une remarque.", description: "", why: "r" },
  { name: "Poste", kind: "new", builtin: false, current: null, description: "Le poste.", why: "§ 5.6" },
];

function mount() {
  return withApp(
    <>
      <ColumnsClaude columns={COLUMNS} />
      <Probe />
    </>,
  );
}

const ask = () => screen.getByRole("button", { name: /Ask Claude|Ask again/ });

describe("ColumnsClaude", () => {
  it("runs columns.suggest as a job, shows what Claude reads, then its proposals", async () => {
    net.routes["columns.suggest"] = () => ({ jobId: "c1" });
    net.routes["jobs.show"] = () => ({ job: job({ id: "c1", kind: "columns" }) });
    net.routes["jobs.cancel"] = () => null;
    mount();
    fireEvent.change(screen.getByPlaceholderText(/What the columns should hold/), {
      target: { value: "  le poste  " },
    });
    fireEvent.click(ask());
    expect(await screen.findByText(/Claude is reading the columns/)).toBeInTheDocument();
    await waitFor(() => expect(callsOf("jobs.show")).toHaveLength(1));
    expect(callsOf("columns.suggest")[0].input).toEqual({ ask: "le poste", contexts: [] });
    act(() =>
      FakeES.emit({
        jobId: "c1",
        at: "",
        type: "claude",
        event: { type: "tool", name: "mcp__testimus__rag_search", input: '{"query":"poste"}' },
      }),
    );
    expect(screen.getByText(/Searched the documents for “poste”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(callsOf("jobs.cancel")[0].input).toEqual({ id: "c1" }));
    act(() =>
      FakeES.emit(
        status(
          job({
            id: "c1",
            kind: "columns",
            status: "done",
            result: { ok: true, summary: "J'ai lu les tests.\n\n```columns\n{}\n```", proposals: PROPOSALS },
          }),
        ),
      ),
    );
    expect(await screen.findByText("J'ai lu les tests.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Claude's proposals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText("New local column")).toBeInTheDocument();
    expect(within(list).getByText("Local only")).toBeInTheDocument();
    expect(within(list).getByText("Xray · standard")).toBeInTheDocument();
    expect(within(list).getByText("Xray")).toBeInTheDocument();
    expect(within(list).getByText("empty — Claude never fills it")).toBeInTheDocument();
    expect(within(list).getByText("empty — Claude stops filling it")).toBeInTheDocument();
    expect(within(list).getByText("LFRPS12-1420 le fait.")).toBeInTheDocument();
    expect(ask()).toHaveTextContent("Ask again");
  });

  it("applies one proposal, then all the others, through columns.save", async () => {
    net.routes["columns.suggest"] = () => ({ ok: true, summary: "Voilà.", proposals: PROPOSALS });
    net.routes["columns.save"] = () => [];
    const { state } = mount();
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    const poste = within(list).getByText("Poste").closest("li") as HTMLElement;
    fireEvent.click(within(poste).getByRole("button", { name: "Add the column" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(callsOf("columns.save")[0].input).toEqual({ name: "Poste", description: "Le poste." });
    expect(await screen.findByText("Poste: added")).toBeInTheDocument();
    expect(state.refreshInfo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply all 3" }));
    await waitFor(() => expect(callsOf("columns.save")).toHaveLength(4));
    expect(await screen.findByText("3 columns updated")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Claude's proposals" })).toBeNull();
  });

  it("dismisses proposals, and says when a save fails", async () => {
    net.routes["columns.suggest"] = () => ({ ok: true, summary: "", proposals: PROPOSALS.slice(0, 2) });
    net.routes["columns.save"] = () => {
      throw new Fail("Disk full");
    };
    mount();
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    const first = within(list).getByText("Expected Result").closest("li") as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: "Dismiss" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Apply all/ })).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Could not save the column")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("drops a proposal the columns already hold, and dismisses the whole answer", async () => {
    net.routes["columns.suggest"] = () => ({
      ok: true,
      summary: "",
      proposals: [{ ...PROPOSALS[0], description: "Ce que voit l'opérateur." }, PROPOSALS[1], PROPOSALS[3]],
    });
    mount();
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.queryByRole("list", { name: "Claude's proposals" })).toBeNull();
  });

  it("says when nothing is proposed, when the run failed, and when it broke", async () => {
    net.routes["columns.suggest"] = () => ({ ok: true, summary: "Rien à changer.", proposals: [] });
    mount();
    fireEvent.click(ask());
    expect(await screen.findByText("No change proposed.")).toBeInTheDocument();
    expect(screen.getByText("Rien à changer.")).toBeInTheDocument();
    net.routes["columns.suggest"] = () => ({
      ok: false,
      summary: "",
      proposals: [],
      diagnosis: { detail: "Claude is not signed in." },
    });
    fireEvent.click(ask());
    expect(await screen.findByText("Claude is not signed in.")).toBeInTheDocument();
    net.routes["columns.suggest"] = () => ({ ok: false, summary: "", proposals: [] });
    fireEvent.click(ask());
    expect(await screen.findByText("Claude gave no proposal.")).toBeInTheDocument();
    net.routes["columns.suggest"] = () => {
      throw new Fail("Claude Code is not installed");
    };
    fireEvent.click(ask());
    expect(await screen.findByText("Claude could not look at the columns")).toBeInTheDocument();
  });
});
