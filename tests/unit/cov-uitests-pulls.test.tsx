// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent, LocalTestRef } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { setDiscarder } from "../../src/ui/lib/editorBus.ts";
import { addRecent, recentIds } from "../../src/ui/lib/recent.ts";
import { DeleteTest, deleteTest, needsAsking } from "../../src/ui/screens/tests/DeleteTest.tsx";
import { PullPane } from "../../src/ui/screens/tests/PullPane.tsx";
import { RecentList } from "../../src/ui/screens/tests/RecentList.tsx";
import { deferred } from "./cov-uitests-helpers.ts";

type Job = {
  key: string;
  onEvent?: (e: JobEvent) => void;
  onStart?: (id: string) => void;
  done: ReturnType<typeof deferred<unknown>>;
};
const jobs: Job[] = [];
let calls: { name: string; input: Record<string, unknown> }[] = [];
let callResult: () => unknown = () => ({});

vi.mock("../../src/ui/api.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/api.ts")>();
  return {
    ...real,
    call: vi.fn(async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      return callResult();
    }),
    run: vi.fn(
      (_name: string, input: { key: string }, onEvent?: (e: JobEvent) => void, onStart?: (id: string) => void) => {
        const done = deferred<unknown>();
        jobs.push({ key: input.key, onEvent, onStart, done });
        return done.promise;
      },
    ),
  };
});

const toasts: { title: string; detail?: string }[] = [];
const errors: { e: unknown; title?: string }[] = [];
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return {
    ...real,
    toast: vi.fn((t: (typeof toasts)[number]) => toasts.push(t)),
    errorToast: vi.fn((e: unknown, title?: string) => errors.push({ e, title })),
  };
});

const { abandonPulls, cancelPull, isPulling, onPullLanded, startPull, usePulls, watchPull } = await import(
  "../../src/ui/screens/tests/pulls.ts"
);

const cancels: { id: string; project?: string }[] = [];

beforeEach(() => {
  jobs.length = 0;
  calls = [];
  callResult = () => ({});
  toasts.length = 0;
  errors.length = 0;
  cancels.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      cancels.push({ id: JSON.parse(init.body).id, project: init.headers["X-Testimus-Project"] });
      if (JSON.parse(init.body).id === "boom") throw new Error("net");
      return new Response("{}");
    }),
  );
  watchPull("");
});

afterEach(() => {
  act(() => abandonPulls());
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const jobOf = (key: string) => jobs.filter((j) => j.key === key).at(-1) as Job;
const progress = (message: string): Extract<JobEvent, { type: "progress" }> => ({
  jobId: "j",
  at: "",
  type: "progress",
  message,
});

describe("pulls", () => {
  it("queues a pull once, shows its progress without the key prefix, and lands it", async () => {
    const h = renderHook(() => usePulls());
    const landed = vi.fn();
    const off = onPullLanded(landed);
    watchPull("K-1");
    act(() => startPull("K-1", "One"));
    act(() => startPull("K-1", "One"));
    expect(jobs).toHaveLength(1);
    expect(isPulling("K-1")).toBe(true);
    expect(h.result.current).toEqual([{ key: "K-1", summary: "One", startedAt: expect.any(Number) }]);
    act(() => jobOf("K-1").onEvent?.(progress("K-1: reading steps")));
    act(() => jobOf("K-1").onEvent?.(progress("plain line")));
    act(() => jobOf("K-1").onEvent?.({ jobId: "j", at: "", type: "log", level: "info", message: "x" }));
    expect(h.result.current[0].message).toBe("plain line");
    act(() => jobOf("K-1").onStart?.("job-1"));
    await act(async () => jobOf("K-1").done.resolve({ pulled: ["K-1"] }));
    expect(landed).toHaveBeenCalledWith("K-1", true);
    expect(h.result.current).toEqual([]);
    expect(isPulling("K-1")).toBe(false);
    off();
    act(() => startPull("K-2", "Two"));
    await act(async () => jobOf("K-2").done.resolve(null));
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed watched pull in the pane, and toasts an unwatched one", async () => {
    const h = renderHook(() => usePulls());
    watchPull("K-3");
    act(() => startPull("K-3", "Three"));
    act(() => startPull("K-4", "Four"));
    await act(async () => jobOf("K-3").done.resolve({ failed: [{ key: "K-3", error: "403 Forbidden" }] }));
    await act(async () => jobOf("K-4").done.resolve({ failed: [{ key: "other", error: "first failure" }] }));
    expect(h.result.current).toEqual([
      { key: "K-3", summary: "Three", startedAt: expect.any(Number), error: "403 Forbidden" },
    ]);
    expect(isPulling("K-3")).toBe(false);
    expect(errors).toEqual([{ e: new Error("first failure"), title: "Could not pull K-4" }]);
    act(() => startPull("K-3", "Three again"));
    expect(h.result.current).toEqual([{ key: "K-3", summary: "Three again", startedAt: expect.any(Number) }]);
    await act(async () => jobOf("K-3").done.reject(new Error("offline")));
    act(() => cancelPull("K-3"));
    expect(h.result.current).toEqual([]);
  });

  it("cancels a pull, cancelling its job in the project it started in", async () => {
    setProject("C:\\p one");
    const h = renderHook(() => usePulls());
    act(() => startPull("K-5", "Five"));
    act(() => jobOf("K-5").onStart?.("job-5"));
    setProject("C:\\other");
    act(() => cancelPull("K-5"));
    expect(h.result.current).toEqual([]);
    await waitFor(() => expect(cancels).toEqual([{ id: "job-5", project: encodeURIComponent("C:\\p one") }]));
    act(() => jobOf("K-5").onEvent?.(progress("late")));
    await act(async () => jobOf("K-5").done.resolve({ pulled: ["K-5"] }));
    act(() => cancelPull("K-5"));
    expect(h.result.current).toEqual([]);
  });

  it("cancels the job once it starts when the pull was abandoned first, and ignores a late failure", async () => {
    act(() => startPull("K-6", "Six"));
    act(() => cancelPull("K-6"));
    expect(cancels).toEqual([]);
    act(() => jobOf("K-6").onStart?.("boom"));
    await waitFor(() => expect(cancels).toEqual([{ id: "boom", project: undefined }]));
    await act(async () => jobOf("K-6").done.reject(new Error("cancelled")));
    expect(errors).toEqual([]);
  });

  it("does not cancel the job of a pull that already failed", async () => {
    watchPull("K-7");
    act(() => startPull("K-7", "Seven"));
    act(() => jobOf("K-7").onStart?.("job-7"));
    await act(async () => jobOf("K-7").done.reject(new Error("gone")));
    act(() => cancelPull("K-7"));
    expect(cancels).toEqual([]);
  });

  it("abandons the pulls of other projects only", () => {
    const h = renderHook(() => usePulls());
    setProject("C:\\a");
    act(() => startPull("K-8", "Eight"));
    setProject("C:\\b");
    act(() => startPull("K-9", "Nine"));
    act(() => abandonPulls((dir) => dir === "C:\\b"));
    expect(h.result.current.map((p) => p.key)).toEqual(["K-9"]);
  });

  it("ignores a stale run of a key that was pulled again", async () => {
    const h = renderHook(() => usePulls());
    act(() => startPull("K-10", "Ten"));
    const first = jobOf("K-10");
    act(() => cancelPull("K-10"));
    act(() => startPull("K-10", "Ten again"));
    act(() => first.onEvent?.(progress("stale")));
    expect(h.result.current[0].message).toBeUndefined();
    await act(async () => jobOf("K-10").done.resolve({}));
    expect(h.result.current).toEqual([]);
  });
});

describe("pull stages", () => {
  it("keeps what the core says of the test, the images and the write", () => {
    const h = renderHook(() => usePulls());
    act(() => startPull("K-5", "Five"));
    const read = {
      key: "K-5",
      phase: "read" as const,
      summary: "Five from Jira",
      folder: "/A",
      steps: 4,
      images: 2,
      preconditions: 1,
      covers: 0,
      labels: 3,
    };
    const staged = (pull: Extract<JobEvent, { type: "progress" }>["pull"]) =>
      act(() => jobOf("K-5").onEvent?.({ ...progress("K-5: x"), pull }));
    staged(read);
    expect(h.result.current[0]).toMatchObject({ phase: "read", read });
    staged({ key: "K-5", phase: "images", done: 1, total: 2 });
    expect(h.result.current[0]).toMatchObject({ phase: "images", images: { done: 1, total: 2 }, read });
    staged({ key: "K-5", phase: "write" });
    expect(h.result.current[0]).toMatchObject({ phase: "write", images: { done: 1, total: 2 } });
  });
});

describe("PullPane", () => {
  const pane = (
    pull: Parameters<typeof PullPane>[0]["pull"],
    others: Parameters<typeof PullPane>[0]["others"] = [],
  ) => {
    const h = { onCancel: vi.fn(), onRetry: vi.fn(), onBack: vi.fn() };
    render(<PullPane pull={pull} others={others} {...h} />);
    return h;
  };

  it("shows a pull reaching Jira, then waiting behind others, then its own message", () => {
    const h = pane({ key: "K-1", summary: "One" });
    expect(screen.getByRole("status")).toHaveTextContent("contacting Jira…");
    expect(screen.getByText("One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onCancel).toHaveBeenCalled();
    cleanup();
    pane({ key: "K-1", summary: "" }, [{ key: "K-2", summary: "", message: "steps" }]);
    expect(screen.getByRole("status")).toHaveTextContent("waiting for a free slot…");
    expect(screen.getByText("1 more pulling in the background")).toBeInTheDocument();
    cleanup();
    pane({ key: "K-1", summary: "", message: "attachments 2/3" }, [{ key: "K-2", summary: "" }]);
    expect(screen.getByRole("status")).toHaveTextContent("attachments 2/3");
  });

  const read = {
    key: "K-1",
    phase: "read" as const,
    summary: "From Jira",
    folder: "/Freinage",
    status: "To Do",
    steps: 1,
    images: 4,
    preconditions: 2,
    covers: 1,
    labels: 0,
  };
  const phases = () =>
    [...document.querySelectorAll(".pullpane-phase")].map((li) => `${li.className.split("is-")[1]} ${li.textContent}`);

  it("draws a skeleton until the test is read, then its facts and the four phases", () => {
    pane({ key: "K-1", summary: "", startedAt: Date.now() - 65_000 });
    expect(document.querySelector(".pullpane-card .sk")).not.toBeNull();
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(phases()).toEqual([
      "active Reach Jira",
      "pending Read the test",
      "pending Download the images",
      "pending Write test.md",
    ]);
    cleanup();
    pane({ key: "K-1", summary: "One", phase: "read", read, startedAt: Date.now() - 3_000 });
    expect(screen.getByText("3 s")).toBeInTheDocument();
    expect(screen.getByText("From Jira", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("/Freinage")).toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect([...document.querySelectorAll(".pullpane-fact")].map((f) => f.textContent)).toEqual([
      "1 step",
      "4 images",
      "2 preconditions",
      "1 requirement",
      "0 labels",
    ]);
    expect(phases()).toEqual([
      "done Jira reached",
      "done Test read1 step",
      "active Download the images0 / 4",
      "pending Write test.md",
    ]);
    cleanup();
    pane({ key: "K-1", summary: "One", phase: "images", read, images: { done: 3, total: 4 } });
    expect((document.querySelector(".pullpane-bar span") as HTMLElement).style.width).toBe("75%");
    cleanup();
    pane({ key: "K-1", summary: "One", phase: "images", read, images: { done: 4, total: 4 } });
    expect(phases().at(-1)).toBe("active Write test.md");
    cleanup();
    pane({ key: "K-1", summary: "One", phase: "write", read: { ...read, images: 0, summary: "", folder: "" } });
    expect(screen.getByText("One", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(phases()).toEqual(["done Jira reached", "done Test read1 step", "skip No images", "active Write test.md"]);
    cleanup();
    pane({ key: "K-1", summary: "", phase: "read", read: { ...read, images: 0 } });
    expect(phases().at(-1)).toBe("active Write test.md");
  });

  it("says a queued pull is queued, with every phase still to come", () => {
    pane({ key: "K-1", summary: "" }, [{ key: "K-2", summary: "", message: "steps" }]);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(phases().every((p) => p.startsWith("pending"))).toBe(true);
  });

  it("explains a failed pull and offers retry and back", () => {
    const h = pane({ key: "K-1", summary: "One", error: "403 Forbidden" });
    expect(screen.getByText("Pull failed")).toBeInTheDocument();
    expect(screen.getByText("403 Forbidden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.onRetry).toHaveBeenCalled();
    expect(h.onBack).toHaveBeenCalled();
  });
});

const ref = (id: string, o: Partial<LocalTestRef> = {}): LocalTestRef => ({
  id,
  summary: `Test ${id}`,
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

describe("RecentList", () => {
  it("lists recently opened tests still in the project, newest first, at most six", () => {
    const refs = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ref(id));
    refs.push(ref("old", { mtime: Date.now() - 30 * 864e5 }), ref("blank", { summary: "", key: "K-1" }));
    const onOpen = vi.fn();
    const { container } = render(<RecentList refs={refs} onOpen={onOpen} />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      for (const id of ["old", "gone", "a", "b", "c", "d", "e", "f", "g", "blank"]) addRecent(id);
    });
    const items = screen.getAllByRole("button");
    expect(items.map((b) => b.querySelector(".recent-name")?.textContent)).toEqual([
      "Untitled",
      "Test g",
      "Test f",
      "Test e",
      "Test d",
      "Test c",
    ]);
    expect(items[0]).toHaveAttribute("title", "K-1");
    expect(items[1]).toHaveAttribute("title", "g");
    fireEvent.click(items[1]);
    expect(onOpen).toHaveBeenCalledWith("g");
  });
});

describe("DeleteTest", () => {
  const target = { id: "t1", key: "K-1", summary: "One", synced: true, dirty: false };

  it("asks first only for the only copy or unpushed changes", () => {
    expect(needsAsking(target)).toBe(false);
    expect(needsAsking({ ...target, dirty: true })).toBe(true);
    expect(needsAsking({ ...target, synced: false })).toBe(true);
  });

  it("discards the editor, removes the test and forgets it in the recent list", async () => {
    const discard = vi.fn();
    setDiscarder(discard);
    addRecent("t1");
    expect(await deleteTest(target)).toBe(true);
    expect(discard).toHaveBeenCalledWith("t1");
    expect(calls).toEqual([{ name: "tests.remove", input: { id: "t1" } }]);
    expect(recentIds()).toEqual([]);
    expect(toasts[0]).toEqual({
      kind: "info",
      title: "Local copy of K-1 deleted",
      detail: "The Jira test is untouched.",
    });
    expect(await deleteTest({ ...target, key: undefined })).toBe(true);
    expect(toasts[1]).toEqual({ kind: "info", title: "Local copy of t1 deleted", detail: undefined });
    setDiscarder(null);
  });

  it("reports a failed delete", async () => {
    callResult = () => {
      throw new Error("locked");
    };
    expect(await deleteTest(target)).toBe(false);
    expect(errors[0].title).toBe("Could not delete the local copy");
  });

  it("confirms, then reports the deletion or closes on failure", async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    const { unmount } = render(
      <DeleteTest target={{ ...target, dirty: true }} onClose={onClose} onDeleted={onDeleted} />,
    );
    expect(screen.getByText(/the local changes you have not pushed yet/)).toBeInTheDocument();
    unmount();
    render(<DeleteTest target={target} onClose={onClose} onDeleted={onDeleted} />);
    expect(screen.getByText(/nothing — the Jira test is left untouched and can be pulled again/)).toBeInTheDocument();
    expect(screen.getByText("K-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete local copy" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    cleanup();
    callResult = () => {
      throw new Error("locked");
    };
    render(
      <DeleteTest
        target={{ ...target, key: undefined, summary: "", synced: false }}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    expect(screen.getByText(/this test was never pushed/)).toBeInTheDocument();
    expect(screen.getByText(/Untitled/)).toBeInTheDocument();
    expect(screen.getByText("t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete local copy" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
