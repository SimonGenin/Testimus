// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../../src/core/types.ts";
import { discardAutosave } from "../../../../../src/ui/lib/data/autosave.ts";
import { setProject } from "../../../../../src/ui/lib/data/client.ts";
import { key } from "../../../../../src/ui/lib/data/query.ts";
import { DeleteTest, deleteTest, needsAsking } from "../../../../../src/ui/screens/tests/DeleteTest.tsx";
import { PullPane } from "../../../../../src/ui/screens/tests/PullPane.tsx";
import { iconOf } from "../../../helpers/icons.ts";
import { deferred } from "../../../helpers/ui-server.ts";
import { testClient, WithData } from "../data-helpers.tsx";

vi.mock("../../../../../src/ui/lib/data/autosave.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/data/autosave.ts")>();
  return { ...real, discardAutosave: vi.fn() };
});

type Run = {
  key: string;
  onStart?: (id: string) => void;
  done: ReturnType<typeof deferred<unknown>>;
};
const runs: Run[] = [];
let calls: { name: string; input: Record<string, unknown> }[] = [];
let callResult: () => unknown = () => ({});
// ponytail: the project's jobs as the server keeps them (jobs.list), and each one's log (jobs.show)
let served: Job[] = [];
let logs: Record<string, JobEvent[]> = {};

vi.mock("../../../../../src/ui/lib/data/client.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/data/client.ts")>();
  return {
    ...real,
    call: vi.fn(async (name: string, input: Record<string, unknown>, opts?: { project?: string | null }) => {
      if (name === "jobs.list") return served;
      if (name === "jobs.show")
        return { job: served.find((j) => j.id === input.id), events: logs[String(input.id)] ?? [] };
      if (name === "jobs.cancel") {
        cancels.push({ id: String(input.id), project: opts?.project ? encodeURIComponent(opts.project) : undefined });
        if (input.id === "boom") throw new Error("net");
        return {};
      }
      calls.push({ name, input });
      return callResult();
    }),
    run: vi.fn((_name: string, input: { key: string }, _on?: unknown, onStart?: (id: string) => void) => {
      const done = deferred<unknown>();
      runs.push({ key: input.key, onStart, done });
      return done.promise;
    }),
  };
});

const toasts: { title: string; detail?: string }[] = [];
const errors: { e: unknown; title?: string }[] = [];
vi.mock("../../../../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../../src/ui/lib/toast.ts")>();
  return {
    ...real,
    toast: vi.fn((t: (typeof toasts)[number]) => toasts.push(t)),
    errorToast: vi.fn((e: unknown, title?: string) => errors.push({ e, title })),
  };
});

const { abandonPulls, cancelPull, onPullLanded, pullsOf, startPull, usePullStage, usePulls, watchPull } = await import(
  "../../../../../src/ui/screens/tests/pulls.ts"
);

const cancels: { id: string; project?: string }[] = [];

beforeEach(() => {
  runs.length = 0;
  calls = [];
  callResult = () => ({});
  served = [];
  logs = {};
  toasts.length = 0;
  errors.length = 0;
  cancels.length = 0;
  localStorage.clear();
  setProject("C:\\p");
  watchPull("");
});

afterEach(() => {
  act(() => abandonPulls());
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const runOf = (key: string) => runs.filter((j) => j.key === key).at(-1) as Run;
const pullJob = (o: Partial<Job>): Job => ({
  id: "job-1",
  kind: "pull",
  subject: "K-1",
  status: "running",
  startedAt: new Date().toISOString(),
  ...o,
});

let client = testClient();
const wrapper = ({ children }: { children: ReactNode }) => <WithData client={client}>{children}</WithData>;
const hook = () => {
  client = testClient();
  return renderHook(() => usePulls(), { wrapper });
};
// ponytail: the server's list changed — the event bridge would read it again on the job's status
const relist = (next: Job[]) => {
  served = next;
  return act(() => client.invalidateQueries());
};
const shown = (h: ReturnType<typeof hook>) => h.result.current.map(({ startedAt: _s, ...p }) => p);

describe("pulls", () => {
  it("shows a pull from the moment it is asked, then as its job goes, without the key prefix, and lands it", async () => {
    const h = hook();
    const landed = vi.fn();
    const off = onPullLanded(landed);
    watchPull("K-1");
    act(() => startPull("K-1", "One"));
    act(() => startPull("K-1", "One"));
    expect(runs).toHaveLength(1);
    expect(shown(h)).toEqual([{ key: "K-1", summary: "One" }]);
    served = [pullJob({ message: "K-1: reading steps" })];
    act(() => runOf("K-1").onStart?.("job-1"));
    await waitFor(() =>
      expect(shown(h)).toEqual([{ key: "K-1", summary: "One", jobId: "job-1", message: "reading steps" }]),
    );
    await relist([pullJob({ message: "plain line" })]);
    await waitFor(() => expect(h.result.current[0].message).toBe("plain line"));
    served = [pullJob({ status: "done", endedAt: new Date().toISOString(), result: { pulled: ["K-1"] } })];
    await act(async () => runOf("K-1").done.resolve({ pulled: ["K-1"] }));
    await relist(served);
    expect(landed).toHaveBeenCalledWith("K-1", true);
    await waitFor(() => expect(h.result.current).toEqual([]));
    off();
    act(() => startPull("K-2", "Two"));
    await act(async () => runOf("K-2").done.resolve(null));
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed watched pull in the pane, and toasts an unwatched one and lets it go", async () => {
    const h = hook();
    watchPull("K-3");
    act(() => startPull("K-3", "Three"));
    act(() => startPull("K-4", "Four"));
    await act(async () => runOf("K-3").done.resolve({ failed: [{ key: "K-3", error: "403 Forbidden" }] }));
    act(() => runOf("K-4").onStart?.("job-4"));
    await act(async () => runOf("K-4").done.resolve({ failed: [{ key: "other", error: "first failure" }] }));
    served = [
      pullJob({ id: "job-4", subject: "K-4", status: "failed", endedAt: new Date().toISOString(), error: "x" }),
    ];
    await relist(served);
    expect(shown(h)).toEqual([{ key: "K-3", summary: "Three", error: "403 Forbidden" }]);
    expect(errors).toEqual([{ e: new Error("first failure"), title: "Could not pull K-4" }]);
    act(() => startPull("K-3", "Three again"));
    expect(shown(h)).toEqual([{ key: "K-3", summary: "Three again" }]);
    await act(async () => runOf("K-3").done.reject(new Error("offline")));
    expect(shown(h)).toEqual([{ key: "K-3", summary: "Three again", error: "offline" }]);
    act(() => cancelPull(h.result.current[0]));
    expect(h.result.current).toEqual([]);
  });

  it("cancels a pull, cancelling its job in the project it started in", async () => {
    setProject("C:\\p one");
    const h = hook();
    act(() => startPull("K-5", "Five"));
    act(() => runOf("K-5").onStart?.("job-5"));
    const pull = h.result.current[0];
    setProject("C:\\other");
    setProject("C:\\p one");
    act(() => cancelPull(pull));
    expect(h.result.current).toEqual([]);
    await waitFor(() => expect(cancels).toEqual([{ id: "job-5", project: encodeURIComponent("C:\\p one") }]));
    await act(async () => runOf("K-5").done.resolve({ pulled: ["K-5"] }));
    expect(h.result.current).toEqual([]);
  });

  it("cancels the job once it starts when the pull was abandoned first, and ignores a late failure", async () => {
    const h = hook();
    act(() => startPull("K-6", "Six"));
    act(() => cancelPull(h.result.current[0]));
    expect(cancels).toEqual([]);
    act(() => runOf("K-6").onStart?.("boom"));
    await waitFor(() => expect(cancels).toEqual([{ id: "boom", project: encodeURIComponent("C:\\p") }]));
    await act(async () => runOf("K-6").done.reject(new Error("cancelled")));
    expect(errors).toEqual([]);
  });

  it("does not cancel the job of a pull that already failed", async () => {
    const h = hook();
    watchPull("K-7");
    act(() => startPull("K-7", "Seven"));
    act(() => runOf("K-7").onStart?.("job-7"));
    await act(async () => runOf("K-7").done.reject(new Error("gone")));
    act(() => cancelPull(h.result.current[0]));
    expect(cancels).toEqual([]);
  });

  it("abandons the pulls of other projects only, cancelling their running jobs", async () => {
    setProject("C:\\a");
    act(() => startPull("K-8", "Eight"));
    act(() => runOf("K-8").onStart?.("job-8"));
    setProject("C:\\b");
    const h = hook();
    act(() => startPull("K-9", "Nine"));
    act(() => abandonPulls((dir) => dir === "C:\\b"));
    expect(h.result.current.map((p) => p.key)).toEqual(["K-9"]);
    await waitFor(() => expect(cancels).toEqual([{ id: "job-8", project: encodeURIComponent("C:\\a") }]));
  });

  it("ignores a stale run of a key that was pulled again", async () => {
    const h = hook();
    act(() => startPull("K-10", "Ten"));
    const first = runOf("K-10");
    act(() => cancelPull(h.result.current[0]));
    act(() => startPull("K-10", "Ten again"));
    await act(async () => first.done.reject(new Error("stale")));
    expect(shown(h)).toEqual([{ key: "K-10", summary: "Ten again" }]);
    await act(async () => runOf("K-10").done.resolve({}));
    expect(h.result.current).toEqual([]);
  });

  it("after a reload, or from another window, shows the pulls the project's jobs say are running or failed", () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(now + ms).toISOString();
    const jobs = [
      pullJob({ id: "a", subject: "K-1", startedAt: iso(0), message: "K-1: steps" }),
      pullJob({ id: "b", subject: "K-2", status: "failed", startedAt: iso(1), endedAt: iso(2), error: "403" }),
      pullJob({
        id: "c",
        subject: "K-3",
        status: "done",
        startedAt: iso(1),
        endedAt: iso(2),
        result: { pulled: ["K-3"] },
      }),
      pullJob({
        id: "d",
        subject: "K-4",
        status: "done",
        startedAt: iso(1),
        endedAt: iso(2),
        result: { failed: [{ key: "K-4", error: "gone" }] },
      }),
      pullJob({ id: "e", subject: "K-5", status: "failed", startedAt: iso(-9), endedAt: iso(-5), error: "old" }),
      pullJob({ id: "f", subject: "K-6", status: "failed", startedAt: iso(1), endedAt: iso(2), error: "let go" }),
      { ...pullJob({ id: "g", subject: "D1" }), kind: "docs.convert" },
    ];
    const rows = pullsOf(jobs, {
      project: "C:\\reloaded",
      mine: [],
      dismissed: new Set(["C:\\reloaded\nf"]),
      since: now - 1,
    });
    expect(rows.map(({ startedAt: _s, ...p }) => p)).toEqual([
      { key: "K-1", summary: "", jobId: "a", message: "steps" },
      { key: "K-2", summary: "", jobId: "b", error: "403" },
      { key: "K-4", summary: "", jobId: "d", error: "gone" },
    ]);
  });
});

describe("pull stages", () => {
  it("keeps what the core says of the test, the images and the write, from the job's log", async () => {
    client = testClient();
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
    served = [pullJob({ id: "job-5", subject: "K-5" })];
    const progress = (pull: Extract<JobEvent, { type: "progress" }>["pull"]): JobEvent => ({
      jobId: "job-5",
      at: "",
      type: "progress",
      message: "K-5: x",
      pull,
    });
    logs["job-5"] = [progress(read)];
    const h = renderHook(() => usePullStage("job-5"), { wrapper });
    await waitFor(() => expect(h.result.current).toMatchObject({ phase: "read", read }));
    logs["job-5"] = [...logs["job-5"], progress({ key: "K-5", phase: "images", done: 1, total: 2 })];
    await act(() => client.invalidateQueries());
    await waitFor(() =>
      expect(h.result.current).toMatchObject({ phase: "images", images: { done: 1, total: 2 }, read }),
    );
    logs["job-5"] = [...logs["job-5"], progress({ key: "K-5", phase: "write" })];
    await act(() => client.invalidateQueries());
    await waitFor(() => expect(h.result.current).toMatchObject({ phase: "write", images: { done: 1, total: 2 } }));
    const none = renderHook(() => usePullStage(undefined), { wrapper });
    expect(none.result.current).toEqual({});
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
    expect(screen.getByRole("status", { name: "Pull progress" })).toHaveTextContent("contacting Jira…");
    expect(screen.getByText("One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onCancel).toHaveBeenCalled();
    cleanup();
    pane({ key: "K-1", summary: "" }, [{ key: "K-2", summary: "", message: "steps" }]);
    expect(screen.getByRole("status", { name: "Pull progress" })).toHaveTextContent("waiting for a free slot…");
    expect(screen.getByText("1 more pulling in the background")).toBeInTheDocument();
    cleanup();
    pane({ key: "K-1", summary: "", message: "attachments 2/3" }, [{ key: "K-2", summary: "" }]);
    expect(screen.getByRole("status", { name: "Pull progress" })).toHaveTextContent("attachments 2/3");
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

  it("names the pull by key and summary, a skeleton until the summary is known, and Cancel stops it", () => {
    pane({ key: "K-1", summary: "" });
    expect(screen.getByText("K-1 · pulling from Jira")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Pulling" })).not.toHaveAttribute("aria-valuenow");
    cleanup();
    pane({ key: "K-1", summary: "One", phase: "read", read });
    expect(screen.getByRole("heading", { name: "From Jira" })).toBeInTheDocument();
    cleanup();
    pane({ key: "K-1", summary: "One", phase: "write", read: { ...read, summary: "" } });
    expect(screen.getByRole("heading", { name: "One" })).toBeInTheDocument();
  });

  it("measures the images while they download", () => {
    pane({ key: "K-1", summary: "One", phase: "images", read, images: { done: 3, total: 4 } });
    const bar = screen.getByRole("progressbar", { name: "Images downloaded" });
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(bar).toHaveAttribute("aria-valuetext", "3 of 4 images");
  });

  it("says a queued pull is queued, waiting for one of the 3 slots", () => {
    pane({ key: "K-1", summary: "" }, [{ key: "K-2", summary: "", message: "steps" }]);
    expect(screen.getByText("K-1 · queued")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Pull progress" })).toHaveTextContent(
      "waiting for a free slot… (3 pulls at a time)",
    );
  });

  it("explains a failed pull and offers retry and back", () => {
    const h = pane({ key: "K-1", summary: "One", error: "403 Forbidden" });
    expect(screen.getByText("Could not pull K-1")).toBeInTheDocument();
    expect(screen.queryByText("Pull failed")).toBeNull();
    expect(screen.getByText("403 Forbidden")).toBeInTheDocument();
    expect(iconOf(screen.getByRole("button", { name: "Retry" }))).toBe("refresh");
    expect(iconOf(screen.getByRole("button", { name: "Back" }))).toBe("arrow-left");
    expect(iconOf(screen.getByRole("alert"))).toBe("alert-circle");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(h.onRetry).toHaveBeenCalled();
    expect(h.onBack).toHaveBeenCalled();
  });
});

describe("DeleteTest", () => {
  const target = { id: "t1", key: "K-1", summary: "One", synced: true, dirty: false };

  it("asks first only for the only copy or unpushed changes", () => {
    expect(needsAsking(target)).toBe(false);
    expect(needsAsking({ ...target, dirty: true })).toBe(true);
    expect(needsAsking({ ...target, synced: false })).toBe(true);
  });

  it("discards the editor and removes the test", async () => {
    const client = testClient();
    expect(await deleteTest(client, target)).toBe(true);
    expect(discardAutosave).toHaveBeenCalledWith(key("tests.show", { id: "t1" }));
    expect(calls).toEqual([{ name: "tests.remove", input: { id: "t1" } }]);
    expect(toasts[0]).toEqual({
      tone: "neutral",
      title: "Local copy of K-1 deleted",
      detail: "The Jira test is untouched.",
    });
    expect(await deleteTest(client, { ...target, key: undefined })).toBe(true);
    expect(toasts[1]).toEqual({ tone: "neutral", title: "Local copy of « One » deleted", detail: undefined });
  });

  it("reports a failed delete", async () => {
    callResult = () => {
      throw new Error("locked");
    };
    expect(await deleteTest(testClient(), target)).toBe(false);
    expect(errors[0].title).toBe("Could not delete the local copy");
  });

  it("confirms, then reports the deletion or closes on failure", async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    const { unmount } = render(
      <WithData client={testClient()}>
        <DeleteTest target={{ ...target, dirty: true }} onClose={onClose} onDeleted={onDeleted} />
      </WithData>,
    );
    expect(screen.getByText(/the local changes you have not pushed yet/)).toBeInTheDocument();
    unmount();
    render(
      <WithData client={testClient()}>
        <DeleteTest target={target} onClose={onClose} onDeleted={onDeleted} />
      </WithData>,
    );
    expect(
      screen.getByText(/Nothing is lost — the Jira test is left untouched and can be pulled again/),
    ).toBeInTheDocument();
    expect(screen.getByText("K-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    cleanup();
    callResult = () => {
      throw new Error("locked");
    };
    render(
      <WithData client={testClient()}>
        <DeleteTest
          target={{ ...target, key: undefined, summary: "", synced: false }}
          onClose={onClose}
          onDeleted={onDeleted}
        />
      </WithData>,
    );
    expect(screen.getByText(/This test was never pushed/)).toBeInTheDocument();
    expect(screen.getByText(/Untitled test/)).toBeInTheDocument();
    expect(screen.queryByText("t1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
