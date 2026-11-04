// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { JobLog, useJob } from "../../../../src/ui/components/shell/JobLog.tsx";
import { callsOf, deferred, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "../../cov-uishell-helpers.tsx";
import { noDesktop } from "../../ui-desktop-helpers.tsx";
import { clearAllToasts } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  document.title = "";
});

const at = (s: number) => `2026-11-02T10:00:${String(s).padStart(2, "0")}.000Z`;
const prog = (message: string, s: number, jobId = "j1"): JobEvent => ({ jobId, at: at(s), type: "progress", message });

function JobProbe({ id }: { id: string | null }) {
  const r = useJob(id);
  return (
    <div>
      <span data-testid="status">{r.job?.status ?? "none"}</span>
      <span data-testid="error">{r.error}</span>
      <span data-testid="events">{r.events.map((e) => (e.type === "progress" ? e.message : e.type)).join(",")}</span>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

describe("useJob", () => {
  it("does nothing without a job", () => {
    render(<JobProbe id={null} />);
    expect(text("status")).toBe("none");
    expect(callsOf("jobs.show")).toHaveLength(0);
  });

  it("merges the events seen before the log was read, then follows the stream", async () => {
    const gate = deferred();
    net.routes["jobs.show"] = async () => {
      await gate.promise;
      return { job: job(), events: [prog("a", 1), prog("b", 2)] };
    };
    render(<JobProbe id="j1" />);
    act(() => {
      FakeES.emit(prog("b", 2));
      FakeES.emit(prog("c", 3));
      FakeES.emit(prog("other", 3, "j2"));
    });
    await act(async () => gate.resolve(null));
    await waitFor(() => expect(text("events")).toMatch(/^a,b/));
    expect(text("status")).toBe("running");
    act(() => FakeES.emit(prog("d", 4)));
    expect(text("events")).toMatch(/^a,b,(c,)?d$/);
    act(() => FakeES.emit(status(job({ status: "done" }), at(5))));
    expect(text("status")).toBe("done");
    expect(text("events")).toMatch(/^a,b,(c,)?d,status$/);
  });

  it("reads a running job back now and then, keeping the longer log and a finished status", async () => {
    vi.useFakeTimers();
    let n = 0;
    net.routes["jobs.show"] = () => {
      n++;
      if (n === 1) return { job: job(), events: [prog("a", 1)] };
      if (n === 2) return { job: job(), events: [prog("a", 1), prog("b", 2), prog("c", 3)] };
      return { events: [] };
    };
    render(<JobProbe id="j1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(text("events")).toBe("a");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(text("events")).toBe("a,b,c");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(text("events")).toBe("a,b,c");
    act(() => FakeES.emit(status(job({ status: "failed" }))));
    expect(text("status")).toBe("failed");
    const before = n;
    await act(() => vi.advanceTimersByTimeAsync(4500));
    expect(n).toBe(before);
  });

  it("keeps a finished status from the stream when an older read lands", async () => {
    const gate = deferred();
    net.routes["jobs.show"] = async () => {
      await gate.promise;
      return { job: job(), events: [] };
    };
    render(<JobProbe id="j1" />);
    act(() => FakeES.emit(status(job({ status: "done" }))));
    await act(async () => gate.resolve(null));
    await waitFor(() => expect(callsOf("jobs.show")).toHaveLength(1));
    await act(async () => {});
    expect(text("status")).toBe("done");
  });

  it("says why the log could not be read, and ignores answers after unmount", async () => {
    net.routes["jobs.show"] = () => {
      throw new Fail("no such job");
    };
    const { unmount } = render(<JobProbe id="gone" />);
    await waitFor(() => expect(text("error")).toBe("no such job"));
    unmount();
    const gate = deferred();
    net.routes["jobs.show"] = async () => {
      await gate.promise;
      return { job: job(), events: [] };
    };
    const second = render(<JobProbe id="j1" />);
    second.unmount();
    await act(async () => gate.resolve(null));
    vi.stubGlobal("fetch", () => Promise.reject("offline"));
    render(<JobProbe id="j2" />);
    await waitFor(() => expect(text("error")).toBe("offline"));
  });
});

describe("JobLog", () => {
  it("shows an empty log, colours warnings and errors, and sticks to the bottom until scrolled up", () => {
    const { rerender } = render(<JobLog events={[]} />);
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
    const log = screen.getByRole("log", { name: "Live log" });
    Object.defineProperty(log, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(log, "clientHeight", { value: 100, configurable: true });
    const events: JobEvent[] = [
      { jobId: "j1", at: at(1), type: "log", level: "warn", message: "slow" },
      { jobId: "j1", at: at(2), type: "log", level: "error", message: "broken" },
    ];
    rerender(<JobLog events={events} label="Import log" />);
    expect(screen.getByText("slow").parentElement ?? screen.getByText("slow")).toBeInTheDocument();
    expect(document.querySelector("[data-level=warn]")).toHaveTextContent("slow");
    expect(document.querySelector("[data-level=error]")).toHaveTextContent("broken");
    expect(log.scrollTop).toBe(500);
    log.scrollTop = 0;
    fireEvent.scroll(log);
    rerender(<JobLog events={[...events, { jobId: "j1", at: at(3), type: "log", level: "info", message: "more" }]} />);
    expect(log.scrollTop).toBe(0);
  });
});
