// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding, Test, XrayJson } from "../../src/core/types.ts";
import type { AppState, ClaudeRun } from "../../src/ui/lib/app.ts";
import type { QueueItem } from "../../src/ui/screens/review/ReviewQueue.tsx";
import { ReviewScreen } from "../../src/ui/screens/review/ReviewScreen.tsx";
import { clearToasts, mount } from "./cov-uiscreens-helpers.tsx";
import { api, fakeFetch, named } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/tests/TestEditor.tsx", () => ({
  TestEditor: ({ testId, onOpen, onSaved }: { testId: string; onOpen: (id: string) => void; onSaved: () => void }) => (
    <div>
      <span>Editor for {testId}</span>
      <button type="button" onClick={() => onOpen("OTHER")}>
        Open other
      </button>
      <button type="button" onClick={onSaved}>
        Saved
      </button>
    </div>
  ),
}));

vi.mock("../../src/ui/screens/tests/PushDialog.tsx", () => ({
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
  fakeFetch();
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

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Expected Result"], collapsed: [], hidden: [] },
};

const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  summary: `Summary ${id}`,
  folder: "/F",
  review: "checked",
  unchecked: false,
  errors: 0,
  warnings: 0,
  infos: 0,
  stale: false,
  mtime: 1,
  ...over,
});

const testOf = (id: string, over: Partial<Test> = {}): Test =>
  ({
    key: id.startsWith("K") ? id : undefined,
    summary: `Summary ${id}`,
    folder: "/F",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "checked",
    steps: [
      { fields: { Action: "One" }, sources: [], images: [] },
      { fields: { Action: "Two" }, sources: [{ docId: "D", anchor: "§2", quote: "q2" }], images: [] },
      { fields: { Action: "Three" }, sources: [{ docId: "D", anchor: "§2", quote: "q2" }], images: [] },
    ],
    extra: {},
    ...over,
  }) as Test;

type Setup = {
  queue?: QueueItem[];
  tests?: Record<string, Partial<Test>>;
  findings?: Finding[];
  stale?: boolean;
  sync?: string;
};

function routes(s: Setup = {}) {
  let queue = s.queue ?? [item("K-1"), item("K-2"), item("L-3", { folder: "" })];
  api.routes["review.queue"] = () => ({ tests: queue, counts: { checked: 2, toFix: 1, draft: 0, unchecked: 1 } });
  api.routes["tests.show"] = (i) => ({
    id: i.id,
    test: testOf(String(i.id), s.tests?.[String(i.id)]),
    ...(s.sync ? { sync: s.sync } : {}),
  });
  api.routes["check.show"] = () => ({
    check: s.findings ? { at: "", testHash: "", findings: s.findings } : null,
    stale: !!s.stale,
  });
  api.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  api.routes["rag.passage"] = (i) => ({
    docId: "D",
    anchor: String(i.ref).split("#")[1],
    path: "",
    title: "",
    text: "texte",
    figures: [],
    doc: { code: "D", title: `Passage ${i.ref}`, version: "1", status: "validated" },
  });
  api.routes["review.evidence"] = () => ({
    testId: "K-1",
    jobId: "j",
    consulted: [],
    read: [
      { ref: "D#§2", title: "", cited: true },
      { ref: "E#§7", title: "Seven", cited: false },
    ],
    searched: [],
  });
  api.routes["review.set"] = () => ({});
  return { setQueue: (q: QueueItem[]) => (queue = q) };
}

const show = (over: Partial<AppState> = {}) =>
  mount(<ReviewScreen />, { xray, route: { screen: "review", arg: "K-1" }, ...over });

const key = (k: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(window, { key: k, ...extra });

const openFix = () =>
  waitFor(() => {
    key("f");
    expect(screen.getByRole("dialog", { name: "Mark as To fix" })).toBeInTheDocument();
  });

describe("Review screen", () => {
  it("opens the first test of the queue with no source open, and the header counts", async () => {
    routes();
    const { app: a } = show({ route: { screen: "documents" } });
    expect(await screen.findByRole("heading", { name: "Summary K-1" })).toBeInTheDocument();
    expect(screen.getByText("Generated tests")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Review/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    expect(named("rag.passage")).toHaveLength(0);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    await waitFor(() =>
      expect(a.setFocus).toHaveBeenCalledWith({ testId: "K-1", key: "K-1", summary: "Summary K-1", step: null }),
    );
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("a source link opens the panel, the same link or the X closes it, the arrows follow it only while open", async () => {
    routes();
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    key("ArrowDown");
    key("ArrowDown");
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 2" })).toHaveClass("is-active"));
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    const chip = () => within(screen.getByRole("article", { name: "Step 2" })).getByRole("button", { name: /D §2/ });
    fireEvent.click(chip());
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Passage D#§2" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 sources")).toBeInTheDocument();
    key("ArrowDown");
    expect(await screen.findByText("Source of step 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the source" }));
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    fireEvent.click(chip());
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
    fireEvent.click(chip());
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
  });

  it("a whole-test finding's source opens on click; the stale error count", async () => {
    routes({
      findings: [
        { kind: "source-missing", severity: "error", message: "whole", sources: ["W#§0", "W"] },
        { step: 2, kind: "source-missing", severity: "error", message: "s2", sources: ["D#§5"] },
      ],
      stale: true,
      sync: "local",
    });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /W §0/ })[0]);
    expect(await screen.findByText("Source of the whole-test finding")).toBeInTheDocument();
    expect(screen.getByTitle("2 errors still open · out of date")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 sources")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Step 1" })).toHaveClass("rstep-folded");
    expect(screen.getByRole("article", { name: "Step 2" })).not.toHaveClass("rstep-folded");
  });

  it("a test without sources opens no panel; a local test without sync reads as local", async () => {
    routes({
      queue: [item("L-1")],
      tests: { "L-1": { steps: [{ fields: { Action: "x" }, sources: [], images: [] }] } },
    });
    show({ route: { screen: "review", arg: "L-1" } });
    expect(await screen.findByRole("heading", { name: "Summary L-1" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    expect(screen.getByText("Local only")).toBeInTheDocument();
  });

  it("an unreadable check is treated as not checked; an unreadable test says so", async () => {
    routes();
    delete api.routes["check.show"];
    show();
    expect(await screen.findByText("Not checked yet", { selector: ".badge, span" })).toBeInTheDocument();
    cleanup();
    routes();
    delete api.routes["tests.show"];
    show();
    expect(await screen.findByText("This test could not be opened")).toBeInTheDocument();
  });

  it("an empty queue offers to generate; a failed queue is reported", async () => {
    routes({ queue: [] });
    api.routes["review.queue"] = () => null;
    const { app: a } = show({ route: { screen: "review" } });
    expect(await screen.findByRole("heading", { name: "Nothing to review" })).toBeInTheDocument();
    expect(screen.getByText("0", { selector: ".queue-strip-pos" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate tests" }));
    expect(a.navigate).toHaveBeenCalledWith("generate");
    key("j");
    key("v");
    expect(named("review.set")).toHaveLength(0);
    cleanup();
    routes();
    delete api.routes["review.queue"];
    show({ route: { screen: "review" } });
    expect(await screen.findByText("Could not read the review queue")).toBeInTheDocument();
  });

  it("sends the queue filters, folder and findings switch", async () => {
    routes();
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await waitFor(() => expect(screen.getByRole("button", { name: /All folders/ })).toBeInTheDocument());
    fireEvent.click(
      within(screen.getByRole("group", { name: "Filter by review state" })).getByRole("button", { name: /To fix/ }),
    );
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toEqual({ state: ["to-fix"], sort: "anomalies" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Filter by review state" })).getByRole("button", { name: /Validated/ }),
    );
    await waitFor(() =>
      expect(named("review.queue").at(-1)?.input).toEqual({ state: ["validated"], sort: "anomalies" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /All folders/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "/F" }));
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toMatchObject({ folder: "/F" }));
    fireEvent.click(screen.getByRole("button", { name: /Most issues first/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Only tests with findings" }));
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toMatchObject({ withFindings: true }));
    fireEvent.click(screen.getByRole("button", { name: /With findings/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Last edited first" }));
    await waitFor(() => expect(named("review.queue").at(-1)?.input).toMatchObject({ sort: "recent" }));
  });

  it("moves between tests with J/K and the strip, and between steps with the arrows", async () => {
    routes();
    const { app: a } = show({ route: { screen: "review", arg: "K-2" } });
    await screen.findByRole("heading", { name: "Summary K-2" });
    await waitFor(() => expect(screen.getByText("2/3")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 1" })).toHaveClass("is-active"));
    key("ArrowDown");
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 2" })).toHaveClass("is-active"));
    key("ArrowDown");
    key("ArrowDown");
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 3" })).toHaveClass("is-active"));
    key("ArrowUp");
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 2" })).toHaveClass("is-active"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await waitFor(() => expect(a.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ step: 2 })));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "j" });
    expect(a.navigate).toHaveBeenCalledTimes(4);
    input.remove();
  });

  it("at the end of the queue J stays; an overlay blocks the keys", async () => {
    routes({ queue: [item("K-1")] });
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await waitFor(() => expect(screen.getByText("1/1")).toBeInTheDocument());
    key("j");
    key("k");
    expect(a.navigate).not.toHaveBeenCalled();
    const veil = document.createElement("div");
    veil.className = "overlay";
    document.body.appendChild(veil);
    key("v");
    expect(named("review.set")).toHaveLength(0);
    veil.remove();
  });

  it("folds and unfolds steps, selects sources and opens documents and images", async () => {
    routes({
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
    expect(screen.getByRole("article", { name: "Step 1" })).toHaveClass("rstep-folded");
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    expect(screen.getByRole("article", { name: "Step 2" })).not.toHaveClass("rstep-folded");
    fireEvent.click(screen.getAllByRole("button", { name: /D §2/ })[0]);
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 2" })).toHaveClass("is-active"));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 2" }));
    await waitFor(() => expect(screen.getByRole("article", { name: "Step 2" })).not.toHaveClass("is-active"));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand step 1" }));
    fireEvent.click(screen.getByRole("img", { name: /a/ }).closest("button") as HTMLElement);
    expect(open).toHaveBeenCalledWith("/files/tests/K-1/a.png", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Open in document" }));
    expect(a.navigate).toHaveBeenCalledWith("documents", 'D#§2 "q2"');
  });

  it("evidence picks: a step source keeps its step, another read one is labelled", async () => {
    routes();
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    fireEvent.click(screen.getAllByRole("button", { name: /D §2/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Sources read/ }));
    fireEvent.click(await screen.findByRole("button", { name: /E#§7/ }));
    expect(await screen.findByText("Read by the generation")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 sources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^D#§2/ }));
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
  });

  it("validates with the button, opens the next test, or the empty queue after the last one", async () => {
    const r = routes();
    const { app: a } = show({ route: { screen: "review", arg: "L-3" } });
    await screen.findByRole("heading", { name: "Summary L-3" });
    await waitFor(() => expect(screen.getByText("3/3")).toBeInTheDocument());
    r.setQueue([item("K-1"), item("K-2")]);
    fireEvent.click(screen.getByRole("button", { name: /^Validate(?!d)/ }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("review", "K-2"));
    expect(await screen.findByText("Summary L-3", { selector: ".toast-detail" })).toBeInTheDocument();
    expect(a.refreshInfo).toHaveBeenCalled();
    r.setQueue([]);
    await waitFor(() => {
      key("v");
      expect(a.navigate).toHaveBeenLastCalledWith("review");
    });
  });

  it("a refused validation is reported", async () => {
    routes();
    delete api.routes["review.set"];
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await waitFor(() => {
      key("v");
      expect(screen.getByText("Could not validate the test")).toBeInTheDocument();
    });
  });

  it("marks To fix without Claude: the note is kept, the next test opens", async () => {
    routes({ tests: { "K-1": { review: "to-fix", reviewNote: "earlier note" } } });
    api.routes["claude.status"] = () => ({ installed: false, signedIn: null });
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: /To fix/, expanded: false }));
    const dlg = screen.getByRole("dialog", { name: "Mark as To fix" });
    expect(within(dlg).getByLabelText(/Note for the author/)).toHaveValue("earlier note");
    expect(within(dlg).getByRole("checkbox")).toBeDisabled();
    key("v");
    expect(named("review.set")).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: /Mark To fix/ }));
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("review", "K-2"));
    expect(named("review.set")[0].input).toEqual({ id: "K-1", decision: "to-fix", note: "earlier note" });
    expect(await screen.findByText("Marked To fix")).toBeInTheDocument();
  });

  it("the To fix note can be closed, and a refused mark is reported", async () => {
    routes();
    api.routes["claude.status"] = () => {
      throw new Error("no");
    };
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await openFix();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Mark as To fix" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /To fix/, expanded: false }));
    fireEvent.click(await screen.findByRole("button", { name: /To fix/, expanded: true }));
    expect(screen.queryByRole("dialog", { name: "Mark as To fix" })).toBeNull();
    delete api.routes["review.set"];
    await openFix();
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    expect(await screen.findByText("Could not mark the test To fix")).toBeInTheDocument();
  });

  it("edits the test and comes back; keys do not decide while editing", async () => {
    routes();
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
    fireEvent.click(screen.getByRole("button", { name: "Done editing" }));
    expect(await screen.findByRole("heading", { name: "Summary K-1" })).toBeInTheDocument();
  });

  it("a Claude run marks its steps, reverts them, handles a conflict, then a forced failure", async () => {
    routes();
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
    expect(screen.getByRole("article", { name: "Step 1" })).not.toHaveClass("rstep-folded");
    api.routes["claude.revert"] = () => {
      throw new Error("K-1 changed after the Claude run");
    };
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(await screen.findByText("Edited after the Claude run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(screen.queryByText("Edited after the Claude run")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await screen.findByText("Edited after the Claude run");
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    expect(await screen.findByText("Could not revert Claude's changes")).toBeInTheDocument();
    expect(named("claude.revert").at(-1)?.input).toEqual({ runId: "run-1", force: true });
    api.routes["claude.revert"] = () => ({ reverted: ["K-1"] });
    fireEvent.click(screen.getByRole("button", { name: "Revert anyway" }));
    expect(await screen.findByText("Claude's changes reverted")).toBeInTheDocument();
    expect(a.setLastRun).toHaveBeenCalledWith(expect.objectContaining({ runId: "" }));
    expect(a.testsChanged).toHaveBeenCalled();
    rerender(<ReviewScreen />, { lastRun: run({ changedTests: ["K-1"] }) });
    expect(await screen.findByText("Claude changed 0 steps")).toBeInTheDocument();
    rerender(<ReviewScreen />, { lastRun: run({ runId: "" }) });
    await waitFor(() => expect(screen.queryByText(/Claude changed/)).toBeNull());
  });

  it("while Claude fixes the test the decisions are off; its unfinished fix is explained", async () => {
    routes({ tests: { "K-1": { review: "to-fix" } } });
    const { rerender } = show({ claudeRunning: "K-1" });
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.getByText(/Claude is fixing this test/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Validate(?!d)/ })).toBeDisabled();
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

  it("asks Claude to fix after marking To fix, and reloads the test", async () => {
    routes();
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    await openFix();
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "Fix step 2" } });
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    await waitFor(() =>
      expect(a.runInDock).toHaveBeenCalledWith({
        name: "review.fix",
        input: { id: "K-1", note: "Fix step 2" },
        label: "Fix step 2",
        testId: "K-1",
      }),
    );
    await waitFor(() => expect(named("tests.show").filter((c) => c.input.id === "K-1").length).toBeGreaterThan(1));
    expect(a.navigate).not.toHaveBeenCalled();
  });

  it("a test changed in Jira: compare, take Jira's version (or fail), keep mine through the push", async () => {
    routes({ sync: "remote-changed" });
    api.routes["xray.pull"] = () => ({});
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(a.navigate).toHaveBeenCalledWith("tests", "K-1");
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    expect(await screen.findByText("Jira's version taken")).toBeInTheDocument();
    expect(named("xray.pull")[0].input).toEqual({ key: "K-1", overwrite: true });
    delete api.routes["xray.pull"];
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
    expect(a.testsChanged).toHaveBeenCalled();
  });

  it("a local test changed remotely cannot take Jira's version", async () => {
    routes({ queue: [item("L-1")], sync: "remote-changed" });
    show({ route: { screen: "review", arg: "L-1" } });
    await screen.findByRole("heading", { name: "Summary L-1" });
    fireEvent.click(screen.getByRole("button", { name: "Take Jira's version" }));
    await act(async () => {});
    expect(named("xray.pull")).toHaveLength(0);
  });

  it("reloads the same test when the tests change, keeping the view", async () => {
    routes();
    const { rerender } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    const before = named("tests.show").length;
    rerender(<ReviewScreen />, { testsNonce: 1 });
    await waitFor(() => expect(named("tests.show").length).toBe(before + 1));
    expect(screen.getByRole("article", { name: "Step 2" })).not.toHaveClass("rstep-folded");
    rerender(<ReviewScreen />, { route: { screen: "review", arg: "K-2" } });
    expect(await screen.findByRole("heading", { name: "Summary K-2" })).toBeInTheDocument();
  });

  it("a local test with no note marked To fix; counts with nothing unchecked; a whole-test source", async () => {
    routes({
      queue: [item("L-1"), item("L-2")],
      tests: { "L-1": { review: "to-fix" } },
      findings: [{ kind: "source-missing", severity: "warning", message: "w", sources: ["W#§0"] }],
    });
    api.routes["review.queue"] = () => ({
      tests: [item("L-1"), item("L-2")],
      counts: { checked: 1, toFix: 1, draft: 0, unchecked: 0 },
    });
    api.routes["claude.status"] = () => ({ installed: false, signedIn: null });
    const { app: a } = show({ route: { screen: "review", arg: "L-1" } });
    await screen.findByRole("heading", { name: "Summary L-1" });
    const chip = screen.getAllByRole("button", { name: /W §0/ })[0];
    fireEvent.click(chip);
    expect(await screen.findByText("Source of the whole-test finding")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Step 1" })).toHaveClass("rstep-folded");
    await openFix();
    const note = screen.getByLabelText(/Note for the author/);
    expect(note).toHaveValue("");
    fireEvent.change(note, { target: { value: "fix" } });
    fireEvent.click(screen.getByRole("button", { name: /Mark To fix/ }));
    expect(await screen.findByText("Summary L-1", { selector: ".toast-detail" })).toBeInTheDocument();
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("review", "L-2"));
  });

  it("a test still loading: a run marks it without a step count; its late folding is not applied", async () => {
    routes();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const f = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("tests/show") && String(init?.body).includes("K-1")) await gate;
        return f(url, init);
      }),
    );
    const { rerender } = show();
    expect(await screen.findByRole("status", { name: "Loading the test" })).toBeInTheDocument();
    rerender(<ReviewScreen />, {
      lastRun: { runId: "r1", changedTests: ["K-1"], changedSteps: { "K-1": [9] }, nonce: 5 },
    });
    rerender(<ReviewScreen />, { route: { screen: "review", arg: "K-2" } });
    expect(await screen.findByRole("heading", { name: "Summary K-2" })).toBeInTheDocument();
    release();
    await act(async () => {});
  });

  it("checks the tests never checked from the queue, and the open one when it is unchecked or out of date", async () => {
    routes({ queue: [item("K-1", { unchecked: true }), item("K-2", { unchecked: true }), item("L-3")] });
    api.routes["check.run"] = () => ({ tests: [], totals: {}, failed: [] });
    const { app: a } = show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(await screen.findByText("2 tests not checked yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check the 2 tests not checked yet" }));
    await waitFor(() => expect(a.testsChanged).toHaveBeenCalled());
    expect(named("check.run")[0].input).toEqual({ ids: ["K-1", "K-2"], semantic: true });
    expect(a.refreshInfo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(named("check.run")).toHaveLength(2));
    expect(named("check.run")[1].input).toEqual({ ids: ["K-1"], semantic: true });
    cleanup();
    routes({ queue: [item("K-1")], stale: true });
    delete api.routes["check.run"];
    api.routes["claude.status"] = () => ({ installed: false });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.queryByText(/not checked yet/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Could not check the test")).toBeInTheDocument();
    expect(named("check.run").at(-1)?.input).toEqual({ ids: ["K-1"], semantic: false });
  });

  it("a fresh, checked test has no Check button", async () => {
    routes({ queue: [item("K-1")] });
    show();
    await screen.findByRole("heading", { name: "Summary K-1" });
    expect(screen.queryByRole("button", { name: /^Check( again)?$/ })).toBeNull();
  });
});
