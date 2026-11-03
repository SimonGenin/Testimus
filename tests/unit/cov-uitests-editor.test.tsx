// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step, Test } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { ClaudeDock } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { AppContext, type AppState, type ClaudeRun } from "../../src/ui/lib/app.ts";
import { discardEditor, flushEditor } from "../../src/ui/lib/editorBus.ts";
import { recentIds } from "../../src/ui/lib/recent.ts";
import { TestEditor } from "../../src/ui/screens/tests/TestEditor.tsx";
import { FakeES } from "./cov-uishell-helpers.tsx";
import { callsTo, deferred, Fail, server, stubServer } from "./cov-uitests-helpers.ts";
import { app } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/components/claude/ContextsDialog.tsx", () => ({
  CONTEXTS_EVENT: "testimus:contexts",
  ContextsDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Contexts">
      <button type="button" onClick={onClose}>
        close contexts
      </button>
    </div>
  ),
}));

type T = { kind: string; title: string; detail?: string; onExpire?: () => void; action?: { run: () => void } };
const toasts: T[] = [];
const errors: { e: unknown; title?: string }[] = [];
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return {
    ...real,
    toast: vi.fn((t: T) => toasts.push(t)),
    errorToast: vi.fn((e: unknown, title?: string) => errors.push({ e, title })),
  };
});

const step = (action: string, extra: Partial<Step> = {}): Step => ({
  fields: { Action: action, "Expected Result": `${action} done` },
  sources: [],
  images: [],
  ...extra,
});

const makeTest = (o: Partial<Test> = {}): Test => ({
  key: "LFRPS12-7",
  project: "LFRPS12",
  summary: "Sectionneur",
  folder: "/",
  labels: [],
  description: "Checks the switch",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [step("One"), step("Two"), step("Three")],
  extra: {},
  ...o,
});

const fullXray = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "data", name: "Data", type: "text", builtin: true },
    { id: "result", name: "Expected Result", type: "text", builtin: true },
  ],
  prefs: { order: ["Action", "Data", "Expected Result"], collapsed: [], hidden: [] },
} as AppState["xray"];

let shown: Test;
let show: Record<string, unknown>;
let seq = 0;

beforeEach(() => {
  stubServer();
  setProject(`C:\\p${++seq}`);
  toasts.length = 0;
  errors.length = 0;
  localStorage.clear();
  shown = makeTest();
  show = {};
  server.routes["tests.show"] = (input) => ({ id: input.id, test: shown, ...show });
  server.routes["tests.save"] = (input) => ({ id: input.id, summary: "saved", sync: "modified" });
  server.routes["contexts.ofTest"] = () => ({ effective: [], own: null });
  server.routes["contexts.list"] = () => [{ id: "c1", name: "Glossary" }];
  server.routes["tests.columns"] = () => ({ own: null });
  server.routes["xray.preconditions"] = () => [
    { key: "LFRPS12-50", issueId: "1", summary: "Powered", definition: "Power is on" },
  ];
  server.routes["xray.folders"] = () => ({
    name: "/",
    path: "/",
    testsCount: 0,
    totalCount: 0,
    folders: [{ name: "Lot", path: "/Lot", testsCount: 0, totalCount: 0, folders: [] }],
  });
  server.routes["xray.status"] = (input) => ({ tests: [{ id: input.id, sync: "synced", remote: "unchanged" }] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  delete window.testimusDesktop;
});

const editor = (over: Partial<AppState> = {}, id = "t1") => {
  const state = app({ route: { screen: "tests", arg: id }, ...over });
  const onSaved = vi.fn();
  const onOpen = vi.fn();
  const tree = (s: AppState, testId: string) => (
    <AppContext.Provider value={s}>
      <TestEditor testId={testId} onSaved={onSaved} onOpen={onOpen} />
    </AppContext.Provider>
  );
  const r = render(tree(state, id));
  return {
    ...r,
    state,
    onSaved,
    onOpen,
    again: (s: Partial<AppState>, testId = id) => r.rerender(tree({ ...state, ...s }, testId)),
  };
};

const ready = () => screen.findByLabelText("Action of step 1");
const actions = () => (screen.getAllByLabelText(/^Action of step \d+$/) as HTMLTextAreaElement[]).map((t) => t.value);
const savedTest = () => callsTo("tests.save").at(-1)?.input.test as Test;
const blurWindow = () => act(() => void window.dispatchEvent(new Event("blur")));
const focusWindow = () => act(() => void window.dispatchEvent(new Event("focus")));
const menuItem = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: "More actions for this test" }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
};

describe("TestEditor › loading", () => {
  it("shows a skeleton, then the test with its preconditions, and checks it against Jira", async () => {
    shown = makeTest({ preconditions: ["LFRPS12-50", "LFRPS12-60"] });
    show = { remote: makeTest(), mtime: 5 };
    const gate = deferred<unknown>();
    server.routes["tests.show"] = async (input) => {
      await gate.promise;
      return { id: input.id, test: shown, ...show };
    };
    const { state, onSaved } = editor();
    expect(screen.getByRole("status", { name: "Loading the test" })).toBeInTheDocument();
    gate.resolve(null);
    await ready();
    expect(screen.getByText("Powered")).toBeInTheDocument();
    expect(screen.getByText("Power is on")).toBeInTheDocument();
    expect(screen.getByText("not loaded")).toBeInTheDocument();
    await waitFor(() =>
      expect(state.setFocus).toHaveBeenLastCalledWith({
        testId: "t1",
        key: "LFRPS12-7",
        summary: "Sectionneur",
        step: null,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "t1", sync: "synced" }));
    expect(callsTo("xray.status")[0].input).toEqual({ id: "t1" });
    expect(recentIds()).toEqual(["t1"]);
  });

  it("opens a precondition in Jira, through the desktop or a new tab, and reports a failure", async () => {
    shown = makeTest({ preconditions: ["LFRPS12-50"] });
    server.routes["xray.browse"] = (input) => ({ url: `https://jira/${input.key}` });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    editor();
    fireEvent.click(await screen.findByTitle("Open LFRPS12-50 in the browser"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://jira/LFRPS12-50", "_blank", "noopener"));
    const openExternal = vi.fn(async () => true);
    window.testimusDesktop = { openExternal } as never;
    fireEvent.click(screen.getByTitle("Open LFRPS12-50 in the browser"));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://jira/LFRPS12-50"));
    server.routes["xray.browse"] = () => {
      throw new Fail("no");
    };
    fireEvent.click(screen.getByTitle("Open LFRPS12-50 in the browser"));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not open LFRPS12-50"));
  });

  it("shows preconditions loading, and copes when the project lists none", async () => {
    shown = makeTest({ preconditions: ["LFRPS12-50"] });
    server.routes["xray.preconditions"] = () => new Promise(() => {});
    editor();
    expect(await screen.findByText("loading…", { selector: ".precond-summary" })).toBeInTheDocument();
    cleanup();
    setProject("C:\\other-a");
    server.routes["xray.preconditions"] = () => {
      throw new Fail("no");
    };
    server.routes["xray.folders"] = () => {
      throw new Fail("no");
    };
    editor();
    expect(await screen.findByText("not loaded")).toBeInTheDocument();
    await waitFor(() => expect(errors.map((x) => x.title)).toContain("Could not load the preconditions from Jira"));
    expect(callsTo("xray.folders")).toHaveLength(0);
    fireEvent.click(screen.getByTitle(/Change the folder/));
    await waitFor(() => expect(errors.map((x) => x.title)).toContain("Could not load the Xray folders"));
    cleanup();
    setProject("C:\\other-b");
    server.routes["xray.preconditions"] = () => null;
    editor();
    expect(await screen.findByText("not loaded")).toBeInTheDocument();
  });

  it("asks the Xray folders again at the next opening of the picker after a failed load", async () => {
    setProject("C:/folders-retry");
    let n = 0;
    server.routes["xray.folders"] = () => {
      n++;
      if (n === 1) throw new Fail("offline");
      return {
        name: "",
        path: "/",
        testsCount: 0,
        totalCount: 0,
        folders: [{ name: "Traction", path: "/Traction", testsCount: 1, totalCount: 1, folders: [] }],
      };
    };
    editor();
    await ready();
    fireEvent.click(screen.getByTitle(/Change the folder/));
    await waitFor(() => expect(errors.map((x) => x.title)).toContain("Could not load the Xray folders"));
    fireEvent.keyDown(screen.getByLabelText("Folder"), { key: "Escape" });
    fireEvent.click(await screen.findByTitle(/Change the folder/));
    await waitFor(() => expect(callsTo("xray.folders")).toHaveLength(2));
    await waitFor(() => expect(document.querySelector('#testimus-folders option[value="/Traction"]')).not.toBeNull());
  });

  it("asks Jira nothing for a project without a Jira key, and says each failed load, as Xray Editor does", async () => {
    const base = app().info as NonNullable<AppState["info"]>;
    setProject("C:/no-jira");
    editor({ info: { ...base, project: { ...base.project, jiraProject: "" } } });
    await ready();
    expect(callsTo("xray.preconditions")).toHaveLength(0);
    expect(callsTo("xray.folders")).toHaveLength(0);
    cleanup();
    setProject("C:/offline");
    server.routes["xray.preconditions"] = () => {
      throw new Fail("offline");
    };
    editor();
    await ready();
    cleanup();
    editor();
    await ready();
    await waitFor(() => expect(callsTo("xray.preconditions")).toHaveLength(2));
    await waitFor(() =>
      expect(errors.filter((x) => x.title === "Could not load the preconditions from Jira")).toHaveLength(2),
    );
  });

  it("says when the Jira check failed or found nothing, and ignores a check for another test", async () => {
    show = { remote: makeTest() };
    server.routes["xray.status"] = () => {
      throw new Fail("offline");
    };
    editor();
    expect(await screen.findByTitle("Not verified against Jira")).toBeInTheDocument();
    cleanup();
    server.routes["xray.status"] = () => ({ tests: [] });
    editor();
    expect(await screen.findByTitle("Not verified against Jira")).toBeInTheDocument();
    cleanup();
    const late = deferred<unknown>();
    server.routes["xray.status"] = () => late.promise;
    const { again } = editor();
    await ready();
    shown = makeTest({ steps: [step("Other")], key: undefined });
    again({}, "t2");
    await waitFor(() => expect(actions()).toEqual(["Other"]));
    late.resolve({ tests: [{ id: "t1", sync: "remote-changed", remote: "remote-changed" }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "changed in Jira" })).toBeNull();
    cleanup();
    shown = makeTest();
    const lateFail = deferred<unknown>();
    server.routes["xray.status"] = () => lateFail.promise;
    const second = editor();
    await ready();
    await waitFor(() => expect(callsTo("xray.status")).toHaveLength(4));
    shown = makeTest({ steps: [step("Other")], key: undefined });
    second.again({}, "t2");
    await waitFor(() => expect(actions()).toEqual(["Other"]));
    lateFail.reject(new Fail("x"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTitle("Not verified against Jira")).toBeNull();
  });

  it("uses the sync state the core gives, or local for a test without key", async () => {
    shown = makeTest({ key: undefined });
    editor();
    expect(await screen.findByText("Local only")).toBeInTheDocument();
    cleanup();
    shown = makeTest();
    show = { sync: "modified" };
    editor();
    expect(await screen.findByText("Modified")).toBeInTheDocument();
  });

  it("says when the test cannot be opened and tries again", async () => {
    server.routes["tests.show"] = () => {
      throw new Fail("No test t1");
    };
    editor();
    expect(await screen.findByText("This test could not be opened")).toBeInTheDocument();
    expect(screen.getByText("No test t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Error: No test t1")).toBeInTheDocument());
    server.routes["tests.show"] = (input) => ({ id: input.id, test: shown });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
  });

  it("shows a non-Error load failure as text, and ignores one that lands after closing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("offline")),
    );
    editor();
    expect(await screen.findByText("offline")).toBeInTheDocument();
    cleanup();
    stubServer();
    const gate = deferred<unknown>();
    server.routes["tests.show"] = async () => {
      await gate.promise;
      throw new Fail("late");
    };
    const { unmount } = editor();
    unmount();
    gate.resolve(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("late")).toBeNull();
  });
});

describe("TestEditor › saving", () => {
  it("saves a description edit after a pause and reports the ref", async () => {
    server.routes["tests.save"] = (input) => ({ id: input.id, summary: "saved", sync: "modified", mtime: 9 });
    const { onSaved } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "New description" } });
    expect(callsTo("tests.save")).toHaveLength(0);
    await waitFor(() => expect(callsTo("tests.save")).toHaveLength(1));
    expect(savedTest().description).toBe("New description");
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({ id: "t1", summary: "saved", sync: "modified", mtime: 9 }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
  });

  it("saves at once when the window or the editor loses focus, or the bus asks", async () => {
    const { container } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "Blurred" } });
    blurWindow();
    await waitFor(() => expect(callsTo("tests.save")).toHaveLength(1));
    await act(() => flushEditor());
    expect(callsTo("tests.save")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Left" } });
    const ed = container.querySelector(".editor") as HTMLElement;
    fireEvent.blur(screen.getByLabelText("Description"), { relatedTarget: screen.getByLabelText("Summary") });
    expect(callsTo("tests.save")).toHaveLength(1);
    fireEvent.blur(ed, { relatedTarget: null });
    await waitFor(() => expect(callsTo("tests.save")).toHaveLength(2));
  });

  it("keeps the sync state when the save answer has none, and survives an empty answer", async () => {
    server.routes["tests.save"] = () => undefined;
    const { onSaved } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "x" } });
    blurWindow();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    cleanup();
    server.routes["tests.save"] = (input) => ({ id: input.id });
    editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "x" } });
    blurWindow();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Up to date")).toBeInTheDocument();
  });

  it("reports a failed save", async () => {
    server.routes["tests.save"] = () => {
      throw new Fail("read-only folder");
    };
    editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "x" } });
    blurWindow();
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not save the test"));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("saves pending edits when it closes and clears the focus", async () => {
    const { unmount, state } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "on close" } });
    unmount();
    await waitFor(() => expect(callsTo("tests.save")).toHaveLength(1));
    expect(state.setFocus).toHaveBeenLastCalledWith(null);
  });

  it("drops a pending edit of a test about to be deleted", async () => {
    const { unmount } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "doomed" } });
    discardEditor("other");
    discardEditor("t1");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "ignored" } });
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("tests.save")).toHaveLength(0);
  });

  it("reloads a test.md changed outside the app when the window gets focus", async () => {
    show = { mtime: 1 };
    const { state } = editor();
    await ready();
    focusWindow();
    await waitFor(() => expect(callsTo("tests.show")).toHaveLength(2));
    expect(toasts).toEqual([]);
    show = { mtime: 2 };
    shown = makeTest({ steps: [step("Edited")] });
    focusWindow();
    await waitFor(() => expect(actions()).toEqual(["Edited"]));
    expect(toasts.at(-1)?.title).toBe("Reloaded from disk");
    expect(state.testsChanged).toHaveBeenCalled();
    server.routes["tests.show"] = () => {
      throw new Fail("gone");
    };
    focusWindow();
    await waitFor(() => expect(callsTo("tests.show")).toHaveLength(5));
  });

  it("reloads its test.md when a job ends having changed it, and only that file", async () => {
    vi.stubGlobal("EventSource", FakeES);
    show = { mtime: 1 };
    editor();
    await ready();
    const changed = (paths: string[]) => act(() => FakeES.emit({ jobId: "j", at: "", type: "changed", paths }));
    changed(["tests/t2/test.md", "tests/t1/check.json"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("tests.show")).toHaveLength(1);
    show = { mtime: 2 };
    shown = makeTest({ steps: [step("By the job")] });
    changed(["tests/t1/test.md"]);
    await waitFor(() => expect(actions()).toEqual(["By the job"]));
    expect(toasts.at(-1)).toMatchObject({ title: "Reloaded from disk", detail: "A job changed test.md." });
  });

  it("does not reload on focus while Claude works", async () => {
    show = { mtime: 1 };
    editor({ claudeRunning: "t1" });
    await ready();
    focusWindow();
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("tests.show")).toHaveLength(1);
  });

  it("switches layout and details, remembering both", async () => {
    editor();
    fireEvent.click(await screen.findByRole("button", { name: "Action | Expected" }));
    expect(localStorage.getItem("testimus.stepLayout")).toBe("split");
    expect(document.querySelector(".step-body.is-split")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(localStorage.getItem("testimus.showDetails")).toBe("0");
    expect(screen.queryByLabelText("Description")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(localStorage.getItem("testimus.showDetails")).toBe("1");
  });

  it("offers the Jira folders and the project's in the folder picker", async () => {
    editor();
    await ready();
    fireEvent.click(screen.getByTitle(/Change the folder/));
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll("#testimus-folders option")).map((o) => o.getAttribute("value")),
      ).toEqual(["/", "/Lot"]),
    );
  });

  it("uploads a screenshot into the step, and deletes a dropped one once its undo expires", async () => {
    server.routes["tests.addImage"] = () => ({ file: "images/s.png" });
    server.routes["tests.removeImage"] = () => ({});
    editor();
    await screen.findByLabelText("Expected Result of step 1");
    fireEvent.paste(document.querySelector('[data-field="Expected Result"]') as HTMLElement, {
      clipboardData: { files: [new File(["x"], "s.png", { type: "image/png" })] },
    });
    const img = await screen.findByRole("img", { name: "s.png" });
    expect(img.getAttribute("src")).toContain("/files/tests/t1/images/s.png");
    fireEvent.click(screen.getByRole("button", { name: "Remove s.png from Expected Result of step 1" }));
    act(() => toasts.at(-1)?.onExpire?.());
    await waitFor(() => expect(callsTo("tests.removeImage")[0]?.input).toEqual({ id: "t1", file: "images/s.png" }));
  });

  it("swallows a failed image removal", async () => {
    server.routes["tests.removeImage"] = () => {
      throw new Fail("x");
    };
    shown = makeTest({ steps: [step("![](images/a.png)", { images: [{ file: "images/a.png" }] })] });
    editor();
    await screen.findAllByRole("img", { name: "a.png" });
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png from Action of step 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png from Expected Result of step 1" }));
    act(() => toasts.at(-1)?.onExpire?.());
    await waitFor(() => expect(callsTo("tests.removeImage")).toHaveLength(1));
    expect(errors).toEqual([]);
  });
});

describe("TestEditor › steps", () => {
  it("moves, inserts, adds and deletes steps, tracking the focused step", async () => {
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    const { state } = editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Move step 1 down (Alt+↓)" }));
    expect(actions()).toEqual(["Two", "One", "Three"]);
    expect(raf).toHaveBeenCalled();
    await waitFor(() => expect(state.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ step: 2 })));
    fireEvent.keyDown(screen.getByRole("article", { name: "Step 1" }), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(screen.getByRole("article", { name: "Step 3" }), { key: "ArrowDown", altKey: true });
    expect(actions()).toEqual(["Two", "One", "Three"]);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up (Alt+↑)" }));
    expect(actions()).toEqual(["One", "Two", "Three"]);
    fireEvent.click(screen.getByRole("button", { name: "Insert a step below step 1" }));
    expect(screen.getAllByRole("article")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(screen.getAllByRole("article")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Delete step 3" }));
    expect(actions()).toEqual(["One", "Three"]);
    expect(toasts.at(-1)?.title).toBe("Step 3 deleted");
    act(() => toasts.at(-1)?.action?.run());
    expect(actions()).toEqual(["One", "Two", "Three"]);
    blurWindow();
    await waitFor(() => expect(callsTo("tests.save")).toHaveLength(1));
    expect(savedTest().steps).toHaveLength(5);
  });

  it("refuses an undo after the test was reloaded", async () => {
    const { again } = editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Delete step 1" }));
    const undo = toasts.at(-1)?.action?.run;
    shown = makeTest({ steps: [step("Other")] });
    again({}, "t2");
    await waitFor(() => expect(actions()).toEqual(["Other"]));
    act(() => undo?.());
    expect(actions()).toEqual(["Other"]);
    expect(toasts.at(-1)?.title).toBe("Too late to undo");
  });

  it("offers a first step on an empty test", async () => {
    shown = makeTest({ steps: [] });
    editor();
    fireEvent.click(await screen.findByRole("button", { name: "Add first step" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("folds and unfolds a step, and asks Claude about one step", async () => {
    const { state } = editor();
    await ready();
    fireEvent.focus(screen.getByLabelText("Action of step 3"));
    await waitFor(() => expect(state.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ step: 3 })));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 2" }));
    expect(screen.getByRole("article", { name: "Step 2" })).toHaveClass("step-folded");
    fireEvent.click(screen.getByRole("button", { name: "Expand step 2" }));
    expect(screen.getByRole("article", { name: "Step 2" })).not.toHaveClass("step-folded");
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude about step 2" }));
    expect(state.askClaude).toHaveBeenCalledWith("step");
    expect(state.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ step: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    expect(state.askClaude).toHaveBeenCalledWith("test");
  });

  const dragTo = (el: HTMLElement, type: "dragOver" | "drop", clientY: number) => {
    const ev = createEvent[type](el, { dataTransfer: { types: ["text/plain"], getData: () => "", files: [] } });
    Object.defineProperty(ev, "clientY", { value: clientY });
    fireEvent(el, ev);
  };

  it("reorders steps by dragging the grip, showing where they land", async () => {
    editor();
    await ready();
    const cards = () => screen.getAllByRole("article");
    const box = () => {
      for (const c of cards())
        vi.spyOn(c, "getBoundingClientRect").mockReturnValue({ top: 100, height: 100 } as DOMRect);
    };
    box();
    dragTo(cards()[1], "dragOver", 120);
    fireEvent.drop(cards()[1], { dataTransfer: { types: [], getData: () => "", files: [] } });
    expect(document.querySelector(".dropline")).toBeNull();
    fireEvent.mouseDown(cards()[0].querySelector(".grip") as HTMLElement);
    fireEvent.dragStart(cards()[0], { dataTransfer: { setData: vi.fn(), types: [] } });
    dragTo(cards()[2], "dragOver", 180);
    dragTo(cards()[2], "dragOver", 190);
    expect(document.querySelector(".editor-col > .dropline")).not.toBeNull();
    dragTo(cards()[1], "dragOver", 120);
    expect(cards()[1].parentElement?.querySelector(".dropline")).not.toBeNull();
    dragTo(cards()[2], "dragOver", 180);
    dragTo(cards()[2], "drop", 180);
    expect(actions()).toEqual(["Two", "Three", "One"]);
    expect(document.querySelector(".dropline")).toBeNull();
    fireEvent.mouseDown(cards()[2].querySelector(".grip") as HTMLElement);
    fireEvent.dragStart(cards()[2], { dataTransfer: { setData: vi.fn(), types: [] } });
    box();
    dragTo(cards()[0], "dragOver", 110);
    dragTo(cards()[0], "drop", 110);
    expect(actions()).toEqual(["One", "Two", "Three"]);
    fireEvent.mouseDown(cards()[0].querySelector(".grip") as HTMLElement);
    fireEvent.dragStart(cards()[0], { dataTransfer: { setData: vi.fn(), types: [] } });
    fireEvent.dragEnd(cards()[0]);
    dragTo(cards()[1], "dragOver", 120);
    expect(document.querySelector(".dropline")).toBeNull();
  });

  it("opens a step's screenshots in the lightbox and moves through them", async () => {
    shown = makeTest({
      steps: [
        step("", {
          fields: { Action: "![](images/a.png)\n\n![](images/b.png)" },
          images: [{ file: "images/a.png" }, { file: "images/b.png" }, { file: "images/c.png" }],
        }),
      ],
    });
    editor();
    fireEvent.click(await screen.findByRole("img", { name: "b.png" }));
    const box = screen.getByRole("dialog", { name: "Screenshot b.png" });
    expect(within(box).getByText("2 of 3")).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("dialog", { name: "Screenshot c.png" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resizes the editor column from either edge and resets it", async () => {
    const { container } = editor();
    await ready();
    const [left, right] = screen.getAllByRole("separator", { name: "Resize the editor column" });
    const col = container.querySelector(".editor-col") as HTMLElement;
    vi.spyOn(col, "getBoundingClientRect").mockReturnValue({ width: 700 } as DOMRect);
    Object.defineProperty(col.parentElement as HTMLElement, "clientWidth", { value: 1000, configurable: true });
    fireEvent.pointerDown(right, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(right, { clientX: 50 });
    expect(col.style.maxWidth).toBe("800px");
    fireEvent.pointerUp(right);
    expect(localStorage.getItem("testimus.editorWidth")).toBe("800");
    fireEvent.pointerDown(left, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(left, { clientX: 500 });
    expect(col.style.maxWidth).toBe("560px");
    fireEvent.pointerUp(left);
    fireEvent.doubleClick(left);
    expect(col.style.maxWidth).toBe("");
    expect(localStorage.getItem("testimus.editorWidth")).toBe("");
    fireEvent.pointerDown(right, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(right);
    fireEvent.doubleClick(right);
  });

  it("starts at a remembered column width", async () => {
    localStorage.setItem("testimus.editorWidth", "900");
    const { container } = editor();
    await ready();
    expect((container.querySelector(".editor-col") as HTMLElement).style.maxWidth).toBe("900px");
  });
});

const run = (o: Partial<ClaudeRun> = {}): ClaudeRun => ({
  runId: "run-1",
  changedTests: ["t1"],
  changedSteps: { t1: [1, 4] },
  nonce: 1,
  ...o,
});

describe("TestEditor › Claude", () => {
  it("the step last worked on keeps its ring: moved to the next one after a delete, hidden while dragging", async () => {
    editor();
    await ready();
    const cards = () => screen.getAllByRole("article");
    fireEvent.focus(screen.getByLabelText("Action of step 2"));
    expect(cards()[1]).toHaveClass("is-focused");
    fireEvent.focus(screen.getByRole("textbox", { name: "Summary" }));
    expect(cards()[1]).toHaveClass("is-focused");
    fireEvent.mouseDown(cards()[0].querySelector(".grip") as HTMLElement);
    fireEvent.dragStart(cards()[0], { dataTransfer: { setData: vi.fn(), types: [] } });
    expect(document.querySelector(".is-focused")).toBeNull();
    fireEvent.dragEnd(cards()[0]);
    expect(cards()[1]).toHaveClass("is-focused");
    const n = cards().length;
    fireEvent.click(screen.getByRole("button", { name: "Delete step 2" }));
    expect(cards()).toHaveLength(n - 1);
    expect(cards()[1]).toHaveClass("is-focused");
  });

  it("any Claude run locks the editor, also one on another test or on the whole project", async () => {
    for (const running of ["t2", "*project*"]) {
      editor({ claudeRunning: running });
      expect(await screen.findByText(/^Claude is working\./)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Push to Jira" })).toBeDisabled();
      cleanup();
    }
  });

  it("pauses editing while Claude works and refuses download and delete", async () => {
    editor({ claudeRunning: "t1" });
    expect(await screen.findByText(/Claude is working on this test/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push to Jira" })).toBeDisabled();
    await menuItem("Download from Jira");
    expect(toasts.at(-1)?.title).toBe("Wait for Claude to finish");
    await menuItem("Delete local copy");
    expect(toasts.filter((t) => t.title === "Wait for Claude to finish")).toHaveLength(2);
  });

  it("marks Delete local copy as dangerous, behind its own separator", async () => {
    editor();
    fireEvent.click(await screen.findByRole("button", { name: "More actions for this test" }));
    const del = await screen.findByRole("menuitem", { name: "Delete local copy" });
    expect(del).toHaveClass("is-danger");
    expect(del.previousElementSibling?.tagName).toBe("HR");
  });

  it("reloads after a run on this test even when the run reports no change", async () => {
    const { again } = editor();
    await ready();
    const shows = callsTo("tests.show").length;
    shown = makeTest({ summary: "Renamed by Claude" });
    again({ lastRun: run({ changedTests: [], changedSteps: {}, testId: "t1", nonce: 7 }) });
    await waitFor(() => expect(callsTo("tests.show").length).toBeGreaterThan(shows));
    expect(await screen.findByDisplayValue("Renamed by Claude")).toBeInTheDocument();
    again({ lastRun: run({ changedTests: [], changedSteps: {}, testId: "other", nonce: 8 }) });
    expect(callsTo("tests.show").length).toBe(shows + 1);
  });

  it("reloads after a run and marks the changed and added steps, then shows and reverts them", async () => {
    const { again, state } = editor();
    await ready();
    shown = makeTest({ steps: [step("Un"), step("Two"), step("Three"), step("Quatre")] });
    const scroll = vi.fn();
    again({ lastRun: run() });
    expect(await screen.findByText("Claude changed 2 steps")).toBeInTheDocument();
    expect(screen.getByText(/step 1, step 4 \(new\)/)).toBeInTheDocument();
    expect(screen.getByText("Added by Claude")).toBeInTheDocument();
    expect(screen.getByText("Changed by Claude")).toBeInTheDocument();
    (document.querySelector('[data-step="0"]') as HTMLElement).scrollIntoView = scroll;
    fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    fireEvent.change(screen.getByLabelText("Action of step 1"), { target: { value: "Un bis" } });
    expect(await screen.findByText("Claude changed 1 step")).toBeInTheDocument();
    server.routes["claude.revert"] = () => ({ reverted: ["t1", "t2"] });
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    await waitFor(() => expect(state.setLastRun).toHaveBeenCalled());
    expect(callsTo("claude.revert")[0].input).toEqual({ runId: "run-1" });
    expect(vi.mocked(state.setLastRun).mock.lastCall?.[0]).toMatchObject({ runId: "", changedTests: ["t1", "t2"] });
    expect(state.testsChanged).toHaveBeenCalled();
    expect(toasts.at(-1)?.title).toBe("Claude's changes reverted");
  });

  it("asks before reverting over later edits, and can keep or force", async () => {
    const { state } = editor({ lastRun: run({ changedSteps: { t1: [2] } }) });
    expect(await screen.findByText("Claude changed 1 step")).toBeInTheDocument();
    expect(screen.queryByText(/\(new\)/)).toBeNull();
    server.routes["claude.revert"] = (input) => {
      if (!input.force) throw new Fail("t1 changed after the Claude run");
      return {};
    };
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    expect(await screen.findByText("Edited after the Claude run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep the test as it is" }));
    expect(screen.queryByText("Edited after the Claude run")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revert anyway" }));
    await waitFor(() => expect(state.setLastRun).toHaveBeenCalled());
    expect(callsTo("claude.revert").at(-1)?.input).toEqual({ runId: "run-1", force: true });
    expect(vi.mocked(state.setLastRun).mock.lastCall?.[0]).toMatchObject({ changedTests: ["t1"] });
  });

  it("reports a revert that fails for another reason, or fails even when forced", async () => {
    editor({ lastRun: run({ changedSteps: { t1: [2] } }) });
    await screen.findByText("Claude changed 1 step");
    server.routes["claude.revert"] = () => {
      throw new Fail("no snapshot");
    };
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not revert Claude's changes"));
    server.routes["claude.revert"] = () => {
      throw new Fail("t1 changed after the Claude run");
    };
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revert anyway" }));
    await waitFor(() => expect(errors).toHaveLength(2));
  });

  it("says Claude changed the test when no changed step is left, and drops marks for a run without id or steps", async () => {
    const { again } = editor({ lastRun: run({ changedSteps: { t1: [9] } }) });
    expect(await screen.findByText("Claude changed this test.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show changes" })).toBeNull();
    again({ lastRun: run({ runId: "", nonce: 2 }) });
    await waitFor(() => expect(screen.queryByText(/Claude changed/)).toBeNull());
    again({ lastRun: run({ changedSteps: {}, nonce: 3 }) });
    await waitFor(() => expect(callsTo("tests.show")).toHaveLength(4));
    again({ lastRun: run({ changedTests: ["t9"], nonce: 4 }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("tests.show")).toHaveLength(4);
  });

  it("reports a failed reload after a run", async () => {
    const { again } = editor();
    await ready();
    server.routes["tests.show"] = () => {
      throw new Fail("gone");
    };
    again({ lastRun: run() });
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not reload the test after Claude"));
  });
});

describe("TestEditor › Jira", () => {
  const synced = () => {
    shown = makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] }) };
  };

  it("is in sync: nothing to push, no undo", async () => {
    synced();
    editor();
    await ready();
    await waitFor(() => expect(screen.getByRole("button", { name: "Push to Jira" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "More actions for this test" }));
    expect(screen.queryByRole("menuitem", { name: "Undo local changes" })).toBeNull();
  });

  it("changed in Jira but not here: nothing local to push, as in Xray Editor", async () => {
    synced();
    server.routes["xray.status"] = (input) => ({
      tests: [{ id: input.id, sync: "remote-changed", remote: "remote-changed" }],
    });
    editor();
    await ready();
    expect(await screen.findByRole("button", { name: /changed in Jira/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push to Jira" })).toBeDisabled();
  });

  it("downloads at once when nothing local would be lost, and reports a failed pull", async () => {
    synced();
    server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-7"], failed: [] });
    const { state } = editor();
    await ready();
    await menuItem("Download from Jira");
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("LFRPS12-7 refreshed from Jira"));
    expect(callsTo("xray.pull")[0].input).toEqual({ key: "LFRPS12-7", overwrite: true });
    expect(state.testsChanged).toHaveBeenCalled();
    server.routes["xray.pull"] = () => ({ pulled: [], failed: [{ key: "LFRPS12-7", error: "403" }] });
    await menuItem("Download from Jira");
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not download LFRPS12-7"));
    server.routes["tests.show"] = () => {
      throw new Fail("x");
    };
    await menuItem("Download from Jira");
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not read the test"));
  });

  it("asks before a download overwrites local changes, from the menu or the changed badge", async () => {
    synced();
    shown = makeTest({ steps: [step("One changed", { id: "1" }), step("Two", { id: "2" })] });
    server.routes["xray.status"] = (input) => ({
      tests: [{ id: input.id, sync: "remote-changed", remote: "remote-changed" }],
    });
    const gate = deferred<unknown>();
    server.routes["xray.pull"] = () => gate.promise;
    editor();
    fireEvent.click(await screen.findByRole("button", { name: "conflict" }));
    const dlg = await screen.findByRole("dialog", { name: "Download from Jira?" });
    expect(within(dlg).getByText(/everything you edited since the last sync/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await menuItem("Download from Jira");
    fireEvent.click(await screen.findByRole("button", { name: "Overwrite local" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Overwrite local" })).toBeDisabled());
    expect(screen.getByText("Refreshing from Jira…")).toBeInTheDocument();
    gate.resolve({ pulled: ["LFRPS12-7"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks before downloading a test whose remote copy is missing", async () => {
    server.routes["xray.pull"] = () => ({});
    const { again } = editor();
    await ready();
    await menuItem("Download from Jira");
    const dlg = await screen.findByRole("dialog", { name: "Download from Jira?" });
    expect(within(dlg).getByText(/this test was never pushed/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Overwrite local" }));
    shown = makeTest({ steps: [step("Other")] });
    again({}, "t2");
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("LFRPS12-7 refreshed from Jira"));
  });

  it("has no download or Jira link for a local test", async () => {
    shown = makeTest({ key: undefined });
    editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "More actions for this test" }));
    expect(screen.queryByRole("menuitem", { name: "Download from Jira" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open in Jira ↗" })).toBeNull();
  });

  it("opens the test in Jira", async () => {
    server.routes["xray.browse"] = () => ({ url: "https://jira/LFRPS12-7" });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    editor();
    await ready();
    await menuItem("Open in Jira ↗");
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://jira/LFRPS12-7", "_blank", "noopener"));
  });

  it("undoes the local changes from the snapshot, or reports why not", async () => {
    synced();
    shown = makeTest({ steps: [step("One changed", { id: "1" }), step("New")] });
    server.routes["tests.restore"] = () => ({ id: "t1", sync: "synced" });
    const { onSaved } = editor();
    await ready();
    await menuItem("Undo local changes");
    const dlg = await screen.findByRole("dialog", { name: "Undo every local change?" });
    expect(within(dlg).getByText(/1 modified · 1 added · 1 deleted/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await menuItem("Undo local changes");
    fireEvent.click(await screen.findByRole("button", { name: "Undo local changes" }));
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("Restored the Jira version"));
    expect(onSaved).toHaveBeenCalledWith({ id: "t1", sync: "synced" });
    server.routes["tests.restore"] = () => undefined;
    await menuItem("Undo local changes");
    fireEvent.click(await screen.findByRole("button", { name: "Undo local changes" }));
    await waitFor(() => expect(toasts.filter((t) => t.title === "Restored the Jira version")).toHaveLength(2));
    server.routes["tests.restore"] = () => {
      throw new Fail("no snapshot");
    };
    await menuItem("Undo local changes");
    fireEvent.click(await screen.findByRole("button", { name: "Undo local changes" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not undo the local changes"));
  });

  it("refuses to undo while Claude works", async () => {
    synced();
    shown = makeTest({ steps: [step("One changed", { id: "1" })] });
    editor({ claudeRunning: "t1" });
    await ready();
    await menuItem("Undo local changes");
    expect(toasts.at(-1)?.title).toBe("Wait for Claude to finish");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a modified step's Jira version and restores it after confirming", async () => {
    synced();
    shown = makeTest({
      steps: [step("One changed", { id: "1", images: [{ file: "images/x.png" }] }), step("Two", { id: "2" })],
    });
    show = {
      ...show,
      files: ["images/a.png"],
      remote: makeTest({
        steps: [
          step("![](images/a.png)\n\n![](images/b.png)", {
            id: "1",
            images: [{ file: "images/a.png" }, { file: "images/b.png" }],
          }),
          step("Two", { id: "2" }),
        ],
      }),
    };
    editor();
    await ready();
    expect(screen.getByText("modified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jira version" }));
    fireEvent.click(screen.getAllByRole("img", { name: "b.png" })[0]);
    expect(screen.getByRole("dialog", { name: "Screenshot b.png" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore this step" }));
    const dlg = await screen.findByRole("dialog", { name: "Restore step 1 from Jira?" });
    expect(within(dlg).getByText(/Screenshots no longer in the project: 1 of them/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore this step" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore this step" }));
    expect(toasts.at(-1)?.title).toBe("Step 1 restored from Jira");
    await waitFor(() => expect(screen.queryByText("modified")).toBeNull());
  });

  it("shows a step deleted locally and brings it back", async () => {
    synced();
    shown = makeTest({ steps: [step("Two", { id: "2" })] });
    show = {
      remote: makeTest({
        steps: [
          step("One", { id: "1", fields: { Action: "One ![](images/g.png)" }, images: [{ file: "images/g.png" }] }),
          step("Two", { id: "2" }),
        ],
      }),
    };
    editor();
    await ready();
    const gone = screen.getByRole("region", { name: "Deleted step" });
    fireEvent.click(within(gone).getByRole("button", { name: "Jira version" }));
    fireEvent.click(within(gone).getByRole("img", { name: "g.png" }));
    expect(screen.getByRole("dialog", { name: "Screenshot g.png" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    fireEvent.click(within(gone).getByRole("button", { name: "Bring the step back" }));
    const dlg = await screen.findByRole("dialog", { name: "Bring the deleted step back?" });
    expect(within(dlg).getByText(/comes back where it was deleted/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Bring the step back" }));
    expect(toasts.at(-1)?.title).toBe("Deleted step restored");
    await waitFor(() => expect(actions()).toEqual(["One ", "Two"]));
  });

  it("places a deleted step after the last matching one, and offers no restore while Claude works", async () => {
    synced();
    shown = makeTest({ steps: [step("One", { id: "1" })] });
    editor({ claudeRunning: "t1" });
    await ready();
    const gone = screen.getByRole("region", { name: "Deleted step" });
    fireEvent.click(within(gone).getByRole("button", { name: "Jira version" }));
    expect(within(gone).queryByRole("button", { name: "Bring the step back" })).toBeNull();
  });
});

describe("TestEditor › menu and settings", () => {
  it("clones the test, or reports a failure", async () => {
    server.routes["tests.clone"] = () => ({ id: "t-copy" });
    const { onOpen, state } = editor();
    await ready();
    await menuItem("Clone");
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("t-copy"));
    expect(state.testsChanged).toHaveBeenCalled();
    server.routes["tests.clone"] = () => {
      throw new Fail("x");
    };
    await menuItem("Clone");
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not clone the test"));
  });

  it("asks even for an unchanged pushed copy, saying nothing is lost, as Xray Editor does", async () => {
    shown = makeTest({ steps: [step("One", { id: "1" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" })] }) };
    server.routes["tests.remove"] = () => ({});
    const { state } = editor();
    await ready();
    await menuItem("Delete local copy");
    const dlg = await screen.findByRole("dialog", { name: "Delete the local copy?" });
    expect(within(dlg).getByText(/nothing — the Jira test is left untouched/)).toBeInTheDocument();
    expect(callsTo("tests.remove")).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete local copy" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests"));
    expect(state.testsChanged).toHaveBeenCalled();
  });

  it("stays when an unchanged copy could not be deleted", async () => {
    shown = makeTest({ steps: [step("One", { id: "1" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" })] }) };
    server.routes["tests.remove"] = () => {
      throw new Fail("locked");
    };
    const { state } = editor();
    await ready();
    await menuItem("Delete local copy");
    const dlg = await screen.findByRole("dialog", { name: "Delete the local copy?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete local copy" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not delete the local copy"));
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("asks before deleting the only copy", async () => {
    server.routes["tests.remove"] = () => ({});
    const { state } = editor();
    await ready();
    await menuItem("Delete local copy");
    const dlg = await screen.findByRole("dialog", { name: "Delete the local copy?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await menuItem("Delete local copy");
    fireEvent.click(await screen.findByRole("button", { name: "Delete local copy" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests"));
  });

  it("attaches and resets Claude contexts, reporting a failure", async () => {
    let own: unknown = null;
    server.routes["contexts.setTest"] = (input) => {
      own = input.contexts;
      return { effective: input.contexts ?? [], own: input.contexts };
    };
    server.routes["contexts.ofTest"] = () => ({ effective: own ?? [], own });
    editor();
    await ready();
    const attach = await screen.findByRole("combobox", { name: "Attach context" });
    fireEvent.change(attach, { target: { value: "c1" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Detach Glossary" })).toBeInTheDocument());
    expect(callsTo("contexts.setTest")[0].input).toEqual({ testId: "t1", contexts: ["c1"] });
    await waitFor(() => expect(callsTo("contexts.ofTest").length).toBeGreaterThan(1));
    server.routes["contexts.setTest"] = () => {
      throw new Fail("x");
    };
    fireEvent.click(screen.getByRole("button", { name: "reset to project defaults" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not change the contexts of this test"));
  });

  it("manages contexts in their dialog and refreshes them after", async () => {
    server.routes["contexts.list"] = () => [];
    editor();
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Manage contexts…" }));
    const before = callsTo("contexts.list").length;
    fireEvent.click(screen.getByRole("button", { name: "close contexts" }));
    expect(screen.queryByRole("dialog", { name: "Contexts" })).toBeNull();
    await waitFor(() => expect(callsTo("contexts.list").length).toBe(before + 1));
    server.routes["contexts.list"] = () => {
      throw new Fail("x");
    };
    server.routes["contexts.ofTest"] = () => {
      throw new Fail("x");
    };
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    fireEvent.click(screen.getByRole("button", { name: "close contexts" }));
    act(() => void window.dispatchEvent(new Event("testimus:contexts")));
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual([]);
  });

  it("refreshes contexts listed as null", async () => {
    server.routes["contexts.list"] = () => null;
    editor();
    await ready();
    expect(await screen.findByRole("button", { name: "Manage contexts…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage contexts…" }));
    fireEvent.click(screen.getByRole("button", { name: "close contexts" }));
    await waitFor(() => expect(callsTo("contexts.list").length).toBe(2));
  });

  it("saves column modes for the project and for this test", async () => {
    server.routes["xray.prefs"] = () => ({});
    server.routes["tests.setColumns"] = (input) => ({ own: input.modes });
    const { state } = editor({ xray: fullXray });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Data column" })).getByRole("button", { name: "collapsed" }),
    );
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(callsTo("xray.prefs")[0].input).toEqual({ collapsed: ["Data"], filled: [] });
    fireEvent.click(screen.getByRole("button", { name: "this test" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Data column" })).getByRole("button", { name: "when filled" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "use project's" })).toBeInTheDocument());
    expect(callsTo("tests.setColumns")[0].input).toEqual({ id: "t1", modes: { Data: "filled" } });
  });

  it("reports failed column saves", async () => {
    server.routes["xray.prefs"] = () => {
      throw new Fail("x");
    };
    server.routes["tests.setColumns"] = () => {
      throw new Fail("x");
    };
    editor({ xray: fullXray });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Data column" })).getByRole("button", { name: "collapsed" }),
    );
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not save the column settings"));
    fireEvent.click(screen.getByRole("button", { name: "this test" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Data column" })).getByRole("button", { name: "collapsed" }),
    );
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not save the column settings of this test"));
  });

  it("starts from the test's own column modes", async () => {
    server.routes["tests.columns"] = () => ({ own: { Data: "collapsed" } });
    editor({ xray: fullXray });
    await ready();
    await waitFor(() => expect(screen.queryByLabelText("Data of step 1")).toBeNull());
    expect(screen.getByRole("button", { name: "Data column of step 1" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TestEditor › push", () => {
  beforeEach(() => {
    show = { sync: "modified" };
    server.routes["xray.plan"] = () => ({
      testId: "t1",
      ops: [{ kind: "update", label: "Update the summary" }],
      warnings: [],
      remoteChanged: false,
      review: "draft",
      planHash: "h",
    });
  });

  const confirm = async () => {
    const b = await screen.findByRole("button", { name: "Confirm push" });
    await waitFor(() => expect(b).toBeEnabled());
    fireEvent.click(b);
  };

  it("saves first, then opens the plan, and reloads when it closes", async () => {
    const { state } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "before push" } });
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    expect(await screen.findByRole("dialog", { name: "Push plan" })).toBeInTheDocument();
    expect(callsTo("tests.save")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Push plan" })).toBeNull();
    await waitFor(() => expect(state.testsChanged).toHaveBeenCalled());
    server.routes["tests.show"] = () => {
      throw new Fail("x");
    };
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual([]);
  });

  it("reloads the test after a push to the same id", async () => {
    server.routes["xray.push"] = () => ({ ok: true, id: "t1", ops: [{ label: "x", status: "done" }] });
    const { state, onOpen } = editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    await confirm();
    await waitFor(() => expect(state.testsChanged).toHaveBeenCalled());
    await waitFor(() => expect(callsTo("tests.show")).toHaveLength(2));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens and renames the recent entry after a first push, and reports a failed reload", async () => {
    server.routes["xray.push"] = () => ({ ok: true, id: "LFRPS12-99", ops: [] });
    const { onOpen } = editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    await confirm();
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("LFRPS12-99"));
    expect(recentIds()).toEqual(["LFRPS12-99"]);
    cleanup();
    server.routes["xray.push"] = () => ({ ok: true, id: "t1", ops: [] });
    editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    const b = await screen.findByRole("button", { name: "Confirm push" });
    await waitFor(() => expect(b).toBeEnabled());
    server.routes["tests.show"] = () => {
      throw new Fail("gone");
    };
    fireEvent.click(b);
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not reload the test"));
  });

  it("after a stopped push, the header shows the Jira key the push wrote to disk", async () => {
    shown = makeTest({ key: undefined });
    server.routes["xray.plan"] = () => ({
      testId: "t1",
      ops: [
        { kind: "create", label: "Create test in Jira" },
        { kind: "upload", label: "Upload a.png" },
      ],
      warnings: [],
      remoteChanged: false,
      review: "draft",
      planHash: "h",
    });
    server.routes["xray.push"] = () => {
      shown = makeTest({ key: "LFRPS12-99" });
      return {
        ok: false,
        id: "t1",
        failedAt: 1,
        error: "Attachment too big",
        ops: [
          { label: "Create test in Jira", status: "done" },
          { label: "Upload a.png", status: "failed", error: "Attachment too big" },
        ],
      };
    };
    const { container, onOpen } = editor();
    await ready();
    expect(container.querySelector(".testhead-key")).toHaveTextContent("local");
    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    await confirm();
    const progress = await screen.findByRole("dialog", { name: "Pushing to Jira" });
    expect(within(progress).getByText("Push stopped at operation 2 of 2")).toBeInTheDocument();
    fireEvent.click(within(progress).getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(container.querySelector(".testhead-key")).toHaveTextContent("LFRPS12-99"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("TestEditor › Xray Editor edge cases", () => {
  it("saves a pending edit with its own flusher before a dock run starts", async () => {
    server.routes["claude.status"] = () => ({ installed: true, signedIn: true });
    server.routes["claude.run"] = () => ({ ok: true, summary: "Done" });
    const state = app({
      route: { screen: "tests", arg: "t1" },
      focus: { testId: "t1", key: "LFRPS12-7", summary: "Sectionneur", step: null },
    });
    render(
      <AppContext.Provider value={state}>
        <TestEditor testId="t1" onSaved={vi.fn()} onOpen={vi.fn()} />
        <ClaudeDock folded={false} request={null} onFold={vi.fn()} />
      </AppContext.Provider>,
    );
    const desc = await screen.findByLabelText("Description");
    const box = screen.getByRole("textbox", { name: /^Ask/ });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.change(desc, { target: { value: "typed before the run" } });
      fireEvent.change(box, { target: { value: "Ajoute une source" } });
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(callsTo("claude.run")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
    const names = server.calls.map((c) => c.name);
    expect(names.filter((n) => n === "tests.save")).toHaveLength(1);
    expect(names.indexOf("tests.save")).toBeLessThan(names.indexOf("claude.run"));
    expect(savedTest().description).toBe("typed before the run");
  });

  it("does not take its own save for an outside change when the window gets focus", async () => {
    show = { mtime: 1 };
    server.routes["tests.save"] = (input) => {
      show = { mtime: 2 };
      return { id: input.id, sync: "modified", mtime: 2 };
    };
    editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "mine" } });
    blurWindow();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    focusWindow();
    await waitFor(() => expect(callsTo("tests.show")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(toasts.map((t) => t.title)).not.toContain("Reloaded from disk");
    expect(screen.getByLabelText("Description")).toHaveValue("mine");
  });

  it("says a reload on window focus that failed", async () => {
    show = { mtime: 1 };
    editor();
    await ready();
    server.routes["tests.show"] = () => {
      throw new Fail("locked");
    };
    focusWindow();
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not reload the test"));
    expect(actions()).toEqual(["One", "Two", "Three"]);
  });

  it("drops Claude's marks on a reload from disk and on switching to another test", async () => {
    show = { mtime: 1 };
    const { again } = editor({ lastRun: run({ changedSteps: { t1: [1] } }) });
    expect(await screen.findByText("Changed by Claude")).toBeInTheDocument();
    show = { mtime: 2 };
    focusWindow();
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("Reloaded from disk"));
    expect(screen.queryByText("Changed by Claude")).toBeNull();
    expect(screen.queryByText(/Claude changed/)).toBeNull();
    const second = run({ changedSteps: { t1: [2] }, nonce: 2 });
    again({ lastRun: second });
    expect(await screen.findByText("Changed by Claude")).toBeInTheDocument();
    shown = makeTest({ steps: [step("Other")] });
    again({ lastRun: second }, "t2");
    await waitFor(() => expect(actions()).toEqual(["Other"]));
    expect(screen.queryByText("Changed by Claude")).toBeNull();
    expect(screen.queryByText(/Claude changed/)).toBeNull();
  });

  it("asks Jira for the preconditions once per project, and for the folders once after a success", async () => {
    editor();
    await ready();
    cleanup();
    editor({}, "t2");
    await ready();
    expect(callsTo("xray.preconditions")).toHaveLength(1);
    fireEvent.click(screen.getByTitle(/Change the folder/));
    await waitFor(() => expect(document.querySelector('#testimus-folders option[value="/Lot"]')).not.toBeNull());
    fireEvent.keyDown(screen.getByLabelText("Folder"), { key: "Escape" });
    fireEvent.click(await screen.findByTitle(/Change the folder/));
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("xray.folders")).toHaveLength(1);
    expect(document.querySelector('#testimus-folders option[value="/Lot"]')).not.toBeNull();
  });

  it("inserts a blank step right below the step asked, the others keeping their order", async () => {
    editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Insert a step below step 2" }));
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(4);
    const text = cards.map(
      (a, i) => (within(a).queryByLabelText(`Action of step ${i + 1}`) as HTMLTextAreaElement | null)?.value ?? "",
    );
    expect(text).toEqual(["One", "Two", "", "Three"]);
    blurWindow();
    await waitFor(() => expect(callsTo("tests.save")).toHaveLength(1));
    expect(savedTest().steps.map((s) => s.fields.Action ?? "")).toEqual(["One", "Two", "", "Three"]);
    expect(savedTest().steps[2].fields).toEqual({});
  });

  it("saves the pending edit before cloning", async () => {
    server.routes["tests.clone"] = () => ({ id: "t-copy" });
    const { onOpen } = editor();
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "edited then cloned" } });
    await menuItem("Clone");
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("t-copy"));
    const names = server.calls.map((c) => c.name);
    expect(names.filter((n) => n === "tests.save")).toHaveLength(1);
    expect(names.indexOf("tests.save")).toBeLessThan(names.indexOf("tests.clone"));
    expect(savedTest().description).toBe("edited then cloned");
  });

  it("a download that ends after switching to another test leaves that test shown", async () => {
    const t1 = makeTest({ steps: [step("One", { id: "1" })] });
    const t2 = makeTest({ key: "LFRPS12-8", summary: "Other test", steps: [step("Other", { id: "9" })] });
    server.routes["tests.show"] = (input) =>
      input.id === "t2" ? { id: "t2", test: t2, remote: t2 } : { id: "t1", test: t1, remote: t1 };
    const gate = deferred<unknown>();
    server.routes["xray.pull"] = () => gate.promise;
    const { again } = editor();
    await ready();
    await menuItem("Download from Jira");
    await waitFor(() => expect(callsTo("xray.pull")).toHaveLength(1));
    again({}, "t2");
    await waitFor(() => expect(actions()).toEqual(["Other"]));
    const shows = callsTo("tests.show").length;
    gate.resolve({ pulled: ["LFRPS12-7"], failed: [] });
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("LFRPS12-7 refreshed from Jira"));
    await new Promise((r) => setTimeout(r, 20));
    expect(actions()).toEqual(["Other"]);
    expect(screen.getByDisplayValue("Other test")).toBeInTheDocument();
    expect(callsTo("tests.show").slice(shows)).toEqual([]);
  });

  it("a step's own column fold moves with the step, by Alt+↓ or the move button", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      }),
    );
    editor({ xray: fullXray });
    await ready();
    const data = (n: number) =>
      screen.getByRole("button", { name: `Data column of step ${n}` }).getAttribute("aria-pressed");
    const was = data(1);
    fireEvent.click(screen.getByRole("button", { name: "Data column of step 1" }));
    const now = data(1);
    expect(now).not.toBe(was);
    expect(data(2)).toBe(was);
    fireEvent.keyDown(screen.getByRole("article", { name: "Step 1" }), { key: "ArrowDown", altKey: true });
    expect(actions()).toEqual(["Two", "One", "Three"]);
    expect(data(1)).toBe(was);
    expect(data(2)).toBe(now);
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 down (Alt+↓)" }));
    expect(actions()).toEqual(["Two", "Three", "One"]);
    expect(data(2)).toBe(was);
    expect(data(3)).toBe(now);
  });
});

describe("TestEditor › defaults", () => {
  it("uses the default fields when the project has none", async () => {
    shown = makeTest({ steps: [step("One", { fields: { Action: "One", Data: "D" } })] });
    editor({ xray: undefined as unknown as AppState["xray"], info: null });
    await ready();
    expect(screen.getByLabelText("Data of step 1")).toBeInTheDocument();
  });
});

describe("TestEditor › parity", () => {
  it("saves 400 ms after the last edit, and only once", async () => {
    editor();
    const desc = await screen.findByLabelText("Description");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.change(desc, { target: { value: "a" } });
      await act(() => vi.advanceTimersByTimeAsync(399));
      expect(callsTo("tests.save")).toHaveLength(0);
      fireEvent.change(desc, { target: { value: "ab" } });
      await act(() => vi.advanceTimersByTimeAsync(399));
      expect(callsTo("tests.save")).toHaveLength(0);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(callsTo("tests.save")).toHaveLength(1);
      expect(savedTest().description).toBe("ab");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(callsTo("tests.save")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables Push to Jira while the push plan is open", async () => {
    show = { sync: "modified" };
    server.routes["xray.plan"] = () => new Promise(() => {});
    editor();
    await ready();
    const push = screen.getByRole("button", { name: "Push to Jira" });
    expect(push).toBeEnabled();
    fireEvent.click(push);
    await screen.findByRole("dialog", { name: "Push plan" });
    const held = screen.getByRole("button", { name: "Push to Jira", hidden: true });
    expect(held).toBeDisabled();
    expect(held).toHaveAttribute("title", "The push plan is open");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Push to Jira" })).toBeEnabled());
  });

  it("refuses an undo confirmed after Claude started on the test", async () => {
    shown = makeTest({ steps: [step("One changed", { id: "1" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" })] }) };
    server.routes["tests.restore"] = () => ({ id: "t1", sync: "synced" });
    const { again } = editor();
    await ready();
    await menuItem("Undo local changes");
    const dlg = await screen.findByRole("dialog", { name: "Undo every local change?" });
    again({ claudeRunning: "t1" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Undo local changes" }));
    expect(toasts.at(-1)?.title).toBe("Wait for Claude to finish");
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("tests.restore")).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "Undo every local change?" })).toBeNull();
  });

  it("refuses a download or a step restore confirmed after Claude started", async () => {
    shown = makeTest({ steps: [step("One changed", { id: "1" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" })] }) };
    server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-7"] });
    const { again } = editor();
    await ready();
    await menuItem("Download from Jira");
    const dl = await screen.findByRole("dialog", { name: "Download from Jira?" });
    again({ claudeRunning: "*project*" });
    fireEvent.click(within(dl).getByRole("button", { name: "Overwrite local" }));
    expect(toasts.at(-1)?.title).toBe("Wait for Claude to finish");
    await new Promise((r) => setTimeout(r, 20));
    expect(callsTo("xray.pull")).toHaveLength(0);
    again({ claudeRunning: null });
    fireEvent.click(await screen.findByRole("button", { name: "Jira version" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore this step" }));
    const rs = await screen.findByRole("dialog", { name: /Restore step 1 from Jira/ });
    again({ claudeRunning: "*project*" });
    fireEvent.click(within(rs).getByRole("button", { name: "Restore this step" }));
    expect(toasts.filter((t) => t.title === "Wait for Claude to finish")).toHaveLength(2);
    expect(screen.getByDisplayValue("One changed")).toBeInTheDocument();
  });

  it("drops Claude's marks when the local changes are undone", async () => {
    shown = makeTest({ steps: [step("One changed", { id: "1" }), step("Two", { id: "2" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] }) };
    server.routes["tests.restore"] = () => ({ id: "t1", sync: "synced" });
    const { again } = editor();
    await ready();
    again({ lastRun: run({ changedSteps: { t1: [1] } }) });
    expect(await screen.findByText("Changed by Claude")).toBeInTheDocument();
    expect(screen.getByText("Claude changed 1 step")).toBeInTheDocument();
    shown = makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] });
    await menuItem("Undo local changes");
    fireEvent.click(await screen.findByRole("button", { name: "Undo local changes" }));
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("Restored the Jira version"));
    expect(callsTo("tests.restore")).toHaveLength(1);
    expect(screen.queryByText("Changed by Claude")).toBeNull();
    expect(screen.queryByText(/Claude changed/)).toBeNull();
  });

  it("makes the steps inert while Claude works on the test, and live again after", async () => {
    const { again, container } = editor({ claudeRunning: "t1" });
    await ready();
    expect(container.querySelector(".editor-scroll")).toHaveAttribute("inert");
    again({ claudeRunning: null });
    await waitFor(() => expect(container.querySelector(".editor-scroll")).not.toHaveAttribute("inert"));
  });

  it("opens with the details hidden when that was the last choice", async () => {
    localStorage.setItem("testimus.showDetails", "0");
    editor();
    await ready();
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("opens in the remembered split layout and counts the steps", async () => {
    localStorage.setItem("testimus.stepLayout", "split");
    const { container } = editor();
    await ready();
    expect(container.querySelectorAll(".step-body.is-split")).toHaveLength(3);
    const count = () => container.querySelector(".steps-head .muted")?.textContent;
    expect(count()).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    await waitFor(() => expect(count()).toBe("4"));
    expect(container.querySelectorAll(".step-body.is-split")).toHaveLength(4);
  });
});

describe("TestEditor › late callbacks after the same test reloads (PARITY #3, #10)", () => {
  const imageStep = (): Step => ({
    fields: { Action: "![](images/a.png)", "Expected Result": "ok" },
    sources: [],
    images: [{ file: "images/a.png" }],
  });
  const lastToast = (title: string) => toasts.filter((t) => t.title === title).at(-1) as T;
  const settle = async () => {
    blurWindow();
    await new Promise((r) => setTimeout(r, 450));
  };

  it("a reload from disk on window focus makes an image Undo, its expiry and a step Undo too late", async () => {
    server.routes["tests.removeImage"] = () => ({ removed: false, reason: "a step still lists it" });
    show = { mtime: 1 };
    shown = makeTest({ steps: [step("One"), imageStep(), step("Three")] });
    editor();
    await screen.findByRole("img", { name: "a.png" });
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png from Action of step 2" }));
    const image = lastToast("Image removed");
    expect(image.onExpire).toBeTypeOf("function");
    fireEvent.click(screen.getByRole("button", { name: "Delete step 3" }));
    const deleted = lastToast("Step 3 deleted");
    show = { mtime: 2 };
    shown = makeTest({ steps: [step("Disk one"), step("Disk two")] });
    focusWindow();
    await waitFor(() => expect(actions()).toEqual(["Disk one", "Disk two"]));
    expect(toasts.at(-1)?.title).toBe("Reloaded from disk");
    const saves = callsTo("tests.save").length;
    act(() => image.action?.run());
    expect(toasts.at(-1)?.title).toBe("Too late to undo");
    act(() => deleted.action?.run());
    expect(toasts.at(-1)).toMatchObject({ title: "Too late to undo", detail: "The test was reloaded since." });
    act(() => image.onExpire?.());
    await settle();
    expect(callsTo("tests.save")).toHaveLength(saves);
    expect(actions()).toEqual(["Disk one", "Disk two"]);
    expect(screen.queryByRole("img", { name: "a.png" })).toBeNull();
  });

  it("a Download from Jira shows what Jira has, drops Claude's marks and makes an earlier Undo too late", async () => {
    shown = makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] }) };
    server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-7"], failed: [] });
    editor({ lastRun: run({ changedSteps: { t1: [1] } }) });
    expect(await screen.findByText("Claude changed 1 step")).toBeInTheDocument();
    expect(screen.getByText("Changed by Claude")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete step 2" }));
    const deleted = lastToast("Step 2 deleted");
    const jira = makeTest({ summary: "Sectionneur (Jira)", steps: [step("Jira one", { id: "1" })] });
    shown = jira;
    show = { remote: jira };
    await menuItem("Download from Jira");
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("LFRPS12-7 refreshed from Jira"));
    expect(callsTo("xray.pull").at(-1)?.input).toEqual({ key: "LFRPS12-7", overwrite: true });
    expect(await screen.findByDisplayValue("Sectionneur (Jira)")).toBeInTheDocument();
    expect(actions()).toEqual(["Jira one"]);
    expect(screen.queryByText(/Claude changed/)).toBeNull();
    expect(screen.queryByText("Changed by Claude")).toBeNull();
    const saves = callsTo("tests.save").length;
    act(() => deleted.action?.run());
    expect(toasts.at(-1)?.title).toBe("Too late to undo");
    await settle();
    expect(callsTo("tests.save")).toHaveLength(saves);
    expect(actions()).toEqual(["Jira one"]);
  });

  it("an Undo of the local changes makes an earlier step Undo too late", async () => {
    shown = makeTest({ steps: [step("One changed", { id: "1" }), step("Two", { id: "2" })] });
    show = { remote: makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] }) };
    server.routes["tests.restore"] = () => ({ id: "t1", sync: "synced" });
    editor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Delete step 2" }));
    const deleted = lastToast("Step 2 deleted");
    shown = makeTest({ steps: [step("One", { id: "1" }), step("Two", { id: "2" })] });
    await menuItem("Undo local changes");
    fireEvent.click(await screen.findByRole("button", { name: "Undo local changes" }));
    await waitFor(() => expect(toasts.at(-1)?.title).toBe("Restored the Jira version"));
    expect(actions()).toEqual(["One", "Two"]);
    const saves = callsTo("tests.save").length;
    act(() => deleted.action?.run());
    expect(toasts.at(-1)?.title).toBe("Too late to undo");
    await settle();
    expect(callsTo("tests.save")).toHaveLength(saves);
    expect(actions()).toEqual(["One", "Two"]);
  });
});

describe("TestEditor › header and columns (PARITY #5, #47, #87)", () => {
  it("Ask Claude in the header asks on the whole test even while a step has the focus", async () => {
    const { state } = editor();
    await ready();
    fireEvent.focus(screen.getByLabelText("Action of step 2"));
    await waitFor(() => expect(state.setFocus).toHaveBeenLastCalledWith(expect.objectContaining({ step: 2 })));
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    expect(state.askClaude).toHaveBeenCalledTimes(1);
    expect(state.askClaude).toHaveBeenLastCalledWith("test");
  });

  it("a column switched off in Xray shows on a step that holds a value, folds on one that does not, and can be set open", async () => {
    const offXray = {
      fields: [...fullXray.fields, { id: "customfield_9", name: "Retired", type: "text", disabled: true }],
      prefs: { order: ["Action", "Data", "Expected Result", "Retired"], collapsed: [], hidden: [] },
    } as AppState["xray"];
    shown = makeTest({
      steps: [step("One", { fields: { Action: "One", "Expected Result": "ok", Retired: "old value" } }), step("Two")],
    });
    server.routes["xray.prefs"] = () => ({});
    const { state } = editor({ xray: offXray });
    await ready();
    expect(screen.getByLabelText("Retired of step 1")).toHaveValue("old value");
    expect(screen.getByRole("button", { name: "Retired column of step 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Retired of step 2")).toBeNull();
    expect(screen.getByRole("button", { name: "Retired column of step 2" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const row = screen.getByRole("group", { name: "Retired column" });
    expect(row.parentElement).toHaveTextContent("off in Xray");
    expect(within(row).getByRole("button", { name: "when filled" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(row).getByRole("button", { name: "open" }));
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(callsTo("xray.prefs")[0].input).toEqual({ collapsed: [], filled: [], open: ["Retired"] });
  });

  it("detaches one context of the test and resets the test to the project's contexts", async () => {
    let own: string[] | null = ["c1", "c2"];
    server.routes["contexts.list"] = () => [
      { id: "c1", name: "Glossary" },
      { id: "c2", name: "House style" },
    ];
    server.routes["contexts.ofTest"] = () => ({ effective: own ?? ["c2"], own });
    server.routes["contexts.setTest"] = (input) => {
      own = input.contexts as string[] | null;
      return { effective: own ?? ["c2"], own };
    };
    editor();
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Detach Glossary" }));
    await waitFor(() => expect(callsTo("contexts.setTest")).toHaveLength(1));
    expect(callsTo("contexts.setTest")[0].input).toEqual({ testId: "t1", contexts: ["c2"] });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Detach Glossary" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "reset to project defaults" }));
    await waitFor(() => expect(callsTo("contexts.setTest")).toHaveLength(2));
    expect(callsTo("contexts.setTest")[1].input).toEqual({ testId: "t1", contexts: null });
    await waitFor(() => expect(screen.queryByRole("button", { name: "reset to project defaults" })).toBeNull());
    expect(screen.getByRole("button", { name: "Detach House style" })).toBeInTheDocument();
    expect(errors).toEqual([]);
  });
});
