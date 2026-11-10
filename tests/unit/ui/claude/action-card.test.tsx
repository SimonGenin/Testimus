// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLeft } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { ActionCard } from "../../../../src/ui/components/claude/ActionCard.tsx";
import type { Action } from "../../../../src/ui/lib/actions.ts";
import { iconOf } from "../../helpers/icons.ts";
import { dataWrapper, fakeNet, net } from "../../helpers/ui-data.tsx";

const TEST = "local-0000000a";

const action = (left?: ActionLeft, over: Partial<Action> = {}): Action => ({
  id: "act-1",
  title: "Fix 3 findings in « Sectionneur avec TK »",
  scope: { kind: "test", testId: TEST },
  where: `test:${TEST}`,
  problem: "Step 2 cites a passage that says otherwise.",
  why: "The check found it.",
  plan: [],
  stamp: "s",
  proposedBy: { run: "check", model: "sonnet", effort: "high", at: "2026-11-10T09:00:00Z" },
  state: "open",
  at: "2026-11-10T09:00:00Z",
  stale: false,
  target: { kind: "test", id: TEST, name: "Sectionneur avec TK" },
  last: {
    runId: "run-9",
    ok: true,
    summary: "Step 2 now says two entries.",
    at: "2026-11-10T09:05:00Z",
    model: "sonnet",
    effort: "high",
    ...(left ? { left } : {}),
  },
  ...over,
});

beforeEach(() => {
  fakeNet();
  setProject("C:\\action-card");
  net.routes["tests.list"] = () => [{ id: TEST, summary: "Sectionneur avec TK" }];
});

afterEach(() => {
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
});

function show(a: Action, ready = false) {
  render(
    <ActionCard
      action={a}
      ready={ready}
      busy={false}
      model="sonnet"
      effort="high"
      grouped
      meta="sonnet · high"
      onModel={() => {}}
      onEffort={() => {}}
      onRun={() => {}}
      onLater={() => {}}
      onDismiss={() => {}}
    >
      <p>Step 2 now says two entries.</p>
    </ActionCard>,
    { wrapper: dataWrapper() },
  );
  return screen.getByRole("region", { name: `Claude action: ${a.title}` });
}

describe("ActionCard › what the run left of the problem", () => {
  it("« 3 findings → 0 »: nothing is left, said as a success beside the scope, counted by Testimus", () => {
    const card = show(action({ was: 3, now: 0, of: "findings" }));
    const left = within(card).getByText("3 findings → 0");
    expect(iconOf(left)).toBe("check-circle");
    expect(left).toHaveAccessibleDescription("Counted by Testimus where the problem is: 3 before the run, 0 after it.");
    expect(card).toHaveTextContent("Whole test3 findings → 0");
    expect(card).toHaveTextContent("Step 2 now says two entries.");
  });

  it("« 3 findings → 1 left »: the problem is not gone, said as a warning", () => {
    const card = show(action({ was: 3, now: 1, of: "findings" }));
    const left = within(card).getByText("3 findings → 1 left");
    expect(iconOf(left)).toBe("alert-triangle");
    expect(left).toHaveAccessibleDescription("Counted by Testimus where the problem is: 3 before the run, 1 after it.");
    cleanup();
    const gone = within(show(action({ was: 3, now: 0, of: "findings" }))).getByText("3 findings → 0");
    expect(gone.getAttribute("class")).not.toBe(left.getAttribute("class"));
  });

  it("counts in the words of what was counted, one or several, and says when a run left more than it found", () => {
    expect(within(show(action({ was: 1, now: 0, of: "findings" }))).getByText("1 finding → 0")).toBeInTheDocument();
    cleanup();
    expect(
      within(show(action({ was: 2, now: 1, of: "warnings" }))).getByText("2 warnings → 1 left"),
    ).toBeInTheDocument();
    cleanup();
    const worse = within(show(action({ was: 1, now: 2, of: "warnings" }))).getByText("1 warning → 2 left");
    expect(iconOf(worse)).toBe("alert-triangle");
  });

  it("an action never run, or a run Testimus could not recount, shows no count", () => {
    const never = show(action(undefined, { last: undefined }), true);
    expect(never).toHaveTextContent("Whole test");
    expect(never).not.toHaveTextContent("→");
    expect(within(never).getByRole("button", { name: "Run" })).toBeEnabled();
    cleanup();
    expect(show(action())).not.toHaveTextContent("→");
  });

  it("an open action that ran before keeps its count while it waits to be run again", () => {
    const card = show(action({ was: 3, now: 1, of: "findings" }), true);
    expect(within(card).getByText("3 findings → 1 left")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Run" })).toBeEnabled();
    expect(card).toHaveTextContent("Step 2 cites a passage that says otherwise.");
  });
});
