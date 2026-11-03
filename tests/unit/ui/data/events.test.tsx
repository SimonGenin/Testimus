// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { connectEvents, onAnyEvent, useJobEvents } from "../../../../src/ui/lib/data/events.ts";
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
});
