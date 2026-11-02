// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Folder, LocalTestRef, RemoteTestRef } from "../../src/core/types.ts";
import { findFolder, folderName, JiraTab, statusTone } from "../../src/ui/screens/tests/JiraTab.tsx";
import { callsTo, deferred, Fail, server, stubServer } from "./cov-uitests-helpers.ts";

const errors: { title?: string }[] = [];
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return { ...real, errorToast: vi.fn((_e: unknown, title?: string) => errors.push({ title })) };
});

class FakeIO {
  static last: FakeIO | null = null;
  cb: (e: { isIntersecting: boolean }[]) => void;
  disconnect = vi.fn();
  constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
    this.cb = cb;
    FakeIO.last = this;
  }
  observe() {}
}

const remote = (key: string, o: Partial<RemoteTestRef> = {}): RemoteTestRef => ({
  key,
  issueId: key,
  summary: `Summary ${key}`,
  status: "",
  labels: [],
  folder: "/",
  stepCount: 2,
  ...o,
});

const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => remote(`K-${from + i}`));

const tree: Folder = {
  name: "/",
  path: "/",
  testsCount: 2,
  totalCount: 5,
  folders: [
    {
      name: "Lot",
      path: "/Lot",
      testsCount: 1,
      totalCount: 3,
      folders: [{ name: "Sub", path: "/Lot/Sub", testsCount: 2, totalCount: 2, folders: [] }],
    },
    { name: "Empty", path: "/Empty", testsCount: 0, totalCount: 0, folders: [] },
  ],
};

const local: LocalTestRef = {
  id: "t1",
  key: "K-1",
  summary: "Local one",
  folder: "/",
  review: "draft",
  sync: "modified",
  dirty: true,
  synced: true,
  mtime: 0,
  stepCount: 2,
};

type Props = ComponentProps<typeof JiraTab>;

const tab = (over: Partial<Props> = {}) => {
  const h = { onPickFolder: vi.fn(), onOpenRemote: vi.fn(), onPullFolder: vi.fn(), onNew: vi.fn() };
  const props: Props = {
    tree,
    treeError: "",
    query: "",
    folder: "/",
    expanded: new Set(["/"]),
    refs: [local],
    activeId: "",
    pulling: [],
    busyFolders: [],
    ...h,
    ...over,
  };
  const r = render(<JiraTab {...props} />);
  return { ...r, ...h, props, again: (o: Partial<Props>) => r.rerender(<JiraTab {...props} {...o} />) };
};

beforeEach(() => {
  stubServer();
  errors.length = 0;
  FakeIO.last = null;
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JiraTab helpers", () => {
  it("tones statuses, names the root and finds folders", () => {
    expect(statusTone("Done")).toBe("ok");
    expect(statusTone("In Progress")).toBe("warn");
    expect(statusTone("To Do")).toBe("neutral");
    expect(folderName("/")).toBe("Test Repository");
    expect(folderName("/Lot")).toBe("/Lot");
    expect(findFolder(tree, "/Lot/Sub")?.name).toBe("Sub");
    expect(findFolder(tree, "/Nope")).toBeNull();
    expect(findFolder(null, "/")).toBeNull();
  });
});

describe("JiraTab tree", () => {
  it("says when Jira cannot be reached, and shows a skeleton while the tree loads", () => {
    const { again } = tab({ tree: null, treeError: "401 Unauthorized" });
    expect(screen.getByText("Jira could not be reached.")).toBeInTheDocument();
    expect(screen.getByText("401 Unauthorized")).toBeInTheDocument();
    again({ tree: null, treeError: "" });
    expect(screen.getByRole("status", { name: "Loading folders" })).toBeInTheDocument();
    expect(callsTo("xray.search")).toHaveLength(0);
  });

  it("draws the open folders with their counts, picks one and pulls one", async () => {
    server.routes["xray.search"] = () => ({ tests: [], total: 0 });
    const { onPickFolder, onPullFolder, again } = tab({ busyFolders: ["/Lot"] });
    const root = screen.getByRole("button", { name: /^Test Repository/ });
    expect(root).toHaveAttribute("aria-expanded", "true");
    expect(root).toHaveAttribute("aria-current", "true");
    expect(root).toHaveTextContent("2/5");
    const lot = screen.getByRole("button", { name: /^Lot/ });
    expect(lot).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^Sub/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Empty/ })).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByRole("button", { name: "Pull every test of /Empty" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pull every test of /Lot" })).toBeDisabled();
    fireEvent.click(lot);
    expect(onPickFolder).toHaveBeenCalledWith("/Lot");
    fireEvent.click(screen.getByRole("button", { name: "Pull every test of Test Repository" }));
    expect(onPullFolder).toHaveBeenCalledWith("/");
    again({ expanded: new Set(["/", "/Lot"]), folder: "/Lot/Sub" });
    expect(screen.getByRole("button", { name: /^Sub/ })).toHaveTextContent("2");
    await waitFor(() => expect(callsTo("xray.search").length).toBeGreaterThan(0));
  });

  it("filters folders by name with the filter box, flat and without the root (a Jira search leaves them alone)", () => {
    server.routes["xray.search"] = () => new Promise(() => {});
    tab({ filter: "sub" });
    expect(screen.getByRole("button", { name: /^Sub/ })).toHaveAttribute("title", "/Lot/Sub");
    expect(screen.queryByRole("button", { name: /^Test Repository/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Lot/ })).toBeNull();
  });
});

describe("JiraTab list", () => {
  it("lists the folder's tests with their local state, status and pull state", async () => {
    server.routes["xray.search"] = () => ({
      tests: [
        remote("K-1", { status: "Done" }),
        remote("K-2", { status: "In review" }),
        remote("K-3", { stepCount: 1 }),
      ],
      total: 3,
    });
    const { onOpenRemote } = tab({ activeId: "t1", pulling: ["K-2"] });
    expect(screen.getByRole("status", { name: "Loading tests in Test Repository" })).toBeInTheDocument();
    const one = await screen.findByRole("button", { name: /Summary K-1/ });
    expect(callsTo("xray.search")[0].input).toEqual({ folder: "/", page: 0 });
    expect(one).toHaveAttribute("aria-current", "true");
    expect(one).toHaveTextContent("Modified");
    expect(one).not.toHaveAttribute("title");
    const two = screen.getByRole("button", { name: /Summary K-2/ });
    expect(two).toHaveAttribute("title", "Being pulled now");
    expect(two).toHaveTextContent("pulling…");
    const three = screen.getByRole("button", { name: /Summary K-3/ });
    expect(three).toHaveAttribute("title", "Not pulled yet — opening it downloads it into the project");
    expect(three).toHaveTextContent("1 step");
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    fireEvent.click(three);
    expect(onOpenRemote).toHaveBeenCalledWith(expect.objectContaining({ key: "K-3" }));
  });

  it("marks a remote row open by its key while it is being pulled", async () => {
    server.routes["xray.search"] = () => ({ tests: [remote("K-9")] });
    tab({ activeId: "K-9", refs: [] });
    expect(await screen.findByRole("button", { name: /Summary K-9/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("never asks for an empty folder and offers a new local test", () => {
    const { onNew } = tab({ folder: "/Empty" });
    expect(screen.getByText("No tests in this folder")).toBeInTheDocument();
    expect(screen.getByText("/Empty is empty. Pick another folder, or create a test locally.")).toBeInTheDocument();
    expect(document.querySelector(".jlist-range")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "New local test" }));
    expect(onNew).toHaveBeenCalled();
    expect(callsTo("xray.search")).toHaveLength(0);
  });

  it("says when a folder answer is empty", async () => {
    server.routes["xray.search"] = () => null;
    tab({ folder: "/Lot" });
    expect(await screen.findByText("No tests in this folder")).toBeInTheDocument();
  });

  it("loads the next slices as the end of the list shows, once at a time, and says when all are in", async () => {
    const pages: Record<number, RemoteTestRef[]> = { 0: many(0, 100), 1: many(100, 50) };
    const slow = deferred<unknown>();
    server.routes["xray.search"] = async (input) => {
      if (input.page === 1) await slow.promise;
      return { tests: pages[input.page as number], total: 150 };
    };
    tab();
    await screen.findByText("100 of 150");
    expect(screen.getByRole("status", { name: "Loading more tests in Test Repository" })).toBeInTheDocument();
    const io = FakeIO.last as FakeIO;
    act(() => io.cb([{ isIntersecting: false }]));
    act(() => io.cb([{ isIntersecting: true }]));
    act(() => io.cb([{ isIntersecting: true }]));
    slow.resolve(null);
    await screen.findByText("150 of 150");
    expect(callsTo("xray.search").map((c) => c.input.page)).toEqual([0, 1]);
    expect(screen.getByText(/all 150 loaded/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /Loading more/ })).toBeNull();
  });

  it("asks a failed slice again on the next intersection and keeps what it has", async () => {
    let fail = true;
    server.routes["xray.search"] = (input) => {
      if (input.page === 1 && fail) throw new Fail("timeout");
      return { tests: input.page ? many(100, 4) : many(0, 100), total: 104 };
    };
    tab({ folder: "/Lot" });
    await screen.findByText("100 of 104");
    act(() => FakeIO.last?.cb([{ isIntersecting: true }]));
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not list /Lot"));
    expect(screen.getByText("100 of 104")).toBeInTheDocument();
    fail = false;
    act(() => FakeIO.last?.cb([{ isIntersecting: true }]));
    await screen.findByText("104 of 104");
  });

  it("empties the list when the first slice fails", async () => {
    server.routes["xray.search"] = () => {
      throw new Fail("timeout");
    };
    tab();
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Could not list Test Repository"));
    expect(await screen.findByText("No tests in this folder")).toBeInTheDocument();
  });

  it("drops an answer for a folder it no longer shows", async () => {
    const first = deferred<unknown>();
    const firstFail = deferred<unknown>();
    server.routes["xray.search"] = (input) =>
      input.folder === "/"
        ? first.promise
        : input.folder === "/Lot"
          ? firstFail.promise
          : { tests: many(50, 1), total: 1 };
    const { again } = tab();
    await waitFor(() => expect(callsTo("xray.search")).toHaveLength(1));
    again({ folder: "/Lot" });
    await waitFor(() => expect(callsTo("xray.search")).toHaveLength(2));
    again({ folder: "/Lot/Sub" });
    await screen.findByText("1 of 1");
    first.resolve({ tests: many(0, 3), total: 3 });
    firstFail.reject(new Fail("late"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(errors).toEqual([]);
  });

  it("works without IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    server.routes["xray.search"] = () => ({ tests: many(0, 2), total: 9 });
    tab();
    expect(await screen.findByText("2 of 9")).toBeInTheDocument();
  });

  it("searches Jira after a pause, with or without a tree", async () => {
    server.routes["xray.search"] = (input) => (input.text === "nine" ? { tests: [remote("K-9")], total: 99 } : {});
    const { again } = tab({ tree: null, query: "nine" });
    expect(screen.getByRole("status", { name: "Searching Jira for nine" })).toBeInTheDocument();
    expect(screen.getByText("search “nine”")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Summary K-9/ }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText("1 found")).toBeInTheDocument();
    expect(callsTo("xray.search")[0].input).toEqual({ text: "nine" });
    again({ tree: null, query: "zzz" });
    expect(await screen.findByText("Nothing in Jira matches “zzz”.", undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it("reports a failed search", async () => {
    server.routes["xray.search"] = () => {
      throw new Fail("bad JQL");
    };
    tab({ query: "x" });
    await waitFor(() => expect(errors.at(-1)?.title).toBe("Jira search failed"), { timeout: 2000 });
  });
});
