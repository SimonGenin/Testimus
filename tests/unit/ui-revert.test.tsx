// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Test, XrayJson } from "../../src/core/types.ts";
import { ApiError } from "../../src/ui/api.ts";
import { fixOutcome } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { editedAfterRun, revertRun } from "../../src/ui/lib/revert.ts";
import { ReviewTest } from "../../src/ui/screens/review/ReviewTest.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const xray: XrayJson = {
  fields: [{ id: "action", name: "Action", type: "text", builtin: true }],
  prefs: { order: ["Action"], collapsed: [], hidden: [] },
};

const test: Test = {
  key: "LFRPS12-1420",
  summary: "Sectionneur sans TK",
  folder: "/Traction",
  description: "",
  labels: [],
  covers: [],
  review: "to-fix",
  steps: [{ fields: { Action: "Ouvrir la vue de traction." }, sources: [], images: [] }],
} as unknown as Test;

const view = (over: Partial<Parameters<typeof ReviewTest>[0]> = {}) => {
  const props = {
    test,
    sync: "synced" as const,
    check: null,
    stale: false,
    xray,
    folded: new Set<number>(),
    activeStep: -1,
    selected: "",
    marks: { runId: "run-1", steps: new Set([1]), added: new Set<number>() },
    claudeRunning: false,
    url: (f: string) => f,
    onFold: vi.fn(),
    onFoldAll: vi.fn(),
    onSelect: vi.fn(),
    onOpenImage: vi.fn(),
    onEdit: vi.fn(),
    onRevert: vi.fn(),
    onCompare: vi.fn(),
    onTakeJira: vi.fn(),
    onKeepMine: vi.fn(),
    ...over,
  };
  render(<ReviewTest {...props} />);
  return props;
};

describe("revert after later edits", () => {
  it("recognises the refusal and re-sends with force", async () => {
    const refusal = new ApiError(
      "local-69d87001 changed after the Claude run run-1: reverting would lose those edits.",
      "Look at the test first; revert with force to discard the later edits too.",
    );
    expect(editedAfterRun(refusal)).toBe(true);
    expect(editedAfterRun(new Error("Unknown run"))).toBe(false);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ reverted: ["local-69d87001"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await revertRun("run-1", true);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ runId: "run-1", force: true });
  });

  it("offers Revert anyway in Review when the test was edited after the run", () => {
    const onRevertAnyway = vi.fn();
    const onKeepAfterRun = vi.fn();
    view({
      revertConflict: "LFRPS12-1420 changed after the Claude run run-1: reverting would lose those edits.",
      onRevertAnyway,
      onKeepAfterRun,
    });
    expect(screen.getByText("Edited after the Claude run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    expect(onRevertAnyway).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(onKeepAfterRun).toHaveBeenCalledTimes(1);
  });
});

describe("review.fix outcome", () => {
  it("says checked again, or still To fix with the server's message", () => {
    expect(fixOutcome({ review: "checked" })).toEqual({ word: "checked again" });
    expect(fixOutcome({ review: "to-fix", message: "The re-check found 1 error." })).toEqual({
      word: "still To fix",
      note: "The re-check found 1 error.",
    });
    expect(fixOutcome({})).toEqual({ word: "check queued" });
  });

  it("shows the message in Review when the fix left the test To fix", () => {
    view({ fixMessage: "The re-check found 1 error: wrong requirement on step 1." });
    expect(screen.getByText("Still To fix after Claude's fix")).toBeInTheDocument();
    expect(screen.getByText("The re-check found 1 error: wrong requirement on step 1.")).toBeInTheDocument();
  });
});
