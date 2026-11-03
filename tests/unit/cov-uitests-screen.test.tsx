// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalTestRef } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { abandonPulls, startPull } from "../../src/ui/screens/tests/pulls.ts";
import { TestsScreen } from "../../src/ui/screens/tests/TestsScreen.tsx";
import { callsTo, deferred, Fail, server, stubServer } from "./cov-uitests-helpers.ts";
import { app } from "./ui-desktop-helpers.tsx";

vi.mock("../../src/ui/screens/tests/TestEditor.tsx", () => ({
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
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return { ...real, errorToast: vi.fn((_e: unknown, title?: string) => errors.push({ title })) };
});

const ref = (id: string, o: Partial<LocalTestRef> = {}): LocalTestRef => ({
  id,
  summary: `Test ${id}`,
  folder: "/",
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

beforeEach(() => {
  stubServer();
  refs = [ref("t1", { key: "K-1" }), ref("t2")];
  server.routes["tests.list"] = () => refs;
  server.routes["xray.folders"] = () => ({ name: "/", path: "/", testsCount: 0, totalCount: 0, folders: [] });
  server.routes["jobs.list"] = () => [];
  errors.length = 0;
  localStorage.clear();
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
  const tree = (s: AppState) => (
    <AppContext.Provider value={s}>
      <TestsScreen />
    </AppContext.Provider>
  );
  const r = render(tree(state));
  return { ...r, state, again: (o: Partial<AppState>) => r.rerender(tree({ ...state, ...o })) };
};

describe("TestsScreen", () => {
  it("lists the tests and says no test is open", async () => {
    const { state } = screenOf();
    expect(screen.getByText("No test open")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^Test t1/ }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t1");
  });

  it("opens the routed test and updates its row after a save", async () => {
    const { state, again } = screenOf({ route: { screen: "tests", arg: "t1" } });
    expect(screen.getByText("Editing t1")).toBeInTheDocument();
    await screen.findAllByRole("button", { name: /^Test t1/ });
    fireEvent.click(screen.getByRole("button", { name: "saved" }));
    expect((await screen.findAllByRole("button", { name: /^Renamed row/ })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "open t2" }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "t2");
    again({ testsNonce: 1 });
    await waitFor(() => expect(callsTo("tests.list")).toHaveLength(2));
  });

  it("sends a generated test still in review to Review, never a validated one", async () => {
    refs = [ref("g1", { generated: true, review: "checked" }), ref("g2", { generated: true, review: "validated" })];
    const { state, again } = screenOf({ route: { screen: "tests", arg: "g1" } });
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("review", "g1"));
    vi.mocked(state.navigate).mockClear();
    again({ route: { screen: "tests", arg: "g2" } });
    await waitFor(() => expect(callsTo("tests.list")).toHaveLength(1));
    expect(state.navigate).not.toHaveBeenCalledWith("review", "g2");
  });

  it("treats a non-list answer as empty, a failure as a toast, and ignores another screen's arg", async () => {
    server.routes["tests.list"] = () => ({ nope: true });
    screenOf({ route: { screen: "documents", arg: "t1" } as AppState["route"] });
    expect(await screen.findByText(/No tests yet/)).toBeInTheDocument();
    expect(screen.getByText("No test open")).toBeInTheDocument();
    cleanup();
    server.routes["tests.list"] = () => {
      throw new Fail("no project");
    };
    screenOf();
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not list the tests"));
  });

  it("drops a list or an error asked for by the project being left", async () => {
    const gate = deferred<unknown>();
    server.routes["tests.list"] = () => gate.promise;
    setProject("C:\\a");
    screenOf();
    setProject("C:\\b");
    gate.resolve(refs);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /^Test t1/ })).toBeNull();
    cleanup();
    const fail = deferred<unknown>();
    server.routes["tests.list"] = () => fail.promise;
    screenOf();
    setProject("C:\\c");
    fail.reject(new Fail("gone"));
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual([]);
  });

  it("goes back to the list when the project changes and abandons the other project's pulls", async () => {
    server.routes["xray.pull"] = () => new Promise(() => {});
    setProject("C:\\a");
    const { state, again } = screenOf({ route: { screen: "tests", arg: "t1" } });
    await screen.findByRole("button", { name: /^Test t1/ });
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
    fireEvent.click(await screen.findByRole("button", { name: /^Nine/ }));
    expect(state.navigate).toHaveBeenCalledWith("tests", "K-9");
    again({ route: { screen: "tests", arg: "K-9" } });
    expect(screen.getByText("Pulling")).toBeInTheDocument();
    refs = [...refs, ref("t9", { key: "K-9" })];
    await act(async () => gate.resolve({ pulled: ["K-9"] }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests", "t9"));
  });

  it("does not move when the pulled test is not the one on screen", async () => {
    server.routes["xray.pull"] = () => ({ pulled: ["K-8"] });
    const { state } = screenOf();
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
    expect(await screen.findByText("Pull failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(n).toBe(2));
    expect(await screen.findByText("Pull failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(state.navigate).toHaveBeenCalledWith("tests");
    server.routes["xray.pull"] = () => new Promise(() => {});
    act(() => startPull("K-7", "Seven"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Pulling")).toBeNull();
  });

  it("navigates away from a deleted open test and reloads", async () => {
    server.routes["tests.remove"] = () => ({});
    const { state } = screenOf({ route: { screen: "tests", arg: "t1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Delete the local copy of K-1" }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("tests"));
    cleanup();
    const other = screenOf({ route: { screen: "tests", arg: "t2" } });
    fireEvent.click(await screen.findByRole("button", { name: "Delete the local copy of K-1" }));
    await waitFor(() => expect(callsTo("tests.list").length).toBeGreaterThan(2));
    expect(other.state.navigate).not.toHaveBeenCalledWith("tests");
  });

  it("resizes the list, remembers the width and resets it", () => {
    const { container } = screenOf();
    const edge = screen.getByRole("separator", { name: "Resize the test list" });
    const list = container.querySelector(".tside") as HTMLElement;
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ width: 300 } as DOMRect);
    const root = container.querySelector(".tests-screen") as HTMLElement;
    fireEvent.pointerUp(edge);
    expect(localStorage.getItem("testimus.sidebarWidth")).toBeNull();
    fireEvent.pointerDown(edge, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 400 });
    expect(root.style.getPropertyValue("--tside-w")).toBe("480px");
    fireEvent.pointerUp(edge);
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("480");
    fireEvent.pointerDown(edge, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(edge);
    fireEvent.doubleClick(edge);
    expect(localStorage.getItem("testimus.sidebarWidth")).toBeNull();
    expect(root.style.getPropertyValue("--tside-w")).toBe("");
  });

  it("ignores a stored width below 240 and clamps a drag between 240 and 480 (PARITY #58)", () => {
    localStorage.setItem("testimus.sidebarWidth", "100");
    const { container } = screenOf();
    const root = container.querySelector(".tests-screen") as HTMLElement;
    expect(root.style.getPropertyValue("--tside-w")).toBe("");
    const edge = screen.getByRole("separator", { name: "Resize the test list" });
    vi.spyOn(container.querySelector(".tside") as HTMLElement, "getBoundingClientRect").mockReturnValue({
      width: 300,
    } as DOMRect);
    fireEvent.pointerDown(edge, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 250 });
    expect(root.style.getPropertyValue("--tside-w")).toBe("250px");
    fireEvent.pointerMove(edge, { clientX: 0 });
    expect(root.style.getPropertyValue("--tside-w")).toBe("240px");
    fireEvent.pointerUp(edge);
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("240");
    fireEvent.pointerDown(edge, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 2000 });
    expect(root.style.getPropertyValue("--tside-w")).toBe("480px");
    fireEvent.pointerUp(edge);
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("480");
  });

  it("starts at a remembered width and ignores one out of range", () => {
    localStorage.setItem("testimus.sidebarWidth", "320");
    const { container } = screenOf();
    expect((container.querySelector(".tests-screen") as HTMLElement).style.getPropertyValue("--tside-w")).toBe("320px");
    cleanup();
    localStorage.setItem("testimus.sidebarWidth", "9999");
    const wide = screenOf();
    expect((wide.container.querySelector(".tests-screen") as HTMLElement).style.getPropertyValue("--tside-w")).toBe("");
  });

  it("copes with a storage that throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    screenOf();
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize the test list" }));
    get.mockRestore();
    set.mockRestore();
  });

  it("on a narrow window, shows the list as a drawer closed by Escape, the scrim and opening a test", async () => {
    Object.defineProperty(window, "innerWidth", { value: 600, configurable: true });
    const { container } = screenOf();
    expect(screen.queryByRole("separator")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show test list" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".tside")).toHaveClass("is-open");
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    fireEvent.click(container.querySelector(".tside-scrim") as HTMLElement);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Close list" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole("button", { name: /^Test t1/ }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(screen.queryByRole("button", { name: "Show test list" })).toBeNull();
    expect(container.querySelector(".tside")).not.toHaveClass("is-open");
  });
});
