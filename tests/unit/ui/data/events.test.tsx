// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { apply, applyJobEvent, connectEvents, onAnyEvent, useJobEvents } from "../../../../src/ui/lib/data/events.ts";
import { createQueryClient, isReachable, setReachable, useRead } from "../../../../src/ui/lib/data/query.ts";

class FakeSource {
  static last: FakeSource | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.last = this;
  }
  close() {
    this.closed = true;
  }
  send(e: JobEvent) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
}

let reads = 0;

beforeEach(() => {
  reads = 0;
  setProject("/p");
  setReachable(true);
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      reads++;
      return new Response(JSON.stringify({ reads }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const job = (status: Job["status"], kind = "rag-index"): Job => ({ id: "j1", kind, subject: "s", status }) as Job;

describe("the event bridge", () => {
  it("opens one stream, re-reads what a finished job touched, and hands each event to its job's listeners", async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stop = connectEvents(client);
    const src = FakeSource.last as FakeSource;
    const seen: string[] = [];
    const r = renderHook(
      () => {
        useJobEvents("j1", (e) => seen.push(e.type));
        return useRead("rag.status");
      },
      { wrapper },
    );
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 1 }));
    act(() => src.send({ jobId: "j1", at: "", type: "progress", message: "half", project: "/p" }));
    expect(seen).toEqual(["progress"]);
    act(() => src.send({ jobId: "j1", at: "", type: "status", job: job("done"), project: "/p" }));
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 2 }));
    expect(seen).toEqual(["progress", "status"]);
    stop();
    expect(src.closed).toBe(true);
  });

  it("says the server is unreachable when the stream drops, and re-reads everything shown when it comes back", async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stop = connectEvents(client);
    const first = FakeSource.last as FakeSource;
    const r = renderHook(() => useRead("tests.list"), { wrapper });
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 1 }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => first.onerror?.());
    expect(isReachable()).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    vi.useRealTimers();
    const second = FakeSource.last as FakeSource;
    expect(second).not.toBe(first);
    act(() => second.onopen?.());
    expect(isReachable()).toBe(true);
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 2 }));
    stop();
  });

  it("a read not shown while the stream was down is read again when a screen shows it after the reopen", async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stop = connectEvents(client);
    const first = FakeSource.last as FakeSource;
    client.setQueryData(["/p", "docs.list"], ["before the drop"]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => first.onerror?.());
    await act(() => vi.advanceTimersByTimeAsync(2000));
    vi.useRealTimers();
    act(() => (FakeSource.last as FakeSource).onopen?.());
    const r = renderHook(() => useRead("docs.list"), { wrapper });
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 1 }));
    stop();
  });

  it("drops the reads of a project the window leaves, so coming back reads it again (a switch drops the caches)", async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const stop = connectEvents(client);
    const src = FakeSource.last as FakeSource;
    const r = renderHook(() => useRead("jobs.list", { running: true }), { wrapper });
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 1 }));
    client.setQueryData(["/p", "docs.list"], ["old"]);
    client.setQueryData([null, "project.list"], ["machine"]);
    act(() => setProject("/other"));
    r.rerender();
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 2 }));
    expect(client.getQueryData(["/p", "docs.list"])).toBeUndefined();
    expect(client.getQueryData([null, "project.list"])).toEqual(["machine"]);
    act(() => src.send({ jobId: "j1", at: "", type: "status", job: job("done"), project: "/p" }));
    act(() => setProject("/p"));
    r.rerender();
    await waitFor(() => expect(r.result.current.data).toEqual({ reads: 3 }));
    stop();
  });

  it("lets a listener follow every event of the page's project", () => {
    const client = createQueryClient();
    const stop = connectEvents(client);
    const src = FakeSource.last as FakeSource;
    const all: string[] = [];
    const off = onAnyEvent((e) => all.push(`${e.type}:${e.project}`));
    src.send({ jobId: "", at: "", type: "notice", message: "429", project: null });
    src.send({ jobId: "x", at: "", type: "log", level: "info", message: "m", project: "/elsewhere" });
    expect(all).toEqual(["notice:null"]);
    expect(client.getQueryData(["notice"])).toBe("429");
    off();
    stop();
  });

  it("keeps the jobs list and a job's page live from its events, without reading again", () => {
    const client = createQueryClient();
    const run = { ...job("running"), steps: [{ id: "a", label: "A", status: "running" }] } as Job;
    client.setQueryData(["/p", "jobs.list", {}], [run]);
    client.setQueryData(["/p", "jobs.list", { running: true }], [run]);
    client.setQueryData(["/p", "jobs.show", { id: "j1" }], { job: run, events: [] });
    const send = (e: Record<string, unknown>) => apply(client, { jobId: "j1", at: "", ...e } as JobEvent, "/p");
    send({ type: "progress", message: "half", done: 1, total: 2, step: "a" });
    send({ type: "steps", steps: [{ id: "a", label: "A", status: "done" }] });
    send({ type: "process", process: { id: "p1", label: "llama", pid: 9 } } as never);
    const listed = client.getQueryData<Job[]>(["/p", "jobs.list", {}])?.[0];
    expect(listed).toMatchObject({ message: "half", progress: { done: 1, total: 2 }, steps: [{ status: "done" }] });
    expect(listed?.processes).toHaveLength(1);
    const shown = client.getQueryData<{ job: Job; events: JobEvent[] }>(["/p", "jobs.show", { id: "j1" }]);
    expect(shown?.events.map((e) => e.type)).toEqual(["progress", "steps", "process"]);
    expect(shown?.job.message).toBe("half");
    send({ type: "status", job: { ...run, id: "j2" } });
    expect(client.getQueryData<Job[]>(["/p", "jobs.list", {}])?.map((j) => j.id)).toEqual(["j2", "j1"]);
    expect(reads).toBe(0);
  });

  it("applies an event to a list of jobs: a new job on top, an unknown event leaves the list", () => {
    const a = job("running");
    expect(applyJobEvent([a], { jobId: "j1", at: "", type: "status", job: { ...a, status: "done" } })[0].status).toBe(
      "done",
    );
    expect(applyJobEvent([a], { jobId: "j1", at: "", type: "progress", message: "m" })[0].progress).toBeUndefined();
    const same = [a];
    expect(applyJobEvent(same, { jobId: "j1", at: "", type: "log", level: "info", message: "x" })).toBe(same);
  });
});
