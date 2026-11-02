// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorCheck, Passage } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { PassageDialog } from "../../src/ui/components/sources/PassageDialog.tsx";
import { Toasts } from "../../src/ui/components/ui/index.ts";
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
import { app } from "./ui-desktop-helpers.tsx";

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
    const rows = within(list()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
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
    expect(within(rows[3]).getByText("Failed · Claude stopped")).toBeInTheDocument();
    act(() => {
      FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "Writing 2", done: 2, total: 4 });
      FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "Still writing" });
      FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "No count", total: 5 });
      FakeES.emit({ jobId: "g1", at: "", type: "log", level: "info", message: "ignored" });
      FakeES.emit(status(job({ id: "n1", kind: "pull" })));
      FakeES.emit(status(job({ id: "c1", kind: "check", status: "done", result: { tests: [] } })));
    });
    const now = within(list()).getAllByRole("row").slice(1);
    expect(now).toHaveLength(5);
    expect(within(now[0]).getByText("Pull from Jira")).toBeInTheDocument();
    expect(within(now[1]).getByText("No count")).toBeInTheDocument();
    expect(within(now[1]).getByRole("progressbar", { name: "Generate tests progress" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(within(now[3]).getByText("Done · 0 with findings")).toBeInTheDocument();
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
    const cell = () => (row.closest("tr") as HTMLElement).querySelector("td.mono")?.textContent;
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
});

describe("Passage dialog", () => {
  const passage: Passage = {
    docId: "D",
    anchor: "§1",
    path: "Ch 1 > Menus",
    title: "Menus",
    text: "Le menu ne propose que Propriétés.",
    figures: [],
    doc: { code: "SOSIE_211", title: "Spécification", version: "3", status: "validated", binding: "mandatory" },
  };

  it("loads the passage, highlights the quote and opens it in its document", async () => {
    const gate = deferred();
    net.routes["rag.passage"] = async () => {
      await gate.promise;
      return passage;
    };
    const close = vi.fn();
    const open = vi.fn();
    render(
      <PassageDialog source={{ docId: "D", anchor: "§1", quote: "Propriétés" }} onClose={close} onOpenDoc={open} />,
    );
    expect(screen.getByRole("status", { name: "Loading the passage" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Source D §1" })).toHaveTextContent("D · §1");
    await act(async () => gate.resolve(null));
    expect(await screen.findByText("Spécification")).toBeInTheDocument();
    expect(screen.getByText("SOSIE_211 · v3 · §1")).toBeInTheDocument();
    expect(callsOf("rag.passage")[0].input).toEqual({ ref: "D#§1" });
    fireEvent.click(screen.getByRole("button", { name: /Open in document/ }));
    expect(open).toHaveBeenCalledWith("D", "§1");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
  });

  it("says why the passage cannot be shown, with the quote, and needs no document button", async () => {
    net.routes["rag.passage"] = () => {
      throw new Fail("No index yet");
    };
    render(<PassageDialog source={{ docId: "D", anchor: "§9", quote: "la phrase" }} onClose={() => {}} />);
    expect(await screen.findByText("This passage could not be shown: No index yet")).toBeInTheDocument();
    expect(screen.getByText("« la phrase »")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open in document/ })).toBeNull();
    cleanup();
    render(<PassageDialog source={{ docId: "D", anchor: "§9", quote: "" }} onClose={() => {}} />);
    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    expect(document.querySelector(".q")).toBeNull();
  });

  it("drops an answer that lands after it closed", async () => {
    const ok = deferred();
    const ko = deferred();
    let n = 0;
    net.routes["rag.passage"] = async () => {
      n++;
      if (n === 1) {
        await ok.promise;
        return passage;
      }
      await ko.promise;
      throw new Fail("late");
    };
    const a = render(<PassageDialog source={{ docId: "D", anchor: "§1", quote: "" }} onClose={() => {}} />);
    a.unmount();
    const b = render(<PassageDialog source={{ docId: "D", anchor: "§2", quote: "" }} onClose={() => {}} />);
    b.unmount();
    await act(async () => {
      ok.resolve(null);
      ko.resolve(null);
    });
    expect(n).toBe(2);
  });
});
