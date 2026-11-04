// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Step } from "../../../../../src/core/types.ts";
import { ReviewStep } from "../../../../../src/ui/screens/review/ReviewStep.tsx";
import { StepCard } from "../../../../../src/ui/screens/tests/StepCard.tsx";
import { edgeOf, GoneFrame, StepFrame } from "../../../../../src/ui/screens/tests/step/StepFrame.tsx";
import { layoutOf } from "../../../helpers/layout.ts";

afterEach(cleanup);

const xray = layoutOf(
  [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  { order: ["Action", "Expected Result"], collapsed: [], hidden: [] },
);

const step: Step = {
  fields: { Action: "Open the view", "Expected Result": "The view opens" },
  sources: [{ docId: "D1", anchor: "§1", quote: "opens" }],
  images: [],
};

const tests = (over: { claude?: boolean; folded?: boolean; focused?: boolean } = {}) =>
  render(
    <StepCard
      index={1}
      count={3}
      step={step}
      xray={xray}
      layout="stacked"
      url={(f) => f}
      onChange={vi.fn()}
      {...over}
    />,
  ).container.querySelector("article") as HTMLElement;

const review = (over: { claude?: boolean; folded?: boolean; active?: boolean } = {}) =>
  render(
    <ReviewStep
      n={2}
      step={step}
      xray={xray}
      findings={[]}
      stale={false}
      folded={false}
      active={false}
      selected=""
      url={(f) => f}
      onFold={vi.fn()}
      onSelect={vi.fn()}
      onOpenImage={vi.fn()}
      {...over}
    />,
  ).container.querySelector("article") as HTMLElement;

// the look of a card: its frame (the kit Card inside the article), its head, its number
const look = (a: HTMLElement) => {
  const frame = a.firstElementChild as HTMLElement;
  const head = frame.firstElementChild?.firstElementChild?.firstElementChild as HTMLElement;
  return [frame.className, head.className, within(a).getByTestId("step-number").className];
};

describe("the one step card of Tests and Review", () => {
  it("draws the same frame, head and number in both screens, open or folded, plain or changed by Claude", () => {
    for (const state of [{}, { claude: true }, { folded: true }, { claude: true, folded: true }]) {
      const a = look(tests(state));
      cleanup();
      const b = look(review(state));
      cleanup();
      expect(b).toEqual(a);
    }
  });

  it("rings the step in focus — the editor's focused step, Review's active one — the same way", () => {
    const a = look(tests({ focused: true }));
    cleanup();
    const b = look(review({ active: true }));
    expect(b).toEqual(a);
    expect(screen.getByRole("article", { name: "Step 2" })).toHaveAttribute("aria-current", "step");
  });

  it("gives the step's diff state as the Card's edge: unreadable over Claude over new over modified", () => {
    expect(edgeOf({})).toBeUndefined();
    expect(edgeOf({ mark: "same" })).toBeUndefined();
    expect(edgeOf({ mark: "modified" })).toBe("warning");
    expect(edgeOf({ mark: "new" })).toBe("success");
    expect(edgeOf({ mark: "new", claude: true })).toBe("claude");
    expect(edgeOf({ claude: true, unreadable: true })).toBe("danger");
  });

  it("names the step, says its states and keeps a folded card to its head", () => {
    render(
      <StepFrame n={4} marks={{ mark: "modified", claude: true }} line="First line" dragging head={<span>tail</span>}>
        <p>body</p>
      </StepFrame>,
    );
    const a = screen.getByRole("article", { name: "Step 4" });
    for (const k of ["data-folded", "data-claude", "data-dragging"]) expect(a).toHaveAttribute(k);
    expect(a).toHaveAttribute("data-mark", "modified");
    expect(within(a).getByTestId("step-line")).toHaveTextContent("First line");
    expect(within(a).getByText("tail")).toBeInTheDocument();
    expect(within(a).queryByText("body")).toBeNull();
  });

  it("draws a deleted step as a region with its head and what is under it", () => {
    render(
      <GoneFrame head={<span>Deleted</span>}>
        <p>Jira version</p>
      </GoneFrame>,
    );
    const r = screen.getByRole("region", { name: "Deleted step" });
    expect(within(r).getByText("Deleted")).toBeInTheDocument();
    expect(within(r).getByText("Jira version")).toBeInTheDocument();
  });
});
