// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Test } from "../../../../../src/core/types.ts";
import { setProject } from "../../../../../src/ui/api.ts";
import { AnalysisPane } from "../../../../../src/ui/screens/tests/analysis/AnalysisPane.tsx";
import { useAnalysis } from "../../../../../src/ui/screens/tests/analysis/useAnalysis.ts";
import { callsOf, fakeEvents, fakeNet, net, withApp } from "../../../helpers/ui-data.tsx";

const ID = "LFRPS12-1420";
const D3 = "SOSIE_211_D401-1_3";

const test: Test = {
  project: "LFRPS12",
  summary: "Sectionneur sans TK",
  folder: "/Traction",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "validated",
  extra: {},
  steps: [1, 2, 3].map((n) => ({
    fields: { Action: `Action ${n}`, "Expected Result": `Résultat ${n}`, Exigence: `EXI_${n}` },
    sources: [],
    images: [],
  })),
};

const cite = (quote: string, column?: string, item?: string) => ({
  docId: D3,
  anchor: "§5.6.6",
  quote,
  ...(column ? { column, item } : {}),
});

const base = {
  at: new Date(Date.now() - 60000).toISOString(),
  testHash: "h",
  changed: false,
  summary: "Le test suit le §5.6.6.",
  columns: [{ name: "Exigence", role: "keep", why: "Codes saisis par l'équipe." }],
  unfound: [{ step: 2, column: "Exigence", item: "EXI_2" }],
  steps: [],
  run: { runId: "run-1", model: "sonnet", effort: "medium" },
  proposals: [
    {
      id: "p1",
      kind: "source",
      title: "Lier EXI_1",
      why: "Le §5.6.6 l'énonce.",
      step: 1,
      sources: [],
      cites: [cite("Le sectionneur est représenté", "Exigence", "EXI_1")],
      state: "open",
      now: 1,
    },
    {
      id: "p2",
      kind: "source",
      title: "Lier EXI_3",
      why: "Le §5.6.6 l'énonce.",
      step: 3,
      sources: [],
      cites: [cite("La fenêtre Propriétés affiche", "Exigence", "EXI_3")],
      state: "open",
      now: 3,
    },
    {
      id: "p3",
      kind: "change",
      title: "Résultat attendu du step 1",
      why: "Le passage dit autre chose.",
      step: 1,
      column: "Expected Result",
      before: "Résultat 1",
      value: "Résultat précis",
      sources: [],
      cites: [],
      state: "open",
      stale: "Expected Result of step 1 changed since the analysis.",
    },
    {
      id: "p4",
      kind: "step",
      title: "Vérifier le sectionneur avec TK",
      why: "Aucun step ne le vérifie.",
      after: 3,
      fields: { Action: "Clic droit.", "Expected Result": "Seul Propriétés." },
      sources: [],
      cites: [cite("ne propose que Propriétés")],
      state: "open",
      now: 3,
    },
    {
      id: "p5",
      kind: "remove",
      title: "Retirer le step 2",
      why: "Doublon.",
      step: 2,
      sources: [],
      cites: [],
      state: "rejected",
    },
  ],
};

let analysis: unknown = null;
const saved = vi.fn(async () => {});
const reloaded = vi.fn(async () => {});

function Harness() {
  const state = useAnalysis(ID, { save: saved, expect: () => {}, reload: reloaded });
  return (
    <AnalysisPane
      test={test}
      state={state}
      defaults={{ model: "sonnet", effort: "medium" }}
      locked={false}
      onSelect={() => {}}
      onOpenSource={() => {}}
      onClose={() => {}}
    />
  );
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("D:/p");
  analysis = null;
  saved.mockClear();
  reloaded.mockClear();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["jobs.list"] = () => [];
  net.routes["analysis.show"] = () => ({ id: ID, analysis });
  net.routes["analysis.run"] = () => ({ jobId: "j-1" });
  net.routes["analysis.decide"] = () => ({ analysis, applied: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("the analysis pane", () => {
  it("before any analysis: says what it does and starts one on this test, the edit saved first", async () => {
    withApp(<Harness />);
    expect(await screen.findByText(/Nothing changes until you accept it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() => expect(callsOf("analysis.run")).toHaveLength(1));
    expect(callsOf("analysis.run")[0].input).toMatchObject({ id: ID, model: "sonnet", effort: "medium" });
    expect(saved).toHaveBeenCalled();
  });

  it("groups the proposals to decide by the step they are about, in the test's order", async () => {
    analysis = base;
    withApp(<Harness />);
    const groups = await screen.findAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Step 1", "Step 3", "After step 3"]);
    expect(within(groups[0]).getByText("Lier EXI_1")).toBeInTheDocument();
    expect(within(groups[2]).getByRole("button", { name: "Add after step 3" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /To decide/ })).toHaveAttribute("aria-checked", "true");
  });

  it("accepting one saves the editor first, asks the core to write it, then reads the test again", async () => {
    analysis = base;
    withApp(<Harness />);
    const step1 = (await screen.findByRole("region", { name: "Step 1" })) as HTMLElement;
    fireEvent.click(within(step1).getAllByRole("button", { name: "Accept" })[0]);
    await waitFor(() => expect(callsOf("analysis.decide")).toHaveLength(1));
    expect(callsOf("analysis.decide")[0].input).toEqual({ id: ID, proposals: ["p1"], decision: "accept" });
    expect(saved).toHaveBeenCalled();
    await waitFor(() => expect(reloaded).toHaveBeenCalled());
  });

  it("a proposal that no longer applies says why and offers only Reject", async () => {
    analysis = base;
    withApp(<Harness />);
    const reason = await screen.findByText("Expected Result of step 1 changed since the analysis.");
    const card = reason.closest("[data-proposal]") as HTMLElement;
    expect(within(card).queryByRole("button", { name: "Accept" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(callsOf("analysis.decide")[0]?.input).toMatchObject({ proposals: ["p3"], decision: "reject" }),
    );
  });

  it("accepts every source at once from the foot, and a rejected one can be reconsidered", async () => {
    analysis = base;
    withApp(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept the 2 sources" }));
    await waitFor(() => expect(callsOf("analysis.decide")[0]?.input).toMatchObject({ proposals: ["p1", "p2"] }));
    fireEvent.click(screen.getByRole("radio", { name: /Rejected/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reconsider" }));
    await waitFor(() =>
      expect(callsOf("analysis.decide")[1]?.input).toMatchObject({ proposals: ["p5"], decision: "reopen" }),
    );
  });

  it("says the items no document holds, and how each column was read", async () => {
    analysis = base;
    withApp(<Harness />);
    expect(await screen.findByText(/EXI_2 \(Exigence, step 2\) — kept as it is/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /How Claude read the columns/ }));
    expect(screen.getByText("Kept as written")).toBeInTheDocument();
    expect(screen.getByText("Codes saisis par l'équipe.")).toBeInTheDocument();
  });

  it("a step to remove says which of the team's items go with it", async () => {
    analysis = {
      ...base,
      proposals: [
        {
          id: "p9",
          kind: "remove",
          title: "Retirer le step 2",
          why: "Doublon.",
          step: 2,
          sources: [],
          cites: [],
          state: "open",
          now: 2,
          drops: [{ column: "Exigence", item: "EXI_2" }],
        },
      ],
    };
    withApp(<Harness />);
    expect(await screen.findByText(/Also takes out what the team entered: EXI_2 \(Exigence\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove step" })).toBeInTheDocument();
  });

  it("a test that matches the documents says so", async () => {
    analysis = { ...base, proposals: [], unfound: [] };
    withApp(<Harness />);
    expect(await screen.findByText("The test matches the documents")).toBeInTheDocument();
  });
});
