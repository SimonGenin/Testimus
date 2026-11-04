// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, ClaudeRun } from "../../../../src/ui/lib/app.ts";
import { apply } from "../../../../src/ui/lib/data/events.ts";
import { ReviewScreen } from "../../../../src/ui/screens/review/ReviewScreen.tsx";
import { clearToasts, fakeServer, item, mountReview, named, net, refused, reviewRoutes } from "./helpers.tsx";

vi.mock("../../../../src/ui/screens/tests/TestEditor.tsx", () => ({
  TestEditor: ({
    testId,
    onOpen,
    onSaved,
    onBack,
  }: {
    testId: string;
    onOpen: (id: string) => void;
    onSaved: () => void;
    onBack?: () => void;
  }) => (
    <div>
      <span>Editor for {testId}</span>
      <button type="button" onClick={onBack}>
        Back to review
      </button>
      <button type="button" onClick={() => onOpen("OTHER")}>
        Open other
      </button>
      <button type="button" onClick={onSaved}>
        Saved
      </button>
    </div>
  ),
}));

vi.mock("../../../../src/ui/screens/tests/PushDialog.tsx", () => ({
  PushDialog: ({ onDone, onClose, onCompare }: { onDone: () => void; onClose: () => void; onCompare: () => void }) => (
    <div role="dialog" aria-label="Push stub">
      <button type="button" onClick={onDone}>
        Push done
      </button>
      <button type="button" onClick={onClose}>
        Push close
      </button>
      <button type="button" onClick={onCompare}>
        Push compare
      </button>
    </div>
  ),
}));

beforeEach(() => {
  fakeServer();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const show = (over: Partial<AppState> = {}) =>
  mountReview(<ReviewScreen />, { route: { screen: "review", arg: "K-1" }, ...over });

const key = (k: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(window, { key: k, ...extra });

const step = (n: number) => screen.getByRole("article", { name: `Step ${n}` });
const queue = () => screen.getByRole("complementary", { name: "Review queue" });
const position = () => screen.getByTestId("queue-position");
const toast = (title: string) =>
  screen.getAllByRole("status").find((e) => e.textContent?.startsWith(title)) as HTMLElement;
const dialog = () => screen.getByRole("dialog", { name: "What needs fixing?" });

const openFix = () =>
  waitFor(() => {
    key("f");
    expect(dialog()).toBeInTheDocument();
  });

describe("Review screen", () => {
  it("opens the first test of the queue with no source open, and the header counts", async () => {
    reviewRoutes();
    const { app: a } = show({ route: { screen: "documents" } });
    expect(await screen.findByRole("heading", { name: "Summary K-1" })).toBeInTheDocument();
    expect(within(queue()).getByText("Queue")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Review/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    expect(named("rag.passage")).toHaveLength(0);
    expect(position()).toHaveTextContent("1 / 3");
    await waitFor(() =>
      expect(a.setFocus).toHaveBeenCalledWith({ testId: "K-1", key: "K-1", summary: "Summary K-1", step: null }),
    );
    expect(screen.getByText("In sync")).toBeInTheDocument();
  });

  it("a source link opens the panel, the same link or the X closes it, the arrows follow it only while open", async () => {
    reviewRoutes({ findings: [] });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    key("ArrowDown");
    key("ArrowDown");
    await waitFor(() => expect(step(2)).toHaveAttribute("aria-current", "step"));
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    const chip = () => within(step(2)).getByRole("button", { name: /D §2/ });
    fireEvent.click(chip());
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Passage D#§2" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 sources")).toBeInTheDocument();
    key("ArrowDown");
    expect(await screen.findByText("Source of step 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous source" }));
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next source" }));
    expect(await screen.findByText("Source of step 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the source panel" }));
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    fireEvent.click(chip());
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
    fireEvent.click(chip());
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
  });

  it("a whole-test finding's source opens on click; the stale error count", async () => {
    reviewRoutes({
      findings: [
        { kind: "source-missing", severity: "error", message: "whole", sources: ["W#§0", "W"] },
        { step: 2, kind: "source-missing", severity: "error", message: "s2", sources: ["D#§5"] },
      ],
      stale: true,
      sync: "local",
    });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(await screen.findByText("Whole-test finding · Source missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the source panel" }));
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /W §0/ })[0]);
    expect(await screen.findByText("Source of the whole-test finding")).toBeInTheDocument();
    expect(
      screen.getByRole("tooltip", { hidden: true, name: "2 errors still open · out of date" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 4 sources")).toBeInTheDocument();
    expect(within(step(1)).getByRole("button", { name: "Expand step 1" })).toBeInTheDocument();
    expect(within(step(2)).getByRole("button", { name: "Fold step 2" })).toBeInTheDocument();
  });

  it("a test never checked shows every step open, none of them claiming no findings", async () => {
    reviewRoutes();
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(within(step(1)).getByRole("button", { name: "Fold step 1" })).toBeInTheDocument();
    expect(within(step(3)).getByRole("button", { name: "Fold step 3" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Test under review" })).queryByText("No findings")).toBeNull();
  });

  it("a test without sources opens no panel; a local test reads as local", async () => {
    reviewRoutes({
      queue: [item("L-1")],
      tests: { "L-1": { steps: [{ fields: { Action: "x" }, sources: [], images: [] }] } },
    });
    show({ route: { screen: "review", arg: "L-1" } });
    expect(await screen.findByRole("heading", { name: "Summary L-1" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    expect(screen.getByText("Local only")).toBeInTheDocument();
  });

  it("an unreadable check is treated as not checked; an unreadable test says so", async () => {
    reviewRoutes();
    delete net.routes["check.show"];
    show();
    expect(await screen.findByText("Not checked yet", { selector: "span" })).toBeInTheDocument();
    cleanup();
    reviewRoutes();
    delete net.routes["tests.show"];
    show();
    expect(await screen.findByText("This test could not be opened")).toBeInTheDocument();
  });

  it("an empty queue offers to generate; a failed queue is reported and can be read again", async () => {
    reviewRoutes({ queue: [] });
    net.routes["review.queue"] = () => null;
    const { app: a } = show({ route: { screen: "review" } });
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(position()).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: /^Validate/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "To fix" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate tests" }));
    expect(a.navigate).toHaveBeenCalledWith("generate");
    key("j");
    key("v");
    expect(named("review.set")).toHaveLength(0);
    cleanup();
    reviewRoutes();
    delete net.routes["review.queue"];
    show({ route: { screen: "review" } });
    expect(await screen.findByText("Could not read the review queue")).toBeInTheDocument();
    reviewRoutes();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Summary K-1" })).toBeInTheDocument();
  });

  it("every test of the filter reviewed: the queue says so and offers the tests", async () => {
    reviewRoutes({ queue: [] });
    net.routes["review.queue"] = () => ({
      tests: [],
      counts: { checked: 0, toFix: 0, draft: 0, unchecked: 0, validated: 2 },
    });
    const { app: a } = show({ route: { screen: "review" } });
    expect(await screen.findByText("All reviewed")).toBeInTheDocument();
    expect(screen.getByText(/2 tests validated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the tests" }));
    expect(a.navigate).toHaveBeenCalledWith("tests");
  });

  it("sends the queue filters, folder and findings switch", async () => {
    reviewRoutes();
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    const states = screen.getByRole("radiogroup", { name: "Filter by review state" });
    fireEvent.click(within(states).getByRole("radio", { name: /To fix/ }));
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toEqual({ state: ["to-fix"], sort: "anomalies" }));
    fireEvent.click(within(states).getByRole("radio", { name: /Validated/ }));
    await waitFor(() =>
      expect(named("review.queue").at(-1)?.input).toEqual({ state: ["validated"], sort: "anomalies" }),
    );
    await waitFor(() => expect(screen.getByRole("option", { name: "/F" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by folder" }), { target: { value: "/F" } });
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toMatchObject({ folder: "/F" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Only with findings" }));
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toMatchObject({ withFindings: true }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort the queue" }), { target: { value: "recent" } });
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toMatchObject({ sort: "recent" }));
  });

  it("moves between tests with J/K and the strip, and between steps with the arrows", async () => {
    reviewRoutes();
    const { app: a } = show({ route: { screen: "review", arg: "K-2" } });
    await screen.findByRole("heading", { name: "Summary K-2" });
    await waitFor(() => expect(position()).toHaveTextContent("2 / 3"));
    key("j");
    expect(a.navigate).toHaveBeenLastCalledWith("review", "L-3");
    key("K");
    expect(a.navigate).toHaveBeenLastCalledWith("review", "K-1");
    fireEvent.click(screen.getByRole("button", { name: "Next test (J)" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous test (K)" }));
    expect(a.navigate).toHaveBeenCalledTimes(4);
    key("j", { ctrlKey: true });
    key("q");
    expect(a.navigate).toHaveBeenCalledTimes(4);
    key("ArrowDown");
    await waitFor(() => expect(step(1)).toHaveAttribute("aria-current", "step"));
    key("ArrowDown");
    await waitFor(() => expect(step(2)).toHaveAttribute("aria-current", "step"));
    key("ArrowDown");
    key("ArrowDown");
    await waitFor(() => expect(step(3)).toHaveAttribute("aria-current", "step"));
    key("ArrowUp");
    await waitFor(() => expect(step(2)).toHaveAttribute("aria-current", "step"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await waitFor(() => expect(a.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ step: 2 })));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "j" });
    expect(a.navigate).toHaveBeenCalledTimes(4);
    input.remove();
  });

  it("at the end of the queue J stays; a dialog blocks the keys", async () => {
    reviewRoutes({ queue: [item("K-1")] });
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await waitFor(() => expect(position()).toHaveTextContent("1 / 1"));
    key("j");
    key("k");
    expect(a.navigate).not.toHaveBeenCalled();
    const veil = document.createElement("div");
    veil.setAttribute("aria-modal", "true");
    document.body.appendChild(veil);
    key("v");
    expect(named("review.set")).toHaveLength(0);
    veil.remove();
  });

  it("folds and unfolds steps, selects sources and opens documents and images", async () => {
    reviewRoutes({
      tests: {
        "K-1": {
          steps: [
            { fields: { Action: "![](a.png)" }, sources: [], images: [{ file: "a.png" }] as never },
            {
              fields: { Action: "Two" },
              sources: [
                { docId: "D", anchor: "§2", quote: "q2" },
                { docId: "D", anchor: "§2", quote: "again" },
              ],
              images: [],
            },
          ],
        },
      },
      findings: [{ step: 1, kind: "source-missing", severity: "info", message: "n", sources: [] }],
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    expect(within(step(1)).getByRole("button", { name: "Expand step 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    expect(within(step(2)).getByRole("button", { name: "Fold step 2" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /D §2/ })[0]);
    await waitFor(() => expect(step(2)).toHaveAttribute("aria-current", "step"));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 2" }));
    await waitFor(() => expect(step(2)).not.toHaveAttribute("aria-current"));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand step 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a.png" }));
    expect(open).toHaveBeenCalledWith("/files/tests/K-1/a.png", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Open in document" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", 'D#§2 "q2"');
  });

  it("evidence picks: a step source keeps its step, another read one is labelled", async () => {
    reviewRoutes({ findings: [] });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    fireEvent.click(screen.getAllByRole("button", { name: /D §2/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Sources read/ }));
    fireEvent.click(await screen.findByRole("option", { name: /E#§7/ }));
    expect(await screen.findByText("Read by the generation")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 sources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /^D#§2/ }));
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
  });

  it("validates with the button, opens the next test from the queue read again, or the empty queue after the last one", async () => {
    const r = reviewRoutes();
    const { app: a } = show({ route: { screen: "review", arg: "L-3" } });
    await screen.findByRole("heading", { name: "Summary L-3" });
    await waitFor(() => expect(position()).toHaveTextContent("3 / 3"));
    r.setQueue([item("K-1"), item("K-2")]);
    fireEvent.click(screen.getByRole("button", { name: /^Validate(?!d)/ }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("review", "K-2"));
    expect(named("review.set")[0].input).toEqual({ id: "L-3", decision: "validate" });
    await waitFor(() => expect(toast("Validated")).toHaveTextContent("Summary L-3"));
    r.setQueue([]);
    await waitFor(() => {
      key("v");
      expect(a.navigate).toHaveBeenLastCalledWith("review");
    });
  });

  it("a refused validation is reported", async () => {
    reviewRoutes();
    net.routes["review.set"] = () => refused("The test is locked");
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await waitFor(() => {
      key("v");
      expect(screen.getByText("Could not validate the test")).toBeInTheDocument();
    });
  });

  it("marks To fix without Claude: the note is kept, the next test opens", async () => {
    reviewRoutes({ tests: { "K-1": { review: "to-fix", reviewNote: "earlier note" } } });
    net.routes["claude.status"] = () => ({ installed: false, signedIn: null });
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "To fix", pressed: true }));
    const dlg = dialog();
    expect(within(dlg).getByLabelText(/Note for the author/)).toHaveValue("earlier note");
    expect(within(dlg).getByRole("button", { name: "Ask Claude to fix it" })).toBeDisabled();
    key("v");
    expect(named("review.set")).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: /Mark To fix/ }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("review", "K-2"));
    expect(named("review.set")[0].input).toEqual({ id: "K-1", decision: "to-fix", note: "earlier note" });
    expect(await screen.findByText("Marked To fix")).toBeInTheDocument();
  });

  it("the To fix note can be closed, and a refused mark is reported", async () => {
    reviewRoutes();
    net.routes["claude.status"] = () => refused("no");
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await openFix();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "What needs fixing?" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "To fix", pressed: false }));
    fireEvent.click(await screen.findByRole("button", { name: "To fix", pressed: true }));
    expect(screen.queryByRole("dialog", { name: "What needs fixing?" })).toBeNull();
    net.routes["review.set"] = () => refused("bad");
    await openFix();
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    expect(await screen.findByText("Could not mark the test To fix")).toBeInTheDocument();
  });

  it("edits the test and comes back; keys do not decide while editing", async () => {
    reviewRoutes();
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Editor for K-1")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    key("v");
    key("j");
    expect(named("review.set")).toHaveLength(0);
    expect(a.navigate).toHaveBeenCalledWith("review", "K-2");
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    fireEvent.click(screen.getByRole("button", { name: "Open other" }));
    expect(a.navigate).toHaveBeenCalledWith("tests", "OTHER");
    expect(screen.queryByRole("button", { name: "Ask Claude" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(await screen.findByRole("heading", { name: "Summary K-1" })).toBeInTheDocument();
  });

  it("a Claude run marks its steps, reverts them, handles a conflict, then a forced failure", async () => {
    reviewRoutes({ findings: [] });
    const run = (over: Partial<ClaudeRun>): ClaudeRun => ({
      runId: "run-1",
      changedTests: [],
      changedSteps: {},
      nonce: Math.random(),
      ...over,
    });
    const { app: a, rerender } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    rerender(<ReviewScreen />, { lastRun: run({ changedTests: ["OTHER"] }) });
    expect(screen.queryByText(/Claude changed/)).toBeNull();
    rerender(<ReviewScreen />, { lastRun: run({ changedSteps: { "K-1": [1, 4] } }) });
    expect(await screen.findByText("Claude changed 2 steps")).toBeInTheDocument();
    expect(within(step(1)).getByRole("button", { name: "Fold step 1" })).toBeInTheDocument();
    net.routes["claude.revert"] = () =>
      refused("K-1 changed after the Claude run run-1: reverting would lose those edits.", "edited-after-run", 409);
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(await screen.findByText("Edited after the Claude run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(screen.queryByText("Edited after the Claude run")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await screen.findByText("Edited after the Claude run");
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    expect(await screen.findByText("Could not revert Claude's changes")).toBeInTheDocument();
    expect(named("claude.revert").at(-1)?.input).toEqual({ runId: "run-1", force: true });
    net.routes["claude.revert"] = () => ({ reverted: ["K-1"] });
    const reads = named("tests.show").length;
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    expect(await screen.findByText("Claude's changes reverted")).toBeInTheDocument();
    expect(a.setLastRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "" }));
    await waitFor(() => expect(named("tests.show").length).toBeGreaterThan(reads));
    rerender(<ReviewScreen />, { lastRun: run({ changedTests: ["K-1"] }) });
    expect(await screen.findByText("Claude changed 0 steps")).toBeInTheDocument();
    rerender(<ReviewScreen />, { lastRun: run({ runId: "" }) });
    await waitFor(() => expect(screen.queryByText(/Claude changed/)).toBeNull());
  });

  it("while Claude fixes the test the decisions are off; its unfinished fix is explained", async () => {
    reviewRoutes({ tests: { "K-1": { review: "to-fix" } } });
    const { rerender } = show({ claudeRunning: "K-1" });
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.getByText("Claude is fixing this test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Validate(?!d)/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "To fix" })).toBeDisabled();
    const done = { runId: "r", changedTests: [], changedSteps: {}, nonce: 1, testId: "K-1", review: "to-fix" };
    rerender(<ReviewScreen />, { claudeRunning: null, lastRun: { ...done, message: "Two errors left" } });
    expect(await screen.findByRole("status", { name: "Claude's fix" })).toHaveTextContent("Two errors left");
    rerender(<ReviewScreen />, { lastRun: { ...done, nonce: 2 } });
    expect(screen.getByRole("status", { name: "Claude's fix" })).toHaveTextContent(
      "Claude's fix did not bring the test back to Checked.",
    );
    rerender(<ReviewScreen />, { lastRun: { ...done, nonce: 3, review: "checked" } });
    expect(screen.queryByRole("status", { name: "Claude's fix" })).toBeNull();
  });

  it("To fix + Ask Claude to fix it is one run: review.fix with the note marks the test, nothing else is called", async () => {
    reviewRoutes();
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await openFix();
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "Fix step 2" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Ask Claude to fix it" }));
    await waitFor(() =>
      expect(a.runInDock).toHaveBeenCalledWith({
        name: "review.fix",
        input: { id: "K-1", note: "Fix step 2" },
        label: "Fix step 2",
        testId: "K-1",
      }),
    );
    expect(named("review.set")).toHaveLength(0);
    expect(a.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "What needs fixing?" })).toBeNull();
  });

  it("a test marked To fix shows its note, asks Claude from it, and edits it", async () => {
    reviewRoutes({ tests: { "K-1": { review: "to-fix", reviewNote: "Step 2 is vague", reviewedBy: "Ana" } } });
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    const note = screen.getByRole("note", { name: "To fix note" });
    expect(note).toHaveTextContent("To fix — Ana");
    expect(note).toHaveTextContent("Step 2 is vague");
    fireEvent.click(within(note).getByRole("button", { name: "Ask Claude to fix it" }));
    await waitFor(() =>
      expect(a.runInDock).toHaveBeenCalledWith({
        name: "review.fix",
        input: { id: "K-1" },
        label: "Step 2 is vague",
        testId: "K-1",
      }),
    );
    fireEvent.click(within(note).getByRole("button", { name: "Edit the note" }));
    expect(within(dialog()).getByLabelText(/Note for the author/)).toHaveValue("Step 2 is vague");
  });

  it("a test changed in Jira: compare, take Jira's version (or fail), keep mine through the push", async () => {
    reviewRoutes({ sync: "remote-changed" });
    net.routes["xray.pull"] = () => ({});
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(a.navigate).toHaveBeenCalledWith("tests", "K-1");
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    expect(await screen.findByText("Jira's version taken")).toBeInTheDocument();
    expect(named("xray.pull")[0].input).toEqual({ key: "K-1", overwrite: true });
    net.routes["xray.pull"] = () => refused("Jira is unreachable");
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    expect(await screen.findByText("Could not pull K-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    const push = screen.getByRole("dialog", { name: "Push stub" });
    key("j");
    expect(a.navigate).not.toHaveBeenCalledWith("review", "K-2");
    fireEvent.click(within(push).getByRole("button", { name: "Push compare" }));
    expect(a.navigate).toHaveBeenCalledTimes(2);
    fireEvent.click(within(push).getByRole("button", { name: "Push close" }));
    expect(screen.queryByRole("dialog", { name: "Push stub" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    fireEvent.click(screen.getByRole("button", { name: "Push done" }));
    expect(screen.queryByRole("dialog", { name: "Push stub" })).toBeNull();
  });

  it("a long job's end comes from jobs.show: the pull runs until its job is done", async () => {
    reviewRoutes({ sync: "remote-changed" });
    let status = "running";
    let n = 0;
    net.routes["xray.pull"] = () => ({ jobId: `job-${++n}` });
    net.routes["jobs.show"] = () => ({
      job: {
        id: `job-${n}`,
        kind: "pull",
        subject: "K-1",
        status,
        startedAt: "",
        error: status === "failed" ? "Jira said no" : undefined,
      },
      events: [],
    });
    const { client } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    await waitFor(() => expect(named("jobs.show")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Take Jira's version" })).toHaveAttribute("aria-busy", "true");
    status = "done";
    act(() =>
      apply(client, {
        jobId: "job-1",
        at: "",
        type: "status",
        job: { id: "job-1", kind: "pull", subject: "K-1", status: "done", startedAt: "" },
      }),
    );
    expect(await screen.findByText("Jira's version taken")).toBeInTheDocument();
    status = "failed";
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    await waitFor(() => expect(named("xray.pull")).toHaveLength(2));
    act(() =>
      apply(client, {
        jobId: "job-2",
        at: "",
        type: "status",
        job: { id: "job-2", kind: "pull", subject: "K-1", status: "failed", startedAt: "", error: "Jira said no" },
      }),
    );
    expect(await screen.findByText("Could not pull K-1")).toBeInTheDocument();
    expect(screen.getByText("Jira said no")).toBeInTheDocument();
  });

  it("a local test changed remotely cannot take Jira's version", async () => {
    reviewRoutes({ queue: [item("L-1")], sync: "remote-changed" });
    show({ route: { screen: "review", arg: "L-1" } });
    await screen.findByRole("heading", { name: "Summary L-1" });
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    await act(async () => {});
    expect(named("xray.pull")).toHaveLength(0);
  });

  it("reads the same test again when its file changes, keeping the view", async () => {
    reviewRoutes({ findings: [] });
    const { client, rerender } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    const before = named("tests.show").length;
    act(() => apply(client, { jobId: "", at: "", type: "changed", paths: ["tests/K-1/test.md"] }));
    await waitFor(() => expect(named("tests.show").length).toBe(before + 1));
    expect(within(step(2)).getByRole("button", { name: "Fold step 2" })).toBeInTheDocument();
    rerender(<ReviewScreen />, { route: { screen: "review", arg: "K-2" } });
    expect(await screen.findByRole("heading", { name: "Summary K-2" })).toBeInTheDocument();
  });

  it("a local test with no note marked To fix; counts with nothing unchecked; a whole-test source", async () => {
    reviewRoutes({
      queue: [item("L-1"), item("L-2")],
      tests: { "L-1": { review: "to-fix" } },
      findings: [{ kind: "source-missing", severity: "warning", message: "w", sources: ["W#§0"] }],
    });
    net.routes["review.queue"] = () => ({
      tests: [item("L-1"), item("L-2")],
      counts: { checked: 1, toFix: 1, draft: 0, unchecked: 0 },
    });
    net.routes["claude.status"] = () => ({ installed: false, signedIn: null });
    const { app: a } = show({ route: { screen: "review", arg: "L-1" } });
    await screen.findByRole("heading", { name: "Summary L-1" });
    expect(screen.queryByText(/not checked yet/)).toBeNull();
    expect(await screen.findByText("Whole-test finding · Source missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the source panel" }));
    fireEvent.click(screen.getAllByRole("button", { name: /W §0/ })[0]);
    expect(await screen.findByText("Source of the whole-test finding")).toBeInTheDocument();
    expect(within(step(1)).getByRole("button", { name: "Expand step 1" })).toBeInTheDocument();
    await openFix();
    const note = screen.getByLabelText(/Note for the author/);
    expect(note).toHaveValue("");
    fireEvent.change(note, { target: { value: "fix" } });
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    await waitFor(() => expect(toast("Marked To fix")).toHaveTextContent("Summary L-1"));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("review", "L-2"));
  });

  it("a test still loading: a run marks it without a step count; its late folding is not applied", async () => {
    reviewRoutes();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    net.gate = (name, input) => (name === "tests.show" && input.id === "K-1" ? gate : undefined);
    const { rerender } = show();
    expect(await screen.findByRole("status", { name: "Loading the test" })).toBeInTheDocument();
    rerender(<ReviewScreen />, {
      lastRun: { runId: "r1", changedTests: ["K-1"], changedSteps: { "K-1": [9] }, nonce: 5 },
    });
    rerender(<ReviewScreen />, { route: { screen: "review", arg: "K-2" } });
    expect(await screen.findByRole("heading", { name: "Summary K-2" })).toBeInTheDocument();
    release();
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Summary K-2" })).toBeInTheDocument();
  });

  it("checks the tests never checked from the queue, all that need it, and the open one when it is unchecked or out of date", async () => {
    reviewRoutes({
      queue: [item("K-1", { unchecked: true }), item("K-2", { unchecked: true }), item("L-3", { stale: true })],
    });
    net.routes["check.run"] = () => ({ tests: [], totals: {}, failed: [] });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    const notice = await within(queue()).findByText("2 tests not checked yet");
    fireEvent.click(within(notice.closest("[role=status]") as HTMLElement).getByRole("button", { name: "Check" }));
    await waitFor(() => expect(named("check.run")).toHaveLength(1));
    expect(named("check.run")[0].input).toEqual({ ids: ["K-1", "K-2"] });
    fireEvent.click(within(queue()).getByRole("button", { name: "Check all" }));
    await waitFor(() => expect(named("check.run")).toHaveLength(2));
    expect(named("check.run")[1].input).toEqual({ ids: ["K-1", "K-2", "L-3"] });
    const under = screen.getByRole("region", { name: "Test under review" });
    fireEvent.click(within(under).getByRole("button", { name: "Check" }));
    await waitFor(() => expect(named("check.run")).toHaveLength(3));
    expect(named("check.run")[2].input).toEqual({ ids: ["K-1"] });
    cleanup();
    reviewRoutes({ queue: [item("K-1")], stale: true, findings: [] });
    net.routes["check.run"] = () => refused("Claude is busy");
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.queryByText(/not checked yet/)).toBeNull();
    expect(within(queue()).getByRole("button", { name: "Check all" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Could not check the test")).toBeInTheDocument();
    expect(named("check.run").at(-1)?.input).toEqual({ ids: ["K-1"] });
  });

  it("a fresh, checked test has no Check button", async () => {
    reviewRoutes({ queue: [item("K-1")], findings: [] });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.queryByRole("button", { name: /^Check( again)?$/ })).toBeNull();
  });

  it("the panes keep the widths the reviewer gave them", async () => {
    reviewRoutes();
    localStorage.removeItem("testimus.queueWidth");
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    const edge = screen.getByRole("separator", { name: "Resize the review queue" });
    fireEvent.keyDown(edge, { key: "End" });
    await waitFor(() => expect(localStorage.getItem("testimus.queueWidth")).toBe("480"));
    expect(queue()).toHaveStyle({ width: "480px" });
    fireEvent.keyDown(edge, { key: "Home" });
    await waitFor(() => expect(localStorage.getItem("testimus.queueWidth")).toBeNull());
  });
});
