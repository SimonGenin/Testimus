// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanReview } from "../../../../src/ui/screens/generate/PlanReview.tsx";
import { about, merge, retheme, toggle } from "../../../../src/ui/screens/generate/planEdits.ts";
import { api, named } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { freshPage, mountData } from "./harness.tsx";

beforeEach(freshPage);

afterEach(() => {
  cleanup();
  clearToasts();
  vi.restoreAllMocks();
});

const t = (summary: string, theme: string, sections: string[], technique = "cas d'utilisation") => ({
  summary,
  technique,
  sections,
  theme,
});

const PLAN = {
  tests: [
    t("Menu contextuel", "Sectionneurs sans TK", ["D#§5.6.6"]),
    t("Fenêtre Propriétés", "Sectionneurs sans TK", ["D#§5.6.7"]),
    t("Menu réduit", "Sectionneurs avec TK", ["D#§5.6.6"], "chemin négatif"),
  ],
  questions: [
    {
      id: "q1",
      text: "Le menu d'un sectionneur avec TK en défaut change-t-il ?",
      why: "Le §5.6.6 ne dit pas ce que devient le menu.",
      sources: ['D#§5.6.6 "un sectionneur avec TK ne propose que Propriétés"'],
      answers: ["Oui, comme sans TK", "Non, seulement Propriétés"],
    },
  ],
};

function shown(over: Record<string, unknown> = {}) {
  api.routes["gen.show"] = () => ({
    generation: "g1",
    name: "Le sectionneur",
    request: "Le sectionneur",
    tests: [],
    skipped: [],
    suggestions: [],
    state: "planned",
    plan: PLAN,
    settled: [{ id: "q0", text: "Quelle version ?", answer: "La J5" }],
    overlaps: [{ tests: [0, 2], sections: ["D#§5.6.6"] }],
    cost: { runs: 3, seconds: 200, agents: 3 },
    stale: ["D"],
    reindexSeconds: 12,
    mtime: 42,
    ...over,
  });
  api.routes["gen.planSet"] = (i) => ({ tests: (i.plan as typeof PLAN).tests, questions: PLAN.questions });
}

function mountPlan(busy = false) {
  const onRevise = vi.fn();
  const onWrite = vi.fn();
  mountData(<PlanReview generation="g1" busy={busy} onRevise={onRevise} onWrite={onWrite} />);
  return { onRevise, onWrite };
}

describe("the plan's edits", () => {
  it("untick, move to a theme, merge two tests into the first; the cost in words", () => {
    expect(toggle(PLAN.tests, 1)[1].off).toBe(true);
    expect(toggle(toggle(PLAN.tests, 1), 1)[1]).not.toHaveProperty("off");
    expect(retheme(PLAN.tests, 0, "Menus")[0].theme).toBe("Menus");
    expect(retheme(PLAN.tests, 0, " ")[0]).not.toHaveProperty("theme");
    expect(merge(PLAN.tests, 0, 2)).toEqual([
      { ...PLAN.tests[0], technique: "cas d'utilisation, chemin négatif", sections: ["D#§5.6.6"] },
      PLAN.tests[1],
    ]);
    expect([about(40), about(200), about(3 * 3600 + 5 * 60)]).toEqual(["about 40 s", "about 3 min", "about 3 h 05"]);
  });
});

describe("Generate › the plan before writing", () => {
  it("says what it costs, asks its questions, flags two tests on the same sections, and writes with the answers", async () => {
    shown();
    const { onWrite } = mountPlan();
    const plan = await screen.findByRole("region", { name: "Plan" });
    expect(within(plan).getByRole("heading", { name: "3 tests in 2 themes" })).toBeInTheDocument();
    expect(plan).toHaveTextContent("3 Claude runs · about 3 min with 3 at a time");
    const list = within(plan).getByRole("list", { name: "Planned tests" });
    expect(within(list).getByText("Sectionneurs sans TK")).toBeInTheDocument();
    expect(within(list).getByText("Sectionneurs avec TK")).toBeInTheDocument();
    expect(within(list).getAllByText("Same sections as 3")).toHaveLength(1);
    expect(within(list).getAllByText("Same sections as 1")).toHaveLength(1);
    expect(within(plan).getByRole("checkbox", { name: "Reindex first (≈ 12 s)" })).toBeChecked();
    expect(within(plan).getByText(/Settled \(1\)/)).toBeInTheDocument();
    const q = within(plan).getByRole("region", { name: /^Le menu d'un sectionneur avec TK/ });
    expect(within(q).getByText("Le §5.6.6 ne dit pas ce que devient le menu.")).toBeInTheDocument();
    expect(plan).toHaveTextContent("1 question not answered");
    fireEvent.click(within(q).getByRole("radio", { name: "Non, seulement Propriétés" }));
    await waitFor(() => expect(plan).not.toHaveTextContent("question not answered"));
    fireEvent.click(within(plan).getByRole("button", { name: "Write the 3 tests" }));
    expect(onWrite).toHaveBeenCalledWith({
      generation: "g1",
      answers: { q1: "Non, seulement Propriétés" },
      reindex: true,
    });
  });

  it("an answer in the user's words, the words for Claude, and « Revise the plan »", async () => {
    shown({ stale: [], reindexSeconds: 0 });
    const { onRevise } = mountPlan();
    const plan = await screen.findByRole("region", { name: "Plan" });
    expect(within(plan).queryByRole("checkbox", { name: /Reindex first/ })).toBeNull();
    const revise = within(plan).getByRole("button", { name: "Revise the plan" });
    expect(revise).toHaveAccessibleDescription("Answer a question or say what should change");
    fireEvent.click(within(plan).getByRole("radio", { name: "Something else…" }));
    fireEvent.change(within(plan).getByRole("textbox", { name: "Your answer" }), {
      target: { value: "Selon la TK" },
    });
    fireEvent.change(within(plan).getByRole("textbox", { name: "What should change in the plan?" }), {
      target: { value: "Un test de plus pour le défaut" },
    });
    const again = () => within(plan).getByRole("button", { name: "Revise the plan" });
    await waitFor(() => expect(again()).toBeEnabled());
    fireEvent.click(again());
    expect(onRevise).toHaveBeenCalledWith({
      generation: "g1",
      answers: { q1: "Selon la TK" },
      request: "Un test de plus pour le défaut",
    });
  });

  it("each edit is written at once, against the ledger it read", async () => {
    shown();
    mountPlan();
    const plan = await screen.findByRole("region", { name: "Plan" });
    fireEvent.click(within(plan).getByRole("checkbox", { name: "Write « Fenêtre Propriétés »" }));
    await waitFor(() => expect(named("gen.planSet")).toHaveLength(1));
    expect(named("gen.planSet")[0].input).toEqual({
      generation: "g1",
      plan: { tests: [PLAN.tests[0], { ...PLAN.tests[1], off: true }, PLAN.tests[2]] },
      ifMtime: 42,
    });
    const first = () => within(plan).getByText("1. Menu contextuel").closest("li") as HTMLElement;
    fireEvent.pointerEnter(first());
    fireEvent.click(within(plan).getByRole("button", { name: "Merge « Menu contextuel » with another test" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^3\. Menu réduit/ }));
    await waitFor(() => expect(named("gen.planSet")).toHaveLength(2));
    expect((named("gen.planSet")[1].input as { plan: typeof PLAN }).plan.tests).toHaveLength(2);
    fireEvent.pointerEnter(first());
    fireEvent.click(within(plan).getByRole("button", { name: "Rename « Menu contextuel »" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename the test" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Summary" }), {
      target: { value: "Menu du sectionneur" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(named("gen.planSet")).toHaveLength(3));
    expect((named("gen.planSet")[2].input as { plan: typeof PLAN }).plan.tests[0].summary).toBe("Menu du sectionneur");
  });

  it("nothing can be asked while a run is under way", async () => {
    shown();
    mountPlan(true);
    const plan = await screen.findByRole("region", { name: "Plan" });
    expect(within(plan).getByRole("button", { name: "Write the 3 tests" })).toBeDisabled();
    expect(within(plan).getByRole("button", { name: "Revise the plan" })).toBeDisabled();
    expect(within(plan).getByRole("checkbox", { name: "Write « Menu contextuel »" })).toBeDisabled();
  });
});
