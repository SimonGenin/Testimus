// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTestRef } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { draftOf, keepDraft } from "../../../../src/ui/lib/drafts.ts";
import { abandonPulls, startPull } from "../../../../src/ui/screens/tests/pulls.ts";
import { TestsScreen } from "../../../../src/ui/screens/tests/TestsScreen.tsx";
import { iconOf } from "../../helpers/icons.ts";
import { app } from "../../helpers/ui-desktop.tsx";
import { callsTo, deferred, Fail, server, stubServer } from "../../helpers/ui-server.ts";
import { testClient, WithData } from "./data-helpers.tsx";

const row = (name: RegExp) => screen.findByRole("treeitem", { name });
const rowAction = async (name: RegExp, action: string) => {
  const r = await row(name);
  fireEvent.focus(r);
  return within(r).getByRole("button", { name: action });
};
const edge = () => screen.getByRole("separator", { name: "Resize section 1" });
const keptWidth = () => JSON.parse(localStorage.getItem("testimus.layoutTests") ?? "null")?.columns[0].width;
// ponytail: a layout kept by an earlier visit, its list column that wide
const keepLayout = (width: number) =>
  localStorage.setItem(
    "testimus.layoutTests",
    JSON.stringify({
      columns: [
        { width, split: null, sections: [{ id: "a", tabs: ["list"], active: "list" }] },
        { width: null, split: null, sections: [{ id: "b", tabs: ["test"], active: "test" }] },
        { width: 400, split: null, sections: [{ id: "c", tabs: ["claude"], active: "claude", collapsed: true }] },
      ],
    }),
  );

vi.mock("../../../../src/ui/screens/tests/TestEditor.tsx", () => ({
  TestEditor: ({
    testId,
    onOpen,
    onSaved,
  }: {
    testId: string;
    onOpen: (id: string) => void;
    onSaved: (r: Partial<LocalTestRef> & { id: string }) => void;
  }) => (
    <div>
      <p>Editing {testId}</p>
      <button type="button" onClick={() => onOpen("t2")}>
        open t2
      </button>
      <button type="button" onClick={() => onSaved({ id: testId, summary: "Renamed row" })}>
        saved
      </button>
    </div>
  ),
}));

const errors: { title?: string }[] = [];
vi.mock("../../../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/ui/lib/toast.ts")>();
  return { ...real, errorToast: vi.fn((_e: unknown, title?: string) => errors.push({ title })) };
});

const ref = (id: string, o: Partial<LocalTestRef> = {}): LocalTestRef => ({
  id,
  summary: `Test ${id}`,
  folder: "/",
  labels: [],
  review: "draft",
  generated: false,
  edited: false,
  sync: "synced",
  dirty: false,
  synced: true,
  mtime: Date.now(),
  stepCount: 1,
  ...o,
});

let refs: LocalTestRef[] = [];
let seq = 0;

beforeEach(() => {
  stubServer();
  refs = [ref("t1", { key: "K-1" }), ref("t2")];
  server.routes["tests.list"] = () => refs;
  server.routes["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
  server.routes["jobs.list"] = () => [];
  errors.length = 0;
  localStorage.clear();
  // ponytail: the list's view (tab, boxes, folds) is kept per project for the page's life — each case its own project
  setProject(`C:\\p-${++seq}`);
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
});

afterEach(() => {
  act(() => abandonPulls());
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const screenOf = (over: Partial<AppState> = {}) => {
  const state = app({ route: { screen: "tests" }, ...over });
  const client = testClient();
  const tree = (s: AppState) => (
    <WithData client={client}>
      <AppContext.Provider value={s}>
        <TestsScreen />
      </AppContext.Provider>
    </WithData>
  );
  const r = render(tree(state));
  return { ...r, state, again: (o: Partial<AppState>) => r.rerender(tree({ ...state, ...o })) };
};

describe("TestsScreen", () => {
  it("lists the tests and says no test is open", async () => {
    const { state } = screenOf();
    expect(await screen.findByText("No test open")).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("button", { name: "New test" })).toBeInTheDocument();
    fireEvent.click(await row(/^Test t1/));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t1");
  });

  it("opens the routed test and updates its row after a save", async () => {
    const { state, again } = screenOf({ route: { screen: "tests", arg: "t1" } });
    expect(screen.getByText("Editing t1")).toBeInTheDocument();
    await row(/^Test t1/);
    refs = [ref("t1", { key: "K-1", summary: "Renamed row" }), ref("t2")];
    again({ testsNonce: 1 });
    expect(await row(/^Renamed row/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "open t2" }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t2");
    again({ testsNonce: 2 });
    await waitFor(() => expect(callsTo("tests.list")).toHaveLength(3));
  });

  it("sends a generated test still in review to Review, never a validated one", async () => {
    refs = [
      { ...ref("g1", { generated: true, review: "draft" }), awaiting: true } as LocalTestRef,
      ref("g2", { generated: true, review: "validated" }),
    ];
    const { state, again } = screenOf({ route: { screen: "tests", arg: "g1" } });
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("review", "g1"));
    vi.mocked(state.navigate).mockClear();
    again({ route: { screen: "tests", arg: "g2" } });
    await waitFor(() => expect(callsTo("tests.list")).toHaveLength(1));
    expect(state.navigate).not.toHaveBeenCalledWith("review", "g2");
  });

  it("forgets a test it sent to Review, so the rail's Tests opens the list and not Review again", async () => {
    refs = [{ ...ref("g1", { generated: true, review: "to-fix" }), awaiting: true } as LocalTestRef];
    keepDraft("route.tests", "g1");
    const { state } = screenOf({ route: { screen: "tests", arg: "g1" } });
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("review", "g1"));
    expect(draftOf("route.tests")).toBeUndefined();
  });

  it("treats a non-list answer as empty, a failure as a toast, and ignores another screen's arg", async () => {
    server.routes["tests.list"] = () => ({ nope: true });
    const { state } = screenOf({ route: { screen: "documents", arg: "t1" } as AppState["route"] });
    expect(await screen.findAllByText(/No test yet/)).toHaveLength(2);
    const main = screen.getByRole("main");
    fireEvent.click(within(main).getByRole("button", { name: "Generate tests" }));
    expect(state.navigate).toHaveBeenCalledWith("generate");
    server.routes["tests.create"] = () => ({ id: "t9" });
    fireEvent.click(within(main).getByRole("button", { name: "New test" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests", "t9"));
    expect(callsTo("tests.create")[0].input).toEqual({ folder: "/", summary: "New test" });
    cleanup();
    server.routes["tests.list"] = () => {
      throw new Fail("no project");
    };
    screenOf();
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not list the tests"));
  });

  it("asks for nothing and says nothing while no project is open", async () => {
    setProject(null);
    const { state } = screenOf();
    expect(await screen.findAllByText(/^No project open\.?$/)).toHaveLength(2);
    expect(iconOf(screen.getByText("No project open."))).toBeUndefined();
    expect(screen.queryByText(/No test yet/)).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Filter tests" })).toBeDisabled();
    expect(
      within(screen.getByRole("complementary", { name: "Tests" })).getByRole("button", { name: "New test" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open a project…" }));
    expect(state.navigate).toHaveBeenCalledWith("setup", "project/app");
    expect(callsTo("tests.list")).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("drops a list or an error asked for by the project being left", async () => {
    const gate = deferred<unknown>();
    let asked = 0;
    server.routes["tests.list"] = () => (asked++ ? [] : gate.promise);
    setProject("C:\\a");
    const first = screenOf();
    setProject("C:\\b");
    first.again({ info: { ...first.state.info, dir: "C:\\b" } as AppState["info"] });
    gate.resolve(refs);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("treeitem", { name: /^Test t1/ })).toBeNull();
    cleanup();
    const fail = deferred<unknown>();
    let once = 0;
    server.routes["tests.list"] = () => (once++ ? [] : fail.promise);
    const second = screenOf();
    setProject("C:\\c");
    second.again({ info: { ...second.state.info, dir: "C:\\c" } as AppState["info"] });
    fail.reject(new Fail("gone"));
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual([]);
  });

  it("goes back to the list when the project changes and abandons the other project's pulls", async () => {
    server.routes["xray.pull"] = () => new Promise(() => {});
    setProject("C:\\a");
    const { state, again } = screenOf({ route: { screen: "tests", arg: "t1" } });
    await row(/^Test t1/);
    act(() => startPull("K-5", "Five"));
    setProject("C:\\b");
    again({ info: { ...state.info, dir: "C:\\b" } as AppState["info"] });
    expect(state.navigate).toHaveBeenCalledWith("tests");
    again({ info: null });
  });

  it("starts a pull for a Jira test, shows its pane and lands on the pulled test", async () => {
    const gate = deferred<unknown>();
    server.routes["xray.pull"] = () => gate.promise;
    server.routes["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 1, totalCount: 1, folders: [] });
    server.routes["xray.search"] = () => ({
      tests: [{ key: "K-9", summary: "Nine", status: "", stepCount: 1 }],
      total: 1,
    });
    const { state, again } = screenOf();
    fireEvent.click(screen.getByRole("tab", { name: /Jira/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^Nine/ }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "K-9");
    again({ route: { screen: "tests", arg: "K-9" } });
    expect(screen.getByRole("region", { name: /^Pulling K-9/ })).toBeInTheDocument();
    refs = [...refs, ref("t9", { key: "K-9" })];
    await act(async () => gate.resolve({ pulled: ["K-9"] }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests", "t9"));
  });

  it("after a reload, shows the pull its job says is still running, with its stage", async () => {
    const job = {
      id: "pull-9",
      kind: "pull",
      subject: "K-9",
      status: "running",
      startedAt: new Date().toISOString(),
      message: "K-9: image 2 of 3",
    };
    server.routes["jobs.list"] = () => [job];
    server.routes["jobs.show"] = () => ({
      job,
      events: [
        {
          jobId: "pull-9",
          at: job.startedAt,
          type: "progress",
          message: "K-9: read",
          pull: { key: "K-9", phase: "images", done: 2, total: 3 },
        },
      ],
    });
    screenOf({ route: { screen: "tests", arg: "K-9" } });
    expect(await screen.findByRole("region", { name: /^Pulling K-9/ })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Pull progress" })).toHaveTextContent("image 2 of 3");
    expect(await screen.findByRole("progressbar", { name: "Images downloaded" })).toHaveAttribute(
      "aria-valuenow",
      "67",
    );
  });

  it("does not move when the pulled test is not the one on screen", async () => {
    server.routes["xray.pull"] = () => ({ pulled: ["K-8"] });
    const { state } = screenOf();
    await row(/^Test t1/);
    act(() => startPull("K-8", "Eight"));
    await waitFor(() => expect(callsTo("tests.list").length).toBeGreaterThan(1));
    expect(state.navigate).not.toHaveBeenCalledWith("tests", expect.stringMatching(/t/));
  });

  it("cancels, retries and leaves a failed pull from its pane", async () => {
    let n = 0;
    server.routes["xray.pull"] = () => {
      n++;
      throw new Fail("403");
    };
    const { state } = screenOf({ route: { screen: "tests", arg: "K-7" } });
    act(() => startPull("K-7", "Seven"));
    expect(await screen.findByText("Could not pull K-7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(n).toBe(2));
    expect(await screen.findByText("Could not pull K-7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(state.navigate).toHaveBeenCalledWith("tests");
    server.routes["xray.pull"] = () => new Promise(() => {});
    act(() => startPull("K-7", "Seven"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: /^Pulling/ })).toBeNull();
  });

  it("navigates away from a deleted open test and reloads", async () => {
    server.routes["tests.remove"] = () => ({});
    const file = {
      key: "K-1",
      project: "K",
      summary: "Test t1",
      folder: "/",
      labels: [],
      description: "",
      covers: [],
      preconditions: [],
      review: "draft",
      steps: [],
      extra: {},
    };
    server.routes["tests.show"] = () => ({ test: file, remote: file });
    const { state } = screenOf({ route: { screen: "tests", arg: "t1" } });
    fireEvent.click(await rowAction(/^Test t1/, "Delete the local copy of K-1"));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests"));
    cleanup();
    const other = screenOf({ route: { screen: "tests", arg: "t2" } });
    fireEvent.click(await rowAction(/^Test t1/, "Delete the local copy of K-1"));
    await waitFor(() => expect(callsTo("tests.list").length).toBeGreaterThan(2));
    expect(other.state.navigate).not.toHaveBeenCalledWith("tests");
  });

  it("resizes the list's column, keeps the width in the screen's layout and resets it", () => {
    screenOf();
    expect(edge()).toHaveAttribute("aria-valuenow", "320");
    fireEvent.pointerUp(edge());
    expect(localStorage.getItem("testimus.layoutTests")).toBeNull();
    fireEvent.pointerDown(edge(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(edge(), { clientX: 400 });
    expect(edge()).toHaveAttribute("aria-valuenow", "620");
    fireEvent.pointerUp(edge());
    expect(keptWidth()).toBe(620);
    fireEvent.doubleClick(edge());
    expect(edge()).toHaveAttribute("aria-valuenow", "320");
    expect(keptWidth()).toBe(320);
  });

  it("clamps a kept width to 200 px at least; a drag stops there and goes as wide as the room allows", () => {
    keepLayout(100);
    screenOf();
    expect(edge()).toHaveAttribute("aria-valuenow", "200");
    fireEvent.pointerDown(edge(), { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(edge(), { clientX: 290 });
    expect(edge()).toHaveAttribute("aria-valuenow", "200");
    expect(screen.queryByText("Release to collapse")).toBeNull();
    fireEvent.pointerMove(edge(), { clientX: 2000 });
    expect(edge()).toHaveAttribute("aria-valuenow", "1900");
    fireEvent.pointerUp(edge());
    expect(keptWidth()).toBe(1900);
  });

  it("starts at a remembered layout and ignores one it cannot read", () => {
    keepLayout(360);
    screenOf();
    expect(edge()).toHaveAttribute("aria-valuenow", "360");
    cleanup();
    localStorage.setItem("testimus.layoutTests", "{");
    screenOf();
    expect(edge()).toHaveAttribute("aria-valuenow", "320");
  });

  it("copes with a storage that throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    screenOf();
    fireEvent.doubleClick(edge());
    get.mockRestore();
    set.mockRestore();
  });

  it("folds the list's section to a strip of icons, opens it again on the list, and opens a test from it", async () => {
    const { state } = screenOf();
    await row(/^Test t1/);
    expect(screen.getByRole("navigation", { name: "Section 3, collapsed" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Collapse this section" })[0]);
    const strip = screen.getByRole("navigation", { name: "Section 1, collapsed" });
    expect(JSON.parse(localStorage.getItem("testimus.layoutTests") ?? "{}").columns[0].sections[0].collapsed).toBe(
      true,
    );
    expect(screen.queryByRole("separator", { name: "Resize section 1" })).toBeNull();
    fireEvent.click(within(strip).getByRole("button", { name: "Tests, 2" }));
    expect(screen.queryByRole("navigation", { name: "Section 1, collapsed" })).toBeNull();
    expect(edge()).toBeInTheDocument();
    fireEvent.click(await row(/^Test t1/));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t1");
  });
});
