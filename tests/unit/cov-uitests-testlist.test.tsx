// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { addRecent } from "../../src/ui/lib/recent.ts";
import { isKeyQuery, localTree, TestList } from "../../src/ui/screens/tests/TestList.tsx";
import { callsTo, deferred, Fail, server, stubServer } from "./cov-uitests-helpers.ts";
import { app } from "./ui-desktop-helpers.tsx";

const toasts: { kind: string; title: string; detail?: string }[] = [];
const errors: { e: unknown; title?: string }[] = [];
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return {
    ...real,
    toast: vi.fn((t: (typeof toasts)[number]) => toasts.push(t)),
    errorToast: vi.fn((e: unknown, title?: string) => errors.push({ e, title })),
  };
});

const ref = (o: Partial<LocalTestRef> & { id: string }): LocalTestRef => ({
  summary: o.id,
  folder: "/",
  review: "draft",
  generated: false,
  edited: false,
  sync: "local",
  dirty: false,
  synced: false,
  mtime: Date.now(),
  stepCount: 1,
  ...o,
});

const remote = (key: string, summary = key): RemoteTestRef => ({
  key,
  issueId: key,
  summary,
  status: "To Do",
  labels: [],
  folder: "/",
  stepCount: 1,
});

const refs: LocalTestRef[] = [
  ref({ id: "t-b", summary: "Bravo", folder: "/Lot/Sub", key: "LFRPS12-2", sync: "synced", synced: true }),
  ref({ id: "t-a", summary: "Alpha", folder: "/Lot" }),
  ref({ id: "t-z", summary: "", folder: "" }),
  ref({ id: "t-c", summary: "Charlie", folder: "/Autre" }),
];

const tree: Folder = {
  name: "/",
  path: "/",
  testsCount: 1,
  totalCount: 3,
  folders: [
    {
      name: "Lot",
      path: "/Lot",
      testsCount: 2,
      totalCount: 2,
      folders: [{ name: "Deep", path: "/Lot/Deep", testsCount: 1, totalCount: 1, folders: [] }],
    },
  ],
};

type Props = ComponentProps<typeof TestList>;

type Jira = { jiraProject?: string; jiraOffline?: boolean };

const stateOf = (jira: Jira = {}) => {
  const s = app();
  return { ...s, info: { ...s.info, project: { ...s.info?.project, ...jira } } as AppState["info"] };
};

const list = (o: Partial<Props> & { reload?: LocalTestRef[]; jira?: Jira } = {}) => {
  const onOpen = vi.fn();
  const onReload = vi.fn(async () => o.reload ?? o.refs ?? refs);
  const state = stateOf(o.jira);
  const tree = (s: AppState) => (
    <AppContext.Provider value={s}>
      <TestList refs={refs} loading={false} activeId="" onOpen={onOpen} onReload={onReload} {...o} />
    </AppContext.Provider>
  );
  const r = render(tree(state));
  return { ...r, onOpen, onReload, state, again: (jira: Jira) => r.rerender(tree(stateOf(jira))) };
};

const toJira = () => fireEvent.click(screen.getByRole("tab", { name: /Jira/ }));
const search = (v: string) => fireEvent.change(screen.getByLabelText("Filter tests"), { target: { value: v } });
const jira = (v: string) => fireEvent.change(screen.getByLabelText("Search Jira"), { target: { value: v } });

beforeEach(() => {
  stubServer();
  server.routes["xray.folders"] = () => tree;
  server.routes["xray.search"] = () => ({ tests: [], total: 0 });
  server.routes["jobs.list"] = () => [];
  toasts.length = 0;
  errors.length = 0;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
  delete window.testimusDesktop;
});

describe("TestList helpers", () => {
  it("nests tests by folder, counts and sorts them", () => {
    const root = localTree(refs);
    expect(root.total).toBe(4);
    expect(root.tests.map((t) => t.id)).toEqual(["t-z"]);
    expect(root.folders.map((f) => [f.name, f.total])).toEqual([
      ["Autre", 1],
      ["Lot", 2],
    ]);
    expect(root.folders[1].folders[0]).toMatchObject({ name: "Sub", path: "/Lot/Sub", total: 1 });
  });

  it("lists hand-made tests and validated generated ones; the rest waits on the Review tab", () => {
    const mixed = [
      ref({ id: "hand", summary: "Hand draft" }),
      ref({ id: "gen-ok", summary: "Generated validated", generated: true, review: "validated" }),
      ref({ id: "gen-wait", summary: "Generated checked", generated: true, review: "checked" }),
    ];
    const { state } = list({ refs: mixed });
    expect(screen.getByRole("button", { name: /^Hand draft/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Generated validated/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generated checked/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Local 2" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Review 1" }));
    expect(state.navigate).toHaveBeenCalledWith("review");
    cleanup();
    const { state: s2 } = list({ refs: [mixed[2]] });
    expect(screen.getByText(/1 generated test waiting for review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Review" }));
    expect(s2.navigate).toHaveBeenCalledWith("review");
  });

  it("knows a key or a bare number is a Jira question", () => {
    expect(isKeyQuery("LFRPS12-12")).toBe(true);
    expect(isKeyQuery(" 42 ")).toBe(true);
    expect(isKeyQuery("sectionneur")).toBe(false);
  });
});

describe("TestList › local", () => {
  it("shows a skeleton while loading and a hint when there is no test", async () => {
    list({ refs: [], loading: true });
    expect(screen.getByRole("status", { name: "Loading tests" })).toBeInTheDocument();
    cleanup();
    list({ refs: [] });
    expect(screen.getByText(/No tests yet/)).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Jira 3" })).toBeInTheDocument();
  });

  it("draws the tree, opens a test, folds a folder and filters", () => {
    const { onOpen } = list({ activeId: "t-a", loading: true });
    expect(screen.getByRole("tab", { name: "Local 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Alpha/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /^Untitled/ })).toHaveTextContent("no key");
    fireEvent.click(screen.getByRole("button", { name: /^Bravo/ }));
    expect(onOpen).toHaveBeenCalledWith("t-b");
    const lot = screen.getByRole("button", { name: /^Lot/ });
    fireEvent.click(lot);
    expect(lot).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Alpha/ })).toBeNull();
    search("bravo");
    expect(screen.getByRole("button", { name: /^Bravo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Charlie/ })).toBeNull();
    search("");
    fireEvent.click(screen.getByRole("button", { name: /^Lot/ }));
    expect(screen.getByRole("button", { name: /^Alpha/ })).toBeInTheDocument();
    search("nothing");
    expect(screen.getByText("No local test matches “nothing”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search Jira for “nothing”" }));
    expect(screen.getByRole("tab", { name: /Jira/ })).toHaveAttribute("aria-selected", "true");
  });

  it("goes to Jira at once for anything typed in « Search Jira »", () => {
    list();
    jira("LFRPS12-9");
    expect(screen.getByRole("tab", { name: /Jira/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Filter tests")).toHaveAttribute("placeholder", "Filter folders and listed tests");
  });

  it("creates a test in the open test's folder, or at the root", async () => {
    server.routes["tests.create"] = () => ({ id: "t-new" });
    const { onOpen, onReload } = list({ activeId: "t-a" });
    const create = screen.getByRole("button", { name: "New test" });
    expect(create).toHaveAttribute("title", "New local test in /Lot");
    fireEvent.click(create);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("t-new"));
    expect(onReload).toHaveBeenCalled();
    expect(callsTo("tests.create")[0].input).toEqual({ folder: "/Lot", summary: "New test" });
    cleanup();
    list();
    fireEvent.click(screen.getByRole("button", { name: "New test" }));
    await waitFor(() => expect(callsTo("tests.create")).toHaveLength(2));
    expect(callsTo("tests.create")[1].input.folder).toBe("/");
  });

  it("reports a failed create and a failed clone", async () => {
    server.routes["tests.create"] = () => {
      throw new Fail("disk full");
    };
    server.routes["tests.clone"] = () => {
      throw new Fail("gone");
    };
    list({ activeId: "t-a" });
    fireEvent.click(screen.getByRole("button", { name: "New test" }));
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    await waitFor(() => expect(errors).toHaveLength(2));
    expect(errors.map((e) => e.title).sort()).toEqual(["Could not clone the test", "Could not create the test"]);
  });

  it("clones the open test and opens the copy; Clone is off with no test open", async () => {
    server.routes["tests.clone"] = () => ({ id: "t-copy" });
    const { onOpen } = list({ activeId: "t-a" });
    fireEvent.click(screen.getByRole("button", { name: "Clone" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("t-copy"));
    expect(callsTo("tests.clone")[0].input).toEqual({ id: "t-a" });
    cleanup();
    list();
    expect(screen.getByRole("button", { name: "Clone" })).toBeDisabled();
  });

  it("pulls the open test, asking first when it has local changes", async () => {
    const gate = deferred<unknown>();
    server.routes["xray.pull"] = () => gate.promise;
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const dirty = refs.map((r) => (r.id === "t-b" ? { ...r, dirty: true } : r));
    const { onReload } = list({ refs: dirty, activeId: "t-b" });
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    expect(confirm).toHaveBeenCalled();
    expect(callsTo("xray.pull")).toHaveLength(0);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled());
    gate.resolve({ pulled: ["LFRPS12-2"], skipped: [], failed: [] });
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(callsTo("xray.pull")[0].input).toEqual({ key: "LFRPS12-2", overwrite: true });
    await waitFor(() => expect(toasts.at(-1)).toMatchObject({ kind: "ok", title: "1 test pulled" }));
    expect(screen.getByRole("button", { name: "Pull" })).toBeEnabled();
  });

  it("sends a never-pushed test to the Jira tab to pick a folder", () => {
    list({ activeId: "t-a" });
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    expect(screen.getByRole("tab", { name: /Jira/ })).toHaveAttribute("aria-selected", "true");
    expect(toasts[0]).toMatchObject({ title: "Pick a folder or a test in Jira" });
  });

  it("disables Show in Explorer without a project, and reveals the test.md with one", () => {
    const reveal = vi.fn(async () => true);
    window.testimusDesktop = { reveal } as never;
    list({ activeId: "t-a" });
    expect(screen.getByRole("button", { name: "Show the test in Explorer" })).toBeDisabled();
    cleanup();
    setProject("C:\\p");
    list({ activeId: "t-a" });
    fireEvent.click(screen.getByRole("button", { name: "Show the test in Explorer" }));
    expect(reveal).toHaveBeenCalledWith("C:\\p\\tests\\t-a\\test.md");
  });

  it("closes the drawer", () => {
    const onCloseDrawer = vi.fn();
    const { container } = list({ open: true, onCloseDrawer });
    expect(container.querySelector(".tside")).toHaveClass("is-open");
    fireEvent.click(screen.getByRole("button", { name: "Close list" }));
    expect(onCloseDrawer).toHaveBeenCalled();
  });

  it("shows and hides the recent tests, remembering the choice", () => {
    addRecent("t-a");
    list();
    expect(screen.getByRole("region", { name: "Recent tests" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Recent tests" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "Recent tests" })).toBeNull();
    expect(localStorage.getItem("testimus.showRecent")).toBe("0");
    fireEvent.click(toggle);
    expect(localStorage.getItem("testimus.showRecent")).toBe("1");
  });
});

describe("TestList › delete", () => {
  it("deletes a pushed, unchanged copy without asking", async () => {
    server.routes["tests.remove"] = () => ({});
    const onDeleted = vi.fn();
    list({ onDeleted });
    fireEvent.click(screen.getByRole("button", { name: "Delete the local copy of LFRPS12-2" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("t-b"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reloads after a delete when nobody listens, and does nothing when it failed", async () => {
    server.routes["tests.remove"] = () => ({});
    const { onReload } = list();
    fireEvent.click(screen.getByRole("button", { name: "Delete the local copy of LFRPS12-2" }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    server.routes["tests.remove"] = () => {
      throw new Fail("locked");
    };
    onReload.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Delete the local copy of LFRPS12-2" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not delete the local copy"));
    expect(onReload).not.toHaveBeenCalled();
  });

  it("asks before deleting the only copy, and can cancel", async () => {
    server.routes["tests.remove"] = () => ({});
    const onDeleted = vi.fn();
    list({ onDeleted });
    fireEvent.click(screen.getByRole("button", { name: "Delete the local copy of Alpha" }));
    expect(screen.getByRole("dialog", { name: "Delete the local copy?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete the local copy of t-z" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete local copy" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("t-z"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TestList › Jira", () => {
  it("shows the tree count, or none when Jira cannot be reached", async () => {
    server.routes["xray.folders"] = () => {
      throw new Fail("401 Unauthorized");
    };
    list();
    toJira();
    expect(await screen.findByText("401 Unauthorized")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Jira" })).toBeInTheDocument();
  });

  it("shows a non-Error failure of the tree as text and ignores a tree that lands after closing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("socket closed")),
    );
    list();
    toJira();
    expect(await screen.findByText("socket closed")).toBeInTheDocument();
    cleanup();
    stubServer();
    const late = deferred<Folder>();
    server.routes["xray.folders"] = () => late.promise;
    const { unmount } = list();
    unmount();
    late.resolve(tree);
    const lateFail = deferred<Folder>();
    server.routes["xray.folders"] = () => lateFail.promise;
    list().unmount();
    lateFail.reject(new Fail("late"));
    await new Promise((r) => setTimeout(r, 20));
  });

  it("picks folders, folds the open one, and creates new tests in the picked folder", async () => {
    server.routes["tests.create"] = () => ({ id: "t-new" });
    const { onOpen } = list();
    toJira();
    const lot = await screen.findByRole("button", { name: /^Lot/ });
    fireEvent.click(lot);
    expect(lot).toHaveAttribute("aria-expanded", "true");
    expect(lot).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "New test" })).toHaveAttribute("title", "New local test in /Lot");
    fireEvent.click(lot);
    expect(lot).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: /^Test Repository/ }));
    fireEvent.click(lot);
    expect(lot).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(await screen.findByRole("button", { name: "New local test" }));
    await waitFor(() => expect(callsTo("tests.create")).toHaveLength(1));
    expect(callsTo("tests.create")[0].input).toEqual({ folder: "/Lot", summary: "New test" });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("t-new"));
  });

  it("picking a folder found by a search clears it and opens the path to it", async () => {
    list();
    toJira();
    search("deep");
    const deep = await screen.findByRole("button", { name: /^Deep/ });
    fireEvent.click(deep);
    expect(screen.getByLabelText("Filter tests")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Lot/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Deep/ })).toHaveAttribute("aria-current", "true");
  });

  it("opens a local copy, hands a new key to the pull queue, or pulls it itself", async () => {
    server.routes["xray.search"] = () => ({
      tests: [remote("LFRPS12-2", "Bravo remote"), remote("LFRPS12-9", "Nine")],
      total: 2,
    });
    const onPull = vi.fn();
    const { onOpen } = list({ onPull, pulling: ["LFRPS12-9"] });
    toJira();
    fireEvent.click(await screen.findByRole("button", { name: /^Bravo remote/ }));
    expect(onOpen).toHaveBeenCalledWith("t-b");
    const nine = screen.getByRole("button", { name: /^Nine/ });
    expect(nine).toHaveTextContent("pulling…");
    fireEvent.click(nine);
    expect(onPull).toHaveBeenCalledWith("LFRPS12-9", "Nine");
    cleanup();
    server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-9"] });
    const own = list();
    toJira();
    fireEvent.click(await screen.findByRole("button", { name: /^Nine/ }));
    await waitFor(() => expect(own.onReload).toHaveBeenCalled());
    expect(callsTo("xray.pull")[0].input).toEqual({ key: "LFRPS12-9" });
    expect(own.onOpen).not.toHaveBeenCalled();
  });

  it("pulls a whole folder and reports pulled, skipped and failed tests", async () => {
    const gate = deferred<unknown>();
    server.routes["xray.pull"] = () => gate.promise;
    list();
    toJira();
    const pullLot = await screen.findByRole("button", { name: "Pull every test of /Lot" });
    fireEvent.click(pullLot);
    await waitFor(() => expect(pullLot).toBeDisabled());
    gate.resolve({
      pulled: ["A", "B"],
      skipped: [{ key: "C", reason: "Local changes" }],
      failed: [{ key: "D", error: "403" }],
    });
    await waitFor(() => expect(toasts.some((t) => t.title === "2 tests pulled")).toBe(true));
    expect(callsTo("xray.pull")[0].input).toEqual({ folder: "/Lot" });
    expect(errors.at(-1)?.title).toBe("Some tests failed to pull");
    expect((errors.at(-1)!.e as Error).message).toBe("D: 403");
    expect(toasts.find((t) => t.title === "1 test skipped")?.detail).toBe("Local changes");
    expect(pullLot).toBeEnabled();
  });

  it("reports nothing for an empty answer and an error for a failed pull", async () => {
    server.routes["xray.pull"] = () => undefined;
    const { onReload } = list();
    toJira();
    fireEvent.click(await screen.findByRole("button", { name: "Pull every test of /Lot" }));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(toasts).toEqual([]);
    server.routes["xray.pull"] = () => {
      throw new Fail("Jira down");
    };
    fireEvent.click(screen.getByRole("button", { name: "Pull every test of /Lot" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not pull /Lot"));
  });
});

describe("TestList › Jira connection", () => {
  it("asks for a key when none is set, and asks Jira nothing", async () => {
    list({ jira: { jiraProject: "" } });
    expect(screen.queryByLabelText("Search Jira")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
    search("Alpha");
    expect(screen.queryByText(/Search Jira for/)).toBeNull();
    toJira();
    expect(screen.getByRole("heading", { name: "Connect to Jira" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter tests")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    await new Promise((r) => setTimeout(r, 10));
    expect(callsTo("xray.folders")).toHaveLength(0);
  });

  it("connects a key once Jira accepts it, and says why it refused one", async () => {
    let answer: unknown = new Fail("Jira 404 — project NOPE not found");
    server.routes["xray.connect"] = () => {
      if (answer instanceof Error) throw answer;
      return answer;
    };
    const { state, again } = list({ jira: { jiraProject: "" } });
    toJira();
    const box = screen.getByLabelText("Jira project key");
    fireEvent.change(box, { target: { value: "nope" } });
    expect(box).toHaveValue("NOPE");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Jira 404 — project NOPE not found");
    expect(state.refreshInfo).not.toHaveBeenCalled();
    answer = { jiraProject: "LFRPS12", name: "RATP" };
    fireEvent.change(box, { target: { value: "lfrps12" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(callsTo("xray.connect").at(-1)?.input).toEqual({ key: "LFRPS12" });
    again({ jiraProject: "LFRPS12" });
    expect(await screen.findByText("Connected to")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Lot/ })).toBeInTheDocument();
  });

  it("offers the Jira access setup when the credentials are missing", async () => {
    server.routes["xray.connect"] = () => {
      throw new Fail("Missing ~/.atlassian/credentials.json.");
    };
    const { state } = list({ jira: { jiraProject: "" } });
    toJira();
    fireEvent.change(screen.getByLabelText("Jira project key"), { target: { value: "LFRPS12" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up Jira access" }));
    expect(state.navigate).toHaveBeenCalledWith("setup");
  });

  it("disconnects, then shows the project as worked on locally until a reconnect", async () => {
    server.routes["xray.disconnect"] = () => ({ jiraProject: "LFRPS12" });
    const { state, again } = list();
    toJira();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(toasts.at(-1)?.title).toBe("Working locally");
    const folders = callsTo("xray.folders").length;
    again({ jiraProject: "LFRPS12", jiraOffline: true });
    expect(screen.getByRole("heading", { name: "Working locally" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Jira off/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Jira project key")).toHaveValue("LFRPS12");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled();
    expect(callsTo("xray.folders")).toHaveLength(folders);
  });

  it("reports a failed disconnect", async () => {
    server.routes["xray.disconnect"] = () => {
      throw new Fail("disk full");
    };
    list();
    toJira();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not disconnect Jira"));
  });

  it("lets a project Jira cannot reach go local", async () => {
    server.routes["xray.folders"] = () => {
      throw new Fail("Jira 401 — check ~/.atlassian/credentials.json");
    };
    server.routes["xray.disconnect"] = () => ({ jiraProject: "LFRPS12" });
    const { state } = list();
    toJira();
    expect(await screen.findByRole("heading", { name: "Jira could not be reached" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Work locally for now" }));
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    expect(callsTo("xray.disconnect")).toHaveLength(1);
  });
});
