// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { Toasts } from "../../src/ui/components/legacy/index.ts";
import type { AppState } from "../../src/ui/lib/app.ts";
import { resetDoctor } from "../../src/ui/lib/doctor.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { DoctorScreen } from "../../src/ui/screens/doctor/DoctorScreen.tsx";
import { JobState, JobsScreen } from "../../src/ui/screens/jobs/JobsScreen.tsx";
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
} from "./cov-uishell-helpers.tsx";
import { app, fakeDesktop, noDesktop } from "./ui-desktop-helpers.tsx";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["jobs.show"] = (i) => ({ job: null, events: [], id: i.id });
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProject(null);
});

const jobsScreen = (over: Partial<AppState> = {}) =>
  withApp(
    <>
      <JobsScreen />
      <Probe />
    </>,
    { route: { screen: "jobs" }, ...over },
  );

const list = () => screen.getByRole("region", { name: "Job list" });
const detail = (name: string) => screen.getByRole("complementary", { name });

describe("Jobs screen", () => {
  it("shows the skeleton, then says when there is no job yet", async () => {
    const gate = deferred();
    net.routes["jobs.list"] = async () => {
      await gate.promise;
      return { not: "an array" };
    };
    jobsScreen();
    expect(within(list()).getByRole("table")).toHaveAttribute("aria-busy", "true");
    act(() => FakeES.emit(status(job())));
    await act(async () => gate.resolve(null));
    expect(await screen.findByText("No job yet")).toBeInTheDocument();
  });

  it("says when the jobs cannot be listed", async () => {
    net.routes["jobs.list"] = () => {
      throw new Fail("core down");
    };
    jobsScreen();
    expect(await screen.findByText("Could not list the jobs")).toBeInTheDocument();
    expect(screen.getByText("No job yet")).toBeInTheDocument();
  });

  it("lists the jobs, follows their events and opens one", async () => {
    net.routes["jobs.list"] = () => [
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
    expect(
      await screen.findByText("1 running · long work runs here, you can keep working meanwhile"),
    ).toBeInTheDocument();
    const jobRows = () =>
      within(list())
        .getAllByRole("row")
        .filter((r) => r.hasAttribute("aria-selected"));
    const rows = jobRows();
    expect(rows).toHaveLength(4);
    expect(within(list()).getByRole("columnheader", { name: /^Running · 1$/ })).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(within(rows[0]).getByRole("progressbar", { name: "Generate tests progress" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(within(rows[0]).getByText("Writing 1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("2 of 2")).toBeInTheDocument();
    expect(within(rows[1]).getByText("0:09")).toBeInTheDocument();
    expect(within(rows[2]).getByText("—")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Cancelled")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Failed")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Claude stopped")).toBeInTheDocument();
    act(() => {
      FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "Writing 2", done: 2, total: 4 });
      FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "Still writing" });
      FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "No count", total: 5 });
      FakeES.emit({ jobId: "g1", at: "", type: "log", level: "info", message: "ignored" });
      FakeES.emit(status(job({ id: "n1", kind: "pull" })));
      FakeES.emit(status(job({ id: "c1", kind: "check", status: "done", result: { tests: [] } })));
    });
    const now = jobRows();
    expect(now).toHaveLength(5);
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

  it("ticks the running durations every second", async () => {
    net.routes["jobs.list"] = () => [job({ id: "g1", startedAt: new Date(Date.now() - 5000).toISOString() })];
    jobsScreen();
    const row = await screen.findByText("Generate tests", { selector: "td div" });
    const cell = () => (row.closest("tr") as HTMLElement).querySelector("td.jt-time .mono")?.textContent;
    const first = cell();
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    expect(cell()).not.toBe(first);
  });

  it("details a running job: progress, message, cancel and its CLI", async () => {
    net.routes["jobs.list"] = () => [job({ id: "r1", kind: "rag-index", message: "Embedding" })];
    let cancels = 0;
    net.routes["jobs.cancel"] = () => {
      cancels++;
      if (cancels > 1) throw new Fail("already done");
      return null;
    };
    jobsScreen({ route: { screen: "jobs", arg: "r1" } });
    const side = await waitFor(() => detail("Index documents job"));
    expect(within(side).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(within(side).getByText("Embedding")).toBeInTheDocument();
    expect(within(side).getByText("testimus rag index")).toBeInTheDocument();
    fireEvent.click(within(side).getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(callsOf("jobs.cancel")).toHaveLength(1));
    fireEvent.click(within(side).getByRole("button", { name: /Cancel/ }));
    expect(await screen.findByText("Could not cancel the job")).toBeInTheDocument();
  });

  it("details a finished generation with a way to review it, and a failure with what to do", async () => {
    net.routes["jobs.list"] = () => [
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
    net.routes["jobs.list"] = () => [
      job({ id: "a", status: "running" }),
      job({ id: "b", status: "done", endedAt: "2026-11-02T10:01:00Z" }),
    ];
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

  it("lists the jobs again when the project changes", async () => {
    net.routes["jobs.list"] = () => [];
    const { rerenderWith } = jobsScreen();
    await waitFor(() => expect(callsOf("jobs.list").filter((c) => !c.input?.running)).toHaveLength(1));
    const base = app().info as NonNullable<AppState["info"]>;
    rerenderWith({ info: { ...base, dir: "D:\\other" } });
    await waitFor(() => expect(callsOf("jobs.list").filter((c) => !c.input?.running)).toHaveLength(2));
  });

  it("draws the tree: steps, jobs inside, processes, what went wrong, and filters and clears", async () => {
    const end = "2026-11-02T10:01:00Z";
    net.routes["jobs.list"] = () => [
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
    net.routes["jobs.clear"] = () => ({ cleared: 4 });
    net.routes["rag.index"] = () => ({ jobId: "rag-index-0000bbbb" });
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
    fireEvent.click(within(steps).getByRole("button", { name: /Convert document/ }));
    expect(state.navigate).toHaveBeenCalledWith("jobs", "conv-1");
    const rows = within(list()).getAllByRole("row");
    const names = rows.map((r) => r.textContent ?? "");
    expect(names.some((t) => t.startsWith("Add documentspec.pdf"))).toBe(true);
    expect(names.some((t) => t.includes("Convert document"))).toBe(true);
    expect(names.some((t) => t.includes("Process · claude -p · pid 77"))).toBe(true);
    expect(names.some((t) => t.includes("Check tests×2"))).toBe(true);
    expect(names.some((t) => t.includes("After the failure"))).toBe(true);
    fireEvent.click(within(list()).getByRole("button", { name: "Collapse Add document" }));
    expect(within(list()).queryByText(/pid 77/)).toBeNull();
    const checks = within(list()).queryAllByText("Check tests").length;
    fireEvent.click(within(list()).getByRole("button", { name: "Expand Check tests ×2" }));
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

    fireEvent.click(within(list()).getByRole("button", { name: /^Failed/ }));
    expect(within(list()).queryByText("Add document")).toBeNull();
    fireEvent.change(within(list()).getByRole("textbox", { name: "Filter jobs" }), { target: { value: "zzz" } });
    expect(await within(list()).findByText("No job matches")).toBeInTheDocument();
    fireEvent.click(within(list()).getByRole("button", { name: "Clear the filters" }));
    expect(within(list()).getByText("Add document")).toBeInTheDocument();
    fireEvent.change(within(list()).getByRole("combobox"), { target: { value: "check" } });
    expect(within(list()).queryByText("Add document")).toBeNull();
    fireEvent.click(within(list()).getByRole("checkbox", { name: "Group repeats" }));
    expect(within(list()).getAllByText("Check tests")).toHaveLength(2);

    fireEvent.click(within(list()).getByRole("button", { name: /Clear finished/ }));
    const dialog = await screen.findByRole("dialog", { name: "Clear 4 finished jobs?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(callsOf("jobs.clear")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("draws each job state", () => {
    render(
      <>
        <JobState job={job({ status: "running" })} now={Date.parse("2026-11-02T10:00:03Z")} />
        <JobState job={job({ status: "cancelled" })} now={0} />
      </>,
    );
    expect(screen.getByText(/Running · 0:03/)).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});

describe("System check screen", () => {
  beforeEach(() => resetDoctor());

  const c = (o: Partial<DoctorCheck>): DoctorCheck => ({ id: "x", label: "X", state: "ok", detail: "d", ...o });

  it("shows info, skipped and open checks, re-runs, and reports a failed run", async () => {
    let fail = false;
    net.routes["system.doctor"] = () => {
      if (fail) throw new Fail("core down");
      return [
        c({ id: "proxy", label: "Proxy", detail: "none" }),
        c({ id: "ollama", label: "Ollama", state: "skip", detail: "not used", fix: "install it" }),
        c({ id: "skipped", label: "Other", state: "skip", detail: "n/a" }),
        c({ id: "jira", label: "Jira", state: "fail", detail: "401" }),
        c({ id: "claudeLogin", label: "Claude signed in", state: "ok", detail: "yes" }),
      ];
    };
    withApp(<DoctorScreen />);
    expect(screen.getByRole("list", { name: "Checks" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    const rows = await screen.findAllByRole("listitem");
    await waitFor(() => expect(screen.getByText("Proxy")).toBeInTheDocument());
    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(screen.getByText("not used — install it")).toBeInTheDocument();
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.queryByText(/What to do/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Check Claude sign-in" })).toBeNull();
    expect(screen.getByText(/Last checked at/)).toBeInTheDocument();
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    expect(await screen.findByText("The check could not run: core down")).toBeInTheDocument();
  });

  it("turns each fix into a button: runs the command, opens the settings or the folder dialog", async () => {
    let verifyFails = false;
    net.routes["models.verify"] = () => {
      if (verifyFails) throw new Fail("broken model");
      return { ok: true };
    };
    net.routes["models.add"] = () => ({ model: "m" });
    net.routes["models.hardware"] = () => ({ drives: [] });
    net.routes["system.doctor"] = () => [
      c({
        id: "model.embedding",
        label: "Embedding model",
        state: "warn",
        detail: "not verified",
        fix: "testimus models verify m",
        action: { label: "Verify", command: "models.verify", input: { model: "m" } },
      }),
      c({ id: "jira", state: "fail", detail: "401", action: { label: "Connect Atlassian", command: "system.setup" } }),
      c({ id: "model.fit", state: "warn", action: { label: "Choose a lighter pack", command: "models.usePack" } }),
      c({ id: "models.dir", state: "warn", action: { label: "Choose the models folder…", command: "models.setDir" } }),
      c({
        id: "model.reranker",
        state: "warn",
        action: { label: "Add from a folder…", command: "models.add", input: { kind: "x" } },
      }),
    ];
    const { state } = withApp(
      <>
        <DoctorScreen />
        <Probe />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));
    expect(screen.queryByText(/What to do/)).toBeNull();
    await waitFor(() => expect(callsOf("models.verify")[0]?.input).toEqual({ model: "m" }));
    expect(await screen.findByText("Embedding model: done")).toBeInTheDocument();
    verifyFails = true;
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Verify failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Atlassian" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "access");
    fireEvent.click(screen.getByRole("button", { name: "Choose a lighter pack" }));
    expect(state.navigate).toHaveBeenCalledWith("settings", "models");
    noDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Add from a folder…" }));
    expect(state.navigate).toHaveBeenCalledTimes(3);
    const d = fakeDesktop({ folder: "E:\\share\\model" });
    fireEvent.click(screen.getByRole("button", { name: "Add from a folder…" }));
    await waitFor(() => expect(callsOf("models.add")[0]?.input).toEqual({ kind: "x", path: "E:\\share\\model" }));
    expect(d.pickFolder).toHaveBeenCalled();
    d.pickFolder.mockResolvedValueOnce(null);
    fireEvent.click(await screen.findByRole("button", { name: "Add from a folder…" }));
    await waitFor(() => expect(d.pickFolder).toHaveBeenCalledTimes(2));
    expect(callsOf("models.add")).toHaveLength(1);
    noDesktop();
    fireEvent.click(screen.getByRole("button", { name: "Choose the models folder…" }));
    expect(await screen.findByRole("dialog", { name: "Models folder" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
