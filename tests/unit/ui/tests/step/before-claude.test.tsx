// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding, Step, Test } from "../../../../../src/core/types.ts";
import type { ClaudeBefore } from "../../../../../src/ui/lib/diff.ts";
import { ReviewStep } from "../../../../../src/ui/screens/review/ReviewStep.tsx";
import { ReviewTest } from "../../../../../src/ui/screens/review/ReviewTest.tsx";
import { StepCard } from "../../../../../src/ui/screens/tests/StepCard.tsx";
import { layoutOf } from "../../../helpers/layout.ts";

afterEach(cleanup);

const xray = layoutOf(
  [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  { order: ["Action", "Expected Result"], collapsed: [], hidden: [] },
);
const step = (action: string): Step => ({
  fields: { Action: action, "Expected Result": "Le menu s'ouvre." },
  sources: [],
  images: [],
});

describe("a step as it was before Claude's run", () => {
  it("StepCard: « Before Claude » opens the earlier version, read-only, and restores it", () => {
    const onRestoreClaude = vi.fn();
    render(
      <StepCard
        index={1}
        count={3}
        step={step("Clic droit, puis vérifier.")}
        xray={xray}
        layout="stacked"
        claude
        claudeBefore={step("Clic droit.")}
        url={(f) => f}
        onChange={vi.fn()}
        onRestoreClaude={onRestoreClaude}
      />,
    );
    expect(screen.queryByRole("region", { name: "Step 2 before Claude's run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Before Claude" }));
    const was = screen.getByRole("region", { name: "Step 2 before Claude's run" });
    expect(was).toHaveTextContent("Before Claude's run");
    expect(was).toHaveTextContent("Clic droit.");
    expect(screen.getByRole("button", { name: "Hide before Claude" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(was).getByRole("button", { name: "Restore this step" }));
    expect(onRestoreClaude).toHaveBeenCalledWith(step("Clic droit."));
  });

  it("StepCard: no toggle without an earlier version, none to restore when read-only", () => {
    const { rerender } = render(
      <StepCard index={0} count={1} step={step("a")} xray={xray} layout="stacked" url={(f) => f} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Before Claude" })).toBeNull();
    rerender(
      <StepCard
        index={0}
        count={1}
        step={step("a")}
        xray={xray}
        layout="stacked"
        readOnly
        claudeBefore={step("b")}
        url={(f) => f}
        onChange={vi.fn()}
        onRestoreClaude={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Before Claude" }));
    expect(screen.queryByRole("button", { name: "Restore this step" })).toBeNull();
  });

  it("ReviewStep: the same toggle, read-only", () => {
    render(
      <ReviewStep
        n={2}
        step={step("Clic droit, puis vérifier.")}
        xray={xray}
        findings={[] as Finding[]}
        stale={false}
        folded={false}
        active={false}
        claude
        claudeBefore={step("Clic droit.")}
        selected=""
        url={(f) => f}
        onFold={vi.fn()}
        onSelect={vi.fn()}
        onOpenImage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Before Claude" }));
    const was = screen.getByRole("region", { name: "Step 2 before Claude's run" });
    expect(was).toHaveTextContent("Clic droit.");
    expect(within(was).queryByRole("button", { name: "Restore this step" })).toBeNull();
  });

  it("ReviewTest: from claude.before, a changed step is Claude's while untouched, a deleted one shows where it was", () => {
    const test = { summary: "T", folder: "/", steps: [step("a"), step("B!")], review: "draft" } as unknown as Test;
    const run = (untouched: boolean): ClaudeBefore => ({
      runId: "run-1",
      at: "2026-11-05T10:00:00.000Z",
      steps: [2],
      untouched,
      test: { ...test, steps: [step("a"), step("b"), step("c")] },
    });
    const props = {
      test,
      testId: "local-1",
      sync: "local" as const,
      check: null,
      stale: false,
      xray,
      folded: new Set<number>(),
      activeStep: -1,
      selected: "",
      marks: null,
      claudeRunning: false,
      url: (f: string) => f,
      onFold: vi.fn(),
      onFoldAll: vi.fn(),
      onSelect: vi.fn(),
      onOpenImage: vi.fn(),
      onEdit: vi.fn(),
    } as unknown as Parameters<typeof ReviewTest>[0];
    const { rerender } = render(<ReviewTest {...props} claudeRun={run(true)} />);
    const second = screen.getByRole("article", { name: "Step 2" });
    expect(within(second).getByText("Changed by Claude")).toBeInTheDocument();
    expect(within(second).getByRole("button", { name: "Before Claude" })).toBeInTheDocument();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    rerender(<ReviewTest {...props} claudeRun={run(false)} />);
    const edited = screen.getByRole("article", { name: "Step 2" });
    expect(within(edited).queryByText("Changed by Claude")).toBeNull();
    expect(within(edited).getByRole("button", { name: "Before Claude" })).toBeInTheDocument();
  });
});
