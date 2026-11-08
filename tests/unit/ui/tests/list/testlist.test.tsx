// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, LocalTestRef, RemoteTestRef, Test } from "../../../../../src/core/types.ts";
import { setProject } from "../../../../../src/ui/api.ts";
import { AppContext, type AppState } from "../../../../../src/ui/lib/app.ts";
import { isKeyQuery, localTree, TestList } from "../../../../../src/ui/screens/tests/TestList.tsx";
import { iconOf, iconsIn } from "../../../helpers/icons.ts";
import { app } from "../../../helpers/ui-desktop.tsx";
import { callsTo, deferred, Fail, server, stubServer } from "../../../helpers/ui-server.ts";
import { testClient, WithData } from "../data-helpers.tsx";

const toasts: { kind: string; title: string; detail?: string }[] = [];
const errors: { e: unknown; title?: string }[] = [];
vi.mock("../../../../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/toast.ts")>();
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
  const client = testClient();
  const tree = (s: AppState) => (
    <WithData client={client}>
      <AppContext.Provider value={s}>
        <TestList refs={refs} loading={false} activeId="" onOpen={onOpen} onReload={onReload} {...o} />
      </AppContext.Provider>
    </WithData>
  );
  const r = render(tree(state));
  return { ...r, onOpen, onReload, state, again: (jira: Jira) => r.rerender(tree(stateOf(jira))) };
};

const toJira = () => fireEvent.click(screen.getByRole("tab", { name: /Jira/ }));
const item = (name: string | RegExp) => screen.getByRole("treeitem", { name });
const rowAction = (row: HTMLElement, name: string) => {
  fireEvent.focus(row);
  return within(row).getByRole("button", { name });
};
const localRow = (name: string | RegExp) =>
  screen
    .getAllByRole("treeitem")
    .find((r) =>
      typeof name === "string" ? r.textContent?.startsWith(name) : name.test(r.textContent ?? ""),
    ) as HTMLElement;
const tipOf = (el: HTMLElement) => el.closest("span")?.querySelector('[role="tooltip"]')?.textContent;
const search = (v: string) => fireEvent.change(screen.getByLabelText("Filter tests"), { target: { value: v } });
const jira = (v: string) => fireEvent.change(screen.getByLabelText("Search Jira"), { target: { value: v } });

let seq = 0;

// ponytail: the file behind a row — the delete and the pull read it again (what is lost comes from the file, not the
// list); a dirty row's file differs from its last sync
const fileOf = (r: LocalTestRef, dirty = r.dirty): { test: Test; remote: Test | null } => {
  const t: Test = {
    key: r.key,
    project: "LFRPS12",
    summary: r.summary,
    folder: r.folder,
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: r.review,
    steps: [{ fields: { Action: "One" }, sources: [], images: [] }],
    extra: {},
  };
  return { test: t, remote: r.synced ? { ...t, summary: dirty ? `${r.summary} (Jira)` : r.summary } : null };
};
let files: LocalTestRef[] = refs;

beforeEach(() => {
  stubServer();
  // ponytail: the list's view (tab, boxes, folds) is kept per project for the page's life — each case its own project
  setProject(`C:\\list-${++seq}`);
  files = refs;
  server.routes["tests.show"] = (input) => fileOf(files.find((r) => r.id === input.id) ?? refs[0]);
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

  it("lists hand-made tests and validated generated ones; the rest waits in Review", () => {
    const mixed = [
      ref({ id: "hand", summary: "Hand draft" }),
      ref({ id: "gen-ok", summary: "Generated validated", generated: true, review: "validated" }),
      { ...ref({ id: "gen-wait", summary: "Generated checked", generated: true, review: "draft" }), awaiting: true },
    ];
    const { state } = list({ refs: mixed });
    expect(item(/^Hand draft/)).toBeInTheDocument();
    expect(item(/^Generated validated/)).toBeInTheDocument();
    expect(iconOf(within(item(/^Generated validated/)).getByText("Generated"))).toBe("claude");
    expect(screen.queryByRole("treeitem", { name: /Generated checked/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /^Local ?2$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /Review/ })).toBeNull();
    const waits = screen.getByText("1 new test waits for review").closest('[role="status"]') as HTMLElement;
    expect(iconsIn(waits)).toContain("eye");
    fireEvent.click(within(waits).getByRole("button", { name: "Review" }));
    expect(state.navigate).toHaveBeenCalledWith("review");
    cleanup();
    list({ refs: [...mixed, { ...mixed[2], id: "gen-wait-2" }] });
    expect(screen.getByText("2 new tests wait for review")).toBeInTheDocument();
    cleanup();
    list({ refs: mixed.slice(0, 2) });
    expect(screen.queryByText(/wait for review|waits for review/)).toBeNull();
    cleanup();
    const { state: s2 } = list({ refs: [mixed[2]] });
    expect(screen.getByText(/1 generated test waiting for review/)).toBeInTheDocument();
    expect(iconOf(screen.getByRole("button", { name: "Review them" }))).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Review them" }));
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
    expect(screen.getByText(/No test yet/)).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /^Jira ?3$/ })).toBeInTheDocument();
  });

  it("draws the tree, opens a test, folds a folder and filters", () => {
    const { onOpen } = list({ activeId: "t-a", loading: true });
    expect(screen.getByRole("tab", { name: /^Local ?4$/ })).toBeInTheDocument();
    expect(item(/^Alpha/)).toHaveAttribute("aria-selected", "true");
    expect(item(/^Untitled/)).toHaveTextContent("no key");
    fireEvent.click(item(/^Bravo/));
    expect(onOpen).toHaveBeenCalledWith("t-b");
    expect(iconsIn(item(/^Lot/)).slice(0, 2)).toEqual(["chevron-down", "folder-open"]);
    fireEvent.click(item(/^Lot/));
    expect(item(/^Lot/)).toHaveAttribute("aria-expanded", "false");
    expect(iconsIn(item(/^Lot/)).slice(0, 2)).toEqual(["chevron-right", "folder"]);
    expect(screen.queryByRole("treeitem", { name: /^Alpha/ })).toBeNull();
    search("bravo");
    expect(item(/^Bravo/)).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /^Charlie/ })).toBeNull();
    search("");
    fireEvent.click(item(/^Lot/));
    expect(item(/^Alpha/)).toBeInTheDocument();
    search("nothing");
    expect(screen.getByText("No local test matches “nothing”.")).toBeInTheDocument();
    expect(iconOf(screen.getByText("No local test matches “nothing”.").parentElement as HTMLElement)).toBe("filter");
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
    expect(tipOf(create)).toBe("New test in /Lot");
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
    const dirty = refs.map((r) => (r.id === "t-b" ? { ...r, dirty: true } : r));
    files = dirty;
    const { onReload } = list({ refs: dirty, activeId: "t-b" });
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    const ask = await screen.findByRole("alertdialog", { name: "Replace LFRPS12-2 with Jira's version?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(callsTo("xray.pull")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    const again = await screen.findByRole("alertdialog", { name: "Replace LFRPS12-2 with Jira's version?" });
    fireEvent.click(within(again).getByRole("button", { name: "Replace with Jira's version" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled());
    gate.resolve({ pulled: ["LFRPS12-2"], skipped: [], failed: [] });
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(callsTo("xray.pull")[0].input).toEqual({ key: "LFRPS12-2", overwrite: true });
    await waitFor(() =>
      expect(toasts.at(-1)).toMatchObject({ tone: "success", title: "LFRPS12-2 replaced with Jira's version" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Pull" })).toBeEnabled();
  });

  it("pulls an unchanged open test at once, and waits while Claude works on it", async () => {
    server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-2"], skipped: [], failed: [] });
    list({ activeId: "t-b" });
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    await waitFor(() => expect(callsTo("xray.pull")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    cleanup();
    const state = { ...stateOf(), claudeRunning: "t-b" };
    render(
      <WithData client={testClient()}>
        <AppContext.Provider value={state}>
          <TestList refs={refs} loading={false} activeId="t-b" onOpen={vi.fn()} onReload={vi.fn(async () => refs)} />
        </AppContext.Provider>
      </WithData>,
    );
    expect(screen.getByRole("button", { name: "Pull" })).toHaveAccessibleDescription(
      "Claude is editing this test — wait for it to finish",
    );
    expect(screen.getByRole("button", { name: "Clone" })).toHaveAccessibleDescription(
      "Claude is editing this test — wait for it to finish",
    );
    fireEvent.focus(localRow(/^Bravo/));
    expect(
      within(localRow(/^Bravo/)).getByRole("button", { name: "Delete the local copy of LFRPS12-2" }),
    ).toBeDisabled();
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
    setProject(null);
    list({ activeId: "t-a" });
    expect(screen.getByRole("button", { name: "Show the test in Explorer" })).toBeDisabled();
    cleanup();
    setProject("C:\\p");
    list({ activeId: "t-a" });
    fireEvent.click(screen.getByRole("button", { name: "Show the test in Explorer" }));
    expect(reveal).toHaveBeenCalledWith("C:\\p\\tests\\t-a\\test.md");
  });
});

describe("TestList › delete", () => {
  it("deletes a pushed, unchanged copy without asking", async () => {
    server.routes["tests.remove"] = () => ({});
    const onDeleted = vi.fn();
    list({ onDeleted });
    fireEvent.click(rowAction(localRow(/^Bravo/), "Delete the local copy of LFRPS12-2"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("t-b"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reloads after a delete when nobody listens, and does nothing when it failed", async () => {
    server.routes["tests.remove"] = () => ({});
    const { onReload } = list();
    fireEvent.click(rowAction(localRow(/^Bravo/), "Delete the local copy of LFRPS12-2"));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    server.routes["tests.remove"] = () => {
      throw new Fail("locked");
    };
    onReload.mockClear();
    fireEvent.click(rowAction(localRow(/^Bravo/), "Delete the local copy of LFRPS12-2"));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not delete the local copy"));
    expect(onReload).not.toHaveBeenCalled();
  });

  it("asks before deleting the only copy, and can cancel", async () => {
    server.routes["tests.remove"] = () => ({});
    const onDeleted = vi.fn();
    list({ onDeleted });
    fireEvent.click(rowAction(localRow(/^Alpha/), "Delete the local copy of Alpha"));
    expect(await screen.findByRole("alertdialog", { name: "Delete the local copy?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(rowAction(localRow(/^Untitled/), "Delete the local copy of Untitled test"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("t-z"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
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
    expect(iconsIn(await screen.findByRole("treeitem", { name: /^Lot/ })).slice(0, 2)).toEqual([
      "chevron-right",
      "folder",
    ]);
    fireEvent.click(await screen.findByRole("treeitem", { name: /^Lot/ }));
    expect(item(/^Lot/)).toHaveAttribute("aria-expanded", "true");
    expect(item(/^Lot/)).toHaveAttribute("aria-selected", "true");
    expect(iconsIn(item(/^Lot/)).slice(0, 2)).toEqual(["chevron-down", "folder-open"]);
    expect(tipOf(screen.getByRole("button", { name: "New test" }))).toBe("New test in /Lot");
    fireEvent.click(item(/^Lot/));
    expect(item(/^Lot/)).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(item(/^Test Repository/));
    fireEvent.click(item(/^Lot/));
    expect(item(/^Lot/)).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(await screen.findByRole("button", { name: "New test" }));
    await waitFor(() => expect(callsTo("tests.create")).toHaveLength(1));
    expect(callsTo("tests.create")[0].input).toEqual({ folder: "/Lot", summary: "New test" });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("t-new"));
  });

  it("picking a folder found by a search clears it and opens the path to it", async () => {
    list();
    toJira();
    search("deep");
    fireEvent.click(await screen.findByRole("treeitem", { name: /^Deep/ }));
    expect(screen.getByLabelText("Filter tests")).toHaveValue("");
    expect(item(/^Lot/)).toHaveAttribute("aria-expanded", "true");
    expect(item(/^Deep/)).toHaveAttribute("aria-selected", "true");
  });

  it("opens a local copy, hands a new key to the pull queue, or pulls it itself", async () => {
    server.routes["xray.search"] = () => ({
      tests: [remote("LFRPS12-2", "Bravo remote"), remote("LFRPS12-9", "Nine")],
      total: 2,
    });
    const onPull = vi.fn();
    const { onOpen } = list({ onPull, pulling: ["LFRPS12-9"] });
    toJira();
    fireEvent.click(await screen.findByRole("option", { name: /^Bravo remote/ }));
    expect(onOpen).toHaveBeenCalledWith("t-b");
    const nine = screen.getByRole("option", { name: /^Nine/ });
    expect(nine).toHaveTextContent("Pulling…");
    fireEvent.click(nine);
    expect(onPull).toHaveBeenCalledWith("LFRPS12-9", "Nine");
    cleanup();
    server.routes["xray.pull"] = () => ({ pulled: ["LFRPS12-9"] });
    const own = list();
    toJira();
    fireEvent.click(await screen.findByRole("option", { name: /^Nine/ }));
    await waitFor(() => expect(own.onReload).toHaveBeenCalled());
    expect(callsTo("xray.pull")[0].input).toEqual({ key: "LFRPS12-9" });
    expect(own.onOpen).not.toHaveBeenCalled();
  });

  it("pulls a whole folder and reports pulled, skipped and failed tests", async () => {
    const gate = deferred<unknown>();
    server.routes["xray.pull"] = () => gate.promise;
    list();
    toJira();
    const pullLot = rowAction(await screen.findByRole("treeitem", { name: /^Lot/ }), "Pull every test of /Lot");
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
    fireEvent.click(rowAction(await screen.findByRole("treeitem", { name: /^Lot/ }), "Pull every test of /Lot"));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(toasts).toEqual([]);
    server.routes["xray.pull"] = () => {
      throw new Fail("Jira down");
    };
    fireEvent.click(rowAction(item(/^Lot/), "Pull every test of /Lot"));
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
    expect(screen.getByRole("heading", { name: "Connect this project to Jira" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search Jira")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
    expect(screen.getByLabelText("Filter tests")).toBeInTheDocument();
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
    expect(await screen.findByText(/Connected to/)).toBeInTheDocument();
    expect(await screen.findByRole("treeitem", { name: /^Lot/ })).toBeInTheDocument();
  });

  it("offers the Jira access setup when the credentials are missing", async () => {
    server.routes["xray.connect"] = () => {
      throw new Fail("Missing ~/.atlassian/credentials.json.");
    };
    const { state } = list({ jira: { jiraProject: "" } });
    toJira();
    fireEvent.change(screen.getByLabelText("Jira project key"), { target: { value: "LFRPS12" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(iconOf(await screen.findByRole("button", { name: "Set up Jira access" }))).toBe("key");
    fireEvent.click(await screen.findByRole("button", { name: "Set up Jira access" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
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
    expect(toasts.at(-1)?.title).toBe("Working locally");
  });
});
