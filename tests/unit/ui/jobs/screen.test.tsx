// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { applyJobEvent } from "../../../../src/ui/lib/data/events.ts";
import { readPref } from "../../../../src/ui/lib/prefs.ts";
import { JobState, JobsScreen } from "../../../../src/ui/screens/jobs/JobsScreen.tsx";
import { iconsIn } from "../../helpers/icon-names.tsx";
import {
  callsOf,
  deferred,
  Fail,
  FakeES,
  fakeEvents,
  fakeNet,
  job,
  net,
  status,
  withApp,
} from "../../helpers/ui-data.tsx";

const toasts = vi.hoisted(() => ({ toast: vi.fn(), errorToast: vi.fn() }));
vi.mock("../../../../src/ui/lib/toast.ts", () => toasts);

const errors = () => toasts.errorToast.mock.calls.map((a) => a[1]);

let server: Job[] = [];

// ponytail: the server's list follows the same events the page receives, as the real one does
function emit(e: JobEvent): void {
  server = applyJobEvent(server, e);
  act(() => FakeES.emit(e));
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  server = [];
  net.routes["jobs.list"] = () => server;
  net.routes["jobs.show"] = (i) => ({ job: null, events: [], id: i.id });
  toasts.toast.mockClear();
  toasts.errorToast.mockClear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProject(null);
});

const jobsScreen = (over: Partial<AppState> = {}) => withApp(<JobsScreen />, { route: { screen: "jobs" }, ...over });

const list = () => screen.getByRole("region", { name: "Job list" });
const detail = (name: string) => screen.getByRole("complementary", { name });
const rows = () => within(list()).queryAllByRole("treeitem");
const rowOf = (text: string) => rows().find((r) => r.textContent?.includes(text)) as HTMLElement;

describe("Jobs screen", () => {
  it("shows the skeleton, then says when there is no job yet", async () => {
    const gate = deferred();
    net.routes["jobs.list"] = async () => {
      await gate.promise;
      return { not: "an array" };
    };
    jobsScreen();
    expect(within(list()).getByRole("listbox", { name: "Jobs" })).toHaveAttribute("aria-busy", "true");
    act(() => FakeES.emit(status(job())));
    await act(async () => gate.resolve(null));
    expect(await screen.findByText("No job yet")).toBeInTheDocument();
    expect(within(list()).getByRole("combobox", { name: "Kind" })).toBeDisabled();
  });

  it("says when the jobs cannot be listed, and reads them again on Retry", async () => {
    let down = true;
    net.routes["jobs.list"] = () => {
      if (down) throw new Fail("core down");
      return [];
    };
    jobsScreen();
    expect(await screen.findByText("Could not list the jobs")).toBeInTheDocument();
    down = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No job yet")).toBeInTheDocument();
  });

  it("lists the jobs, follows their events and opens one", async () => {
    server = [
      job({ id: "g1", progress: { done: 1, total: 4 }, message: "Writing 1" }),
      job({
        id: "x1",
        kind: "mystery",
        status: "done",
        endedAt: "2026-11-02T10:00:09.000Z",
        progress: { done: 2, total: 2 },
      }),
      job({ id: "c1", kind: "check", status: "cancelled", endedAt: "2026-11-02T10:00:01.000Z" }),
      job({ id: "f1", kind: "fix", status: "failed", error: "Claude stopped", endedAt: "2026-11-02T10:00:01.000Z" }),
    ];
    const { state } = jobsScreen();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(within(list()).getByRole("radio", { name: /^Running/ })).toHaveTextContent("1");
    expect(within(list()).getByRole("group", { name: "Running" })).toHaveTextContent("Generate tests");
    const first = rows();
    expect(first[0]).toHaveAttribute("aria-selected", "true");
    expect(within(first[0]).getByRole("progressbar", { name: "Generate tests progress" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(within(first[0]).getByText("Writing 1")).toBeInTheDocument();
    expect(within(first[1]).getByText("2 of 2")).toBeInTheDocument();
    expect(within(first[1]).getByText("0:09")).toBeInTheDocument();
    expect(within(first[2]).queryByText("—")).toBeNull();
    expect(within(first[0]).getByText("Running")).toBeInTheDocument();
    expect(within(first[2]).getByText("Cancelled")).toBeInTheDocument();
    expect(within(first[3]).getByText("Failed")).toBeInTheDocument();
    expect(within(first[3]).getByText("Claude stopped")).toBeInTheDocument();
    emit({ jobId: "g1", at: "", type: "progress", message: "Writing 2", done: 2, total: 4 });
    emit({ jobId: "g1", at: "", type: "progress", message: "Still writing" });
    emit({ jobId: "g1", at: "", type: "progress", message: "No count", total: 5 });
    emit({ jobId: "g1", at: "", type: "log", level: "info", message: "ignored" });
    emit(status(job({ id: "n1", kind: "pull" })));
    emit(status(job({ id: "c1", kind: "check", status: "done", result: { tests: [] } })));
    await waitFor(() => expect(rows()).toHaveLength(5));
    const now = rows();
    expect(within(now[0]).getByText("Pull from Jira")).toBeInTheDocument();
    expect(within(now[1]).getByText("No count")).toBeInTheDocument();
    expect(within(now[1]).getByRole("progressbar", { name: "Generate tests progress" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(within(now[3]).getByText("0 with findings")).toBeInTheDocument();
    fireEvent.click(now[2]);
    expect(state.navigate).toHaveBeenCalledWith("jobs", "x1");
    fireEvent.keyDown(now[3], { key: "Enter" });
    expect(state.navigate).toHaveBeenCalledWith("jobs", "c1");
    fireEvent.keyDown(now[3], { key: "a" });
    expect(state.navigate).toHaveBeenCalledTimes(2);
  });

  it("follows a progress event without reading the list again", async () => {
    server = [job({ id: "g1", progress: { done: 1, total: 4 } })];
    jobsScreen();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const reads = callsOf("jobs.list").length;
    act(() => FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "Writing 3", done: 3, total: 4 }));
    await waitFor(() => expect(within(rows()[0]).getByText("Writing 3")).toBeInTheDocument());
    expect(callsOf("jobs.list")).toHaveLength(reads);
  });

  it("ticks the running durations every second", async () => {
    server = [job({ id: "g1", startedAt: new Date(Date.now() - 5000).toISOString() })];
    jobsScreen();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const time = () => within(rows()[0]).getAllByText(/^\d+:\d\d$/)[0].textContent;
    const first = time();
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    expect(time()).not.toBe(first);
  });

  it("details a running job: progress, message, cancel and its CLI", async () => {
    server = [job({ id: "r1", kind: "rag-index", message: "Embedding" })];
    let cancels = 0;
    net.routes["jobs.cancel"] = () => {
      cancels++;
      if (cancels > 1) throw new Fail("already done");
      return null;
    };
    jobsScreen({ route: { screen: "jobs", arg: "r1" } });
    const side = await waitFor(() => detail("Index documents job"));
    expect(within(side).getByRole("progressbar", { name: "Index documents progress" })).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(within(side).getByText("Embedding")).toBeInTheDocument();
    expect(within(side).getByText("testimus rag index")).toBeInTheDocument();
    fireEvent.click(within(side).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(callsOf("jobs.cancel")).toHaveLength(1));
    fireEvent.click(within(side).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(errors()).toContain("Could not cancel the job"));
  });

  it("details a finished generation with a way to review it, and a failure with what to do", async () => {
    server = [
      job({ id: "g1", status: "done", result: { tests: ["local-a", "local-b"] }, endedAt: "2026-11-02T10:01:00Z" }),
      job({ id: "f1", kind: "fix", status: "failed", endedAt: "2026-11-02T10:01:00Z" }),
      job({ id: "u1", kind: "odd", status: "done", endedAt: "2026-11-02T10:01:00Z" }),
      job({ id: "e1", status: "done", result: { tests: [] }, endedAt: "2026-11-02T10:01:00Z" }),
    ];
    const { state, rerenderWith } = jobsScreen();
    const side = await waitFor(() => detail("Generate tests job"));
    expect(within(side).getByText("2 tests written", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(within(side).getByRole("button", { name: /Review these tests/ }));
    expect(state.navigate).toHaveBeenCalledWith("review", "local-a");
    rerenderWith({ route: { screen: "jobs", arg: "f1" } });
    const failed = await waitFor(() => detail("Claude fix job"));
    expect(within(failed).getByRole("alert")).toHaveTextContent("The job failed.");
    rerenderWith({ route: { screen: "jobs", arg: "u1" } });
    const odd = await waitFor(() => detail("odd job"));
    expect(within(odd).queryByText(/Same as/)).toBeNull();
    rerenderWith({ route: { screen: "jobs", arg: "e1" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Review these tests/ })).toBeNull());
    rerenderWith({ route: { screen: "tests" } });
    await waitFor(() => expect(detail("Generate tests job")).toBeInTheDocument());
  });

  it("takes the live state of the detailed job, but not a stale running one", async () => {
    server = [job({ id: "a", status: "running" }), job({ id: "b", status: "done", endedAt: "2026-11-02T10:01:00Z" })];
    net.routes["jobs.show"] = (i) => ({
      job: i.id === "a" ? job({ id: "a", status: "done", result: { tests: ["t1"] } }) : job({ id: "b" }),
      events: [{ jobId: i.id, at: "2026-11-02T10:00:01Z", type: "log", level: "info", message: `log of ${i.id}` }],
    });
    const { rerenderWith } = jobsScreen({ route: { screen: "jobs", arg: "a" } });
    const side = await waitFor(() => detail("Generate tests job"));
    await waitFor(() => expect(within(side).getByRole("button", { name: /Review these tests/ })).toBeInTheDocument());
    expect(within(side).getByText("log of a")).toBeInTheDocument();
    rerenderWith({ route: { screen: "jobs", arg: "b" } });
    await waitFor(() => expect(screen.getByText("log of b")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
  });

  it("lists the jobs of the project it is opened on", async () => {
    const { rerenderWith } = jobsScreen();
    await screen.findByText("No job yet");
    const before = callsOf("jobs.list").length;
    setProject("D:\\other");
    rerenderWith({});
    await waitFor(() => expect(callsOf("jobs.list").length).toBeGreaterThan(before));
  });

  it("draws the tree: steps, jobs inside, processes, what went wrong, and filters and clears", async () => {
    const end = "2026-11-02T10:01:00Z";
    server = [
      job({
        id: "add-1",
        kind: "docs.add",
        subject: "/Users/me/spec.pdf",
        steps: [
          {
            id: "convert",
            label: "Copy and convert",
            status: "running",
            done: 3,
            total: 10,
            message: "Page 3",
            jobId: "conv-1",
          },
          { id: "cited", label: "Re-check the tests citing it", status: "waiting" },
        ],
        processes: [
          {
            id: "p1",
            label: "Claude · figures",
            command: "claude -p",
            pid: 77,
            step: "convert",
            startedAt: "2026-11-02T10:00:01Z",
          },
        ],
      }),
      job({ id: "conv-1", kind: "docs.convert", subject: "spec", parentId: "add-1" }),
      job({ id: "chk-1", kind: "check", subject: "t1", status: "done", endedAt: end }),
      job({ id: "chk-2", kind: "check", subject: "t1", status: "done", endedAt: end }),
      job({
        id: "rag-index-0000aaaa",
        kind: "rag-index",
        subject: "index",
        status: "failed",
        endedAt: end,
        error: "Cannot find module 'x/onnxruntime_binding.node'",
        steps: [{ id: "embed", label: "Embed the passages", status: "failed", done: 0, total: 97 }],
        rerun: { name: "rag.index", input: {} },
      }),
      job({
        id: "tri-1",
        kind: "actions.triage",
        subject: "rag-index-0000aaaa",
        status: "done",
        endedAt: end,
        cause: { jobId: "rag-index-0000aaaa", why: "after-failure" },
        result: { summary: "Install the runtime." },
      }),
    ];
    net.routes["jobs.clear"] = () => {
      server = server.filter((j) => j.status === "running");
      return { cleared: 4 };
    };
    net.routes["jobs.rerun"] = () => ({ jobId: "rag-index-0000bbbb" });
    const { state, rerenderWith } = jobsScreen({ route: { screen: "jobs", arg: "add-1" } });
    const side = await waitFor(() => detail("Add document job"));
    const steps = within(side).getByRole("list", { name: "Steps" });
    expect(within(steps).getByText("Copy and convert")).toBeInTheDocument();
    expect(within(steps).getByText("Waiting")).toBeInTheDocument();
    expect(within(steps).getByRole("progressbar", { name: "Copy and convert progress" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
    expect(within(steps).getByText("Claude · figures")).toBeInTheDocument();
    expect(within(side).getByText("Claude is starting.")).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole("button", { name: /Convert document/ }));
    expect(state.navigate).toHaveBeenCalledWith("jobs", "conv-1");
    const names = rows().map((r) => r.textContent ?? "");
    expect(names.some((t) => t.startsWith("Add documentspec.pdf"))).toBe(true);
    expect(names.some((t) => t.includes("Convert document"))).toBe(true);
    expect(names.some((t) => t.includes("Process · claude -p · pid 77"))).toBe(true);
    expect(names.some((t) => t.includes("Check tests×2"))).toBe(true);
    expect(names.some((t) => t.includes("After the failure"))).toBe(true);
    const add = rowOf("Add document");
    expect(add).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(add, { key: "ArrowLeft" });
    await waitFor(() => expect(within(list()).queryByText(/pid 77/)).toBeNull());
    expect(rowOf("Add document")).toHaveAttribute("aria-expanded", "false");
    const checks = within(list()).queryAllByText("Check tests").length;
    fireEvent.keyDown(rowOf("Check tests×2"), { key: "ArrowRight" });
    expect(within(list()).getAllByText("Check tests")).toHaveLength(checks + 1);

    rerenderWith({ route: { screen: "jobs", arg: "rag-index-0000aaaa" } });
    const failed = await waitFor(() => detail("Index documents job"));
    const alert = within(failed).getByRole("alert");
    expect(alert).toHaveTextContent("The search runtime is missing on this machine");
    expect(alert).toHaveTextContent("Step 1 of 1 · Embed the passages · stopped at 0 of 97");
    fireEvent.click(within(alert).getByRole("button", { name: /Technical details/ }));
    expect(within(alert).getByText(/onnxruntime_binding/)).toBeInTheDocument();
    expect(within(failed).getByText("Install the runtime.")).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Open the diagnosis" }));
    expect(state.navigate).toHaveBeenCalledWith("jobs", "tri-1");
    fireEvent.click(within(alert).getByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("jobs", "rag-index-0000bbbb"));
    expect(callsOf("jobs.rerun")[0]?.input).toEqual({ id: "rag-index-0000aaaa" });

    fireEvent.click(within(list()).getByRole("radio", { name: /^Failed/ }));
    expect(within(list()).queryByText("Add document")).toBeNull();
    fireEvent.change(within(list()).getByRole("searchbox", { name: "Filter jobs" }), { target: { value: "zzz" } });
    expect(await within(list()).findByText("No job matches")).toBeInTheDocument();
    fireEvent.click(within(list()).getByRole("button", { name: "Clear the filters" }));
    expect(within(list()).getByText("Add document")).toBeInTheDocument();
    fireEvent.change(within(list()).getByRole("combobox", { name: "Kind" }), { target: { value: "check" } });
    expect(within(list()).queryByText("Add document")).toBeNull();
    fireEvent.click(within(list()).getByRole("switch", { name: "Group repeats" }));
    expect(within(list()).getAllByText("Check tests")).toHaveLength(2);
    expect(readPref("jobsGroup")).toBe(false);

    fireEvent.click(within(list()).getByRole("button", { name: /Clear finished/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Clear 4 finished jobs?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(callsOf("jobs.clear")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(within(list()).queryByText("Check tests")).toBeNull());
  });

  it("heads What Claude did with the run's model and effort, else the project's defaults", async () => {
    const end = "2026-11-02T10:01:00Z";
    const ran = (id: string): JobEvent[] => [
      {
        jobId: id,
        at: end,
        type: "claude",
        event: { type: "result", ok: true, text: "ok", durationMs: 4000, tokens: { input: 18000, output: 640 } },
      },
    ];
    server = [
      job({
        id: "fix-1",
        kind: "fix",
        status: "done",
        endedAt: end,
        rerun: { name: "review.fix", input: { id: "local-1", model: "opus", effort: "high" } },
      }),
      job({ id: "fix-2", kind: "fix", status: "done", endedAt: end, rerun: { name: "review.fix", input: {} } }),
    ];
    net.routes["jobs.show"] = (i) => ({ job: server.find((j) => j.id === i.id), events: ran(String(i.id)) });
    const { rerenderWith } = jobsScreen({ route: { screen: "jobs", arg: "fix-1" } });
    const head = () => within(detail("Claude fix job")).getByRole("button", { name: /What Claude did/ }).parentElement;
    await waitFor(() => expect(head()).toHaveTextContent("opus · high · 0:04 · 18k tokens in · 640 out"));
    rerenderWith({ route: { screen: "jobs", arg: "fix-2" } });
    await waitFor(() => expect(head()).toHaveTextContent("sonnet · medium · 0:04 · 18k tokens in · 640 out"));
  });

  it("reports a clear that fails and keeps the jobs", async () => {
    server = [job({ id: "c1", kind: "check", status: "done", endedAt: "2026-11-02T10:01:00Z" })];
    net.routes["jobs.clear"] = () => {
      throw new Fail("locked");
    };
    jobsScreen();
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(list()).getByRole("button", { name: /Clear finished/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(errors()).toContain("Could not clear the jobs"));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("shows a count without a message, and keeps progress that lands before the list", async () => {
    const gate = deferred();
    net.routes["jobs.list"] = async () => {
      await gate.promise;
      return [job({ id: "g1", progress: { done: 1, total: 3 } })];
    };
    net.routes["jobs.show"] = () => null;
    jobsScreen();
    act(() => FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "early", done: 1, total: 3 }));
    await act(async () => gate.resolve(null));
    expect(await within(list()).findByText("1 of 3")).toBeInTheDocument();
  });

  it("draws each job state", () => {
    render(
      <>
        <JobState job={job({ status: "running" })} now={Date.parse("2026-11-02T10:00:03Z")} />
        <JobState job={job({ status: "cancelled" })} now={0} />
        <JobState job={job({ status: "running" })} now={Date.parse("2026-11-02T10:00:03Z")} timed={false} />
      </>,
    );
    expect(screen.getByText(/Running · 0:03/)).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

describe("Jobs › the design's icons (audit icons 86–92)", () => {
  it("draws each kind with the design's icon: a check, a model download, a measure, a Jira pull", async () => {
    const end = "2026-11-02T10:01:00Z";
    server = [
      job({ id: "c1", kind: "check", status: "done", endedAt: end }),
      job({ id: "m1", kind: "models-pull", subject: "bge-m3", status: "done", endedAt: end }),
      job({ id: "m2", kind: "models-measure", subject: "light", status: "done", endedAt: end }),
      job({ id: "p1", kind: "pull", subject: "LFRPS12-1", status: "done", endedAt: end }),
    ];
    jobsScreen();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(iconsIn(rowOf("Check tests"))[0]).toBe("check-circle");
    expect(iconsIn(rowOf("Download model"))[0]).toBe("drive");
    expect(iconsIn(rowOf("Measure a search pack"))[0]).toBe("cpu");
    expect(iconsIn(rowOf("LFRPS12-1"))[0]).toBe("download");
  });

  it("cancels a running job from its row with a stop button, without opening it", async () => {
    server = [job({ id: "g1" }), job({ id: "d1", kind: "check", status: "done", endedAt: "2026-11-02T10:01:00Z" })];
    net.routes["jobs.cancel"] = () => null;
    const { state } = jobsScreen({ route: { screen: "jobs", arg: "d1" } });
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.pointerEnter(rowOf("Check tests"));
    expect(within(rowOf("Check tests")).queryByRole("button", { name: /^Cancel/ })).toBeNull();
    const running = rowOf("Generate tests");
    fireEvent.pointerEnter(running);
    const stop = within(running).getByRole("button", { name: "Cancel Generate tests" });
    expect(iconsIn(stop)).toEqual(["stop"]);
    fireEvent.click(stop);
    await waitFor(() => expect(callsOf("jobs.cancel")[0]?.input).toEqual({ id: "g1" }));
    expect(state.navigate).not.toHaveBeenCalledWith("jobs", "g1");
  });

  it("marks each changed file as added, modified or deleted, every process of a step with the terminal, and unfolds the log with a chevron", async () => {
    server = [
      job({
        id: "g1",
        status: "done",
        endedAt: "2026-11-02T10:01:00Z",
        steps: [{ id: "read", label: "Read the sources", status: "done" }],
        processes: [
          {
            id: "p1",
            label: "Claude · read and write",
            command: "claude -p",
            step: "read",
            startedAt: "2026-11-02T10:00:01Z",
            endedAt: "2026-11-02T10:00:04Z",
            exit: 0,
          },
        ],
      }),
    ];
    net.routes["jobs.show"] = () => ({
      job: null,
      events: [
        {
          jobId: "g1",
          at: "",
          type: "changed",
          paths: ["tests/local-1/test.md", "tests/local-2/test.md", "tests/local-3/test.md"],
          added: ["tests/local-2/test.md"],
          removed: ["tests/local-3/test.md"],
        },
      ],
    });
    jobsScreen({ route: { screen: "jobs", arg: "g1" } });
    const side = await waitFor(() => detail("Generate tests job"));
    const files = await within(side).findByRole("region", { name: "Files changed · 3" });
    const rows = within(files).getAllByRole("listitem");
    expect(rows.map((li) => [iconsIn(li), li.textContent])).toEqual([
      [["file"], "tests/local-1/test.mdmodified"],
      [["plus"], "tests/local-2/test.mdadded"],
      [["trash"], "tests/local-3/test.mddeleted"],
    ]);
    const procs = within(side).getByRole("list", { name: "Processes of Read the sources" });
    expect(iconsIn(within(procs).getByRole("listitem"))).toEqual(["terminal"]);
    expect(iconsIn(within(side).getByRole("button", { name: "Show the full log" }))).toEqual(["chevron-right"]);
  });
});
