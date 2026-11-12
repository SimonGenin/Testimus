// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { Activity, elapsed } from "../../../../src/ui/components/shell/Activity.tsx";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { useRead } from "../../../../src/ui/lib/data/query.ts";
import { callsOf, deferred, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

let jobs: Job[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
  jobs = [];
  net.routes["jobs.list"] = () => jobs.filter((j) => j.status === "running");
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProject(null);
});

// ponytail: the server's list follows the job's status, as the core's does
const emit = (j: Job) => {
  jobs = [...jobs.filter((x) => x.id !== j.id), j];
  FakeES.emit(status(j));
};

// ponytail: a screen reading the Jira folder tree
function JiraTree() {
  useRead("xray.folders", {});
  return null;
}

const rows = () => within(screen.getByRole("dialog", { name: /^Running \d/ })).getAllByRole("listitem");

describe("Activity", () => {
  it("formats the time a job has run", () => {
    const t0 = "2026-11-02T10:00:00.000Z";
    expect(elapsed(t0, Date.parse(t0) + 42_000)).toBe("42 s");
    expect(elapsed(t0, Date.parse(t0) + 125_000)).toBe("2:05");
    expect(elapsed(t0, Date.parse(t0) - 5000)).toBe("0 s");
  });

  it("shows nothing while no job runs, nor outside the data layer", async () => {
    net.routes["jobs.list"] = () => ({ not: "a list" });
    const { container } = withData(<Activity />);
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    expect(container.querySelector("button")).toBeNull();
    cleanup();
    const alone = render(<Activity />);
    expect(alone.container).toBeEmptyDOMElement();
  });

  it("counts the running jobs, follows their events and lists them on click, and cancels one", async () => {
    jobs = [
      job({ id: "a", kind: "pull", subject: "LFRPS12", message: "Reading" }),
      job({ id: "b", kind: "odd", subject: "", startedAt: "2026-11-02T09:00:00.000Z" }),
      job({ id: "z", status: "done" }),
    ];
    net.routes["jobs.cancel"] = (i) => {
      if (i.id === "b") throw new Fail("gone");
      return { cancelled: true };
    };
    withData(<Activity />);
    expect(await screen.findByRole("button", { name: "2 jobs running" })).toBeInTheDocument();
    act(() => emit(job({ id: "c", kind: "generate", subject: "Gen", message: "Starting" })));
    const btn = await screen.findByRole("button", { name: "3 jobs running" });
    fireEvent.click(btn);
    act(() => {
      FakeES.emit({ jobId: "a", at: "", type: "progress", message: "Writing 2", done: 2, total: 8 });
      FakeES.emit({ jobId: "nope", at: "", type: "progress", message: "ignored" });
      FakeES.emit({ jobId: "a", at: "", type: "log", level: "info", message: "ignored" });
    });
    const list = rows();
    expect(list.map((r) => within(r).getByRole("progressbar").getAttribute("aria-label"))).toEqual([
      "odd",
      "LFRPS12",
      "Gen",
    ]);
    expect(list.map((r) => r.getAttribute("data-kind"))).toEqual(["plain", "plain", "claude"]);
    expect(list[1]).toHaveTextContent("Writing 2 · 2/8");
    expect(within(list[1]).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(list[2]).toHaveTextContent("Starting");
    expect(list[2]).toHaveTextContent("Generate tests · Gen");
    expect(within(list[1]).getByTestId("elapsed").textContent).toMatch(/\d/);
    const pop = screen.getByRole("dialog", { name: /^Running 3/ });
    expect(within(pop).getByText("Esc or a click outside closes this")).toBeInTheDocument();
    expect(within(list[2]).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(list[0]).not.toHaveTextContent("Reading");
    fireEvent.click(within(list[1]).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(callsOf("jobs.cancel")[0].input).toEqual({ id: "a" }));
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Could not cancel the job")).toBeInTheDocument();
  });

  it("closes on Escape and when the last job ends", async () => {
    jobs = [job({ id: "a" })];
    withData(<Activity />);
    const btn = await screen.findByRole("button", { name: "1 job running" });
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /^Running \d/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    act(() => emit(job({ id: "a", status: "done" })));
    await waitFor(() => expect(screen.queryByRole("button", { name: /running/ })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never shows a job ended while its list was read, and ticks while open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gate = deferred();
    jobs = [job({ id: "a", startedAt: new Date(Date.now() - 3000).toISOString() }), job({ id: "b" })];
    net.routes["jobs.list"] = async () => {
      const now = jobs.filter((j) => j.status === "running");
      await gate.promise;
      return now;
    };
    withData(<Activity />);
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    act(() => emit(job({ id: "b", status: "done" })));
    await act(async () => gate.resolve(null));
    const btn = await screen.findByRole("button", { name: "1 job running" });
    fireEvent.click(btn);
    const time = () => within(rows()[0]).getByTestId("elapsed").textContent;
    const first = time();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(time()).not.toBe(first);
  });

  it("tones each row by its kind and starts a bar from the job's own progress", async () => {
    jobs = [
      job({ id: "a", kind: "docs.convert", subject: "RS", progress: { done: 1, total: 4 } }),
      job({ id: "b", kind: "models-pull", subject: "bge" }),
    ];
    withData(<Activity />);
    fireEvent.click(await screen.findByRole("button", { name: "2 jobs running" }));
    const list = rows();
    expect(list.map((r) => r.getAttribute("data-kind"))).toEqual(["doc", "plain"]);
    expect(list[0]).toHaveTextContent("1/4");
    expect(list[1]).not.toHaveTextContent("/");
  });

  it("survives a failed list read, and counts the jobs once it reads again", async () => {
    let down = true;
    net.routes["jobs.list"] = () => {
      if (down) throw new Fail("down");
      return jobs.filter((j) => j.status === "running");
    };
    withData(<Activity />);
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /running/ })).toBeNull();
    down = false;
    act(() => emit(job({ id: "a" })));
    expect(await screen.findByRole("button", { name: "1 job running" })).toBeInTheDocument();
  });

  it("shows the Jira reads the page waits on beside the jobs, without Cancel", async () => {
    const load = deferred();
    net.routes["xray.folders"] = () => load.promise;
    withData(
      <>
        <Activity />
        <JiraTree />
      </>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "1 job running" }));
    expect(rows()[0]).toHaveTextContent("Loading the Jira folders");
    expect(rows()[0]).toHaveTextContent("Not a job — it cannot be cancelled");
    expect(within(rows()[0]).queryByRole("button")).toBeNull();
    await act(async () => load.resolve(null));
    expect(screen.queryByRole("button", { name: /running/ })).toBeNull();
  });

  it("says a rate-limit notice beside the indicator", async () => {
    withData(<Activity />);
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    act(() => FakeES.emit({ jobId: "", at: "", type: "notice", message: "Jira asks to wait 30 s" } as never));
    expect(await screen.findByRole("status")).toHaveTextContent("Jira asks to wait 30 s");
    act(() => FakeES.emit({ jobId: "", at: "", type: "notice", message: "" } as never));
    await waitFor(() => expect(screen.queryByText(/Jira asks/)).toBeNull());
  });
  it("counts the jobs inside a batch on its row, opening on the running ones; a silent job says its last sign", async () => {
    const kid = (id: string, o: Partial<Job> = {}) =>
      job({ id, kind: "docs.convert", subject: id, parentId: "imp", startedAt: "2026-11-02T10:00:01.000Z", ...o });
    jobs = [
      job({ id: "imp", kind: "docs.add", subject: "D401-1", label: "D401-1" }),
      kid("k1"),
      kid("k2", { message: "Waiting to convert (5 at a time)" }),
      kid("k3", { status: "done" }),
      job({ id: "q", kind: "pull", subject: "LFRPS12", lastEventAt: new Date(Date.now() - 4 * 60_000).toISOString() }),
    ];
    net.routes["jobs.list"] = (i) => (i.running ? jobs.filter((j) => j.status === "running") : jobs);
    withData(<Activity />);
    fireEvent.click(await screen.findByRole("button", { name: "4 jobs running" }));
    const dialog = screen.getByRole("dialog", { name: /^Running/ });
    const fold = await within(dialog).findByRole("button", { name: /3 conversions: 1 done, 1 running, 1 queued/ });
    expect(within(dialog).queryByRole("button", { name: /k1/ })).toBeNull();
    fireEvent.click(fold);
    expect(await within(dialog).findByRole("button", { name: "Convert document · k1" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Convert document · k2" })).toBeNull();
    expect(within(dialog).getByText("Last sign 4 min ago")).toBeInTheDocument();
  });
});
