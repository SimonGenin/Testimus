// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, call, commands, events, fileUrl, project, run, setProject, waitJob } from "../../src/ui/api.ts";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "./cov-uishell-helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProject(null);
});

const raw = (status: number, text: string) => vi.fn(async () => new Response(text, { status }));

describe("api reading", () => {
  it("answers null for an empty body and wraps a non-JSON body", async () => {
    vi.stubGlobal("fetch", raw(200, ""));
    expect(await call("system.version")).toBeNull();
    vi.stubGlobal("fetch", raw(200, "plain words"));
    expect(await call("system.version", undefined)).toEqual({ error: "plain words" });
  });

  it("uses the text of a failed non-JSON answer, or the HTTP status", async () => {
    vi.stubGlobal("fetch", raw(502, "Bad gateway"));
    const e = (await call("x.y").catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe("Bad gateway");
    expect(e.status).toBe(502);
    vi.stubGlobal("fetch", raw(500, ""));
    expect(((await call("x.y").catch((x: unknown) => x)) as ApiError).message).toBe("HTTP 500");
    vi.stubGlobal("fetch", raw(500, "null"));
    expect(((await call("x.y").catch((x: unknown) => x)) as ApiError).message).toBe("HTTP 500");
  });

  it("keeps the default ApiError status and fix", () => {
    const e = new ApiError("boom");
    expect(e.status).toBe(0);
    expect(e.fix).toBeUndefined();
  });

  it("reads the command list with the project header", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ project: "D:/p", mock: true, commands: [] })));
    vi.stubGlobal("fetch", f);
    setProject("D:/p");
    expect(project()).toBe("D:/p");
    expect(await commands()).toEqual({ project: "D:/p", mock: true, commands: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api");
    expect((init.headers as Record<string, string>)["X-Testimus-Project"]).toBe("D%3A%2Fp");
    setProject(null);
    await commands();
    const [, init2] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect((init2.headers as Record<string, string>)["X-Testimus-Project"]).toBeUndefined();
  });

  it("builds a file URL without a project", () => {
    expect(fileUrl("docs/a b/doc.md")).toBe("/files/docs/a%20b/doc.md");
  });
});

describe("api events", () => {
  it("does nothing without EventSource", () => {
    vi.stubGlobal("EventSource", undefined);
    const off = events(() => {});
    expect(FakeES.all.size).toBe(0);
    off();
  });

  it("shares one stream, skips bad messages and closes with the last listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = events(a);
    const offB = events(b);
    expect(FakeES.all.size).toBe(1);
    const [es] = [...FakeES.all];
    expect(es.url).toBe("/api/events");
    FakeES.emit("{not json");
    const e = status(job());
    FakeES.emit(e);
    expect(a).toHaveBeenCalledWith(e);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    expect(es.closed).toBe(false);
    offB();
    expect(es.closed).toBe(true);
  });

  it("reconnects two seconds after an error while someone listens", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const off = events(fn);
    const [first] = [...FakeES.all];
    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(FakeES.all.size).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(FakeES.all.size).toBe(1);
    const [second] = [...FakeES.all];
    off();
    expect(second.closed).toBe(true);
    second.onerror?.();
    vi.advanceTimersByTime(5000);
    expect(FakeES.all.size).toBe(0);
  });
});

describe("waitJob and run", () => {
  it("settles on the status event of its own job and passes every event on", async () => {
    let shows = 0;
    net.routes["jobs.show"] = () => {
      shows++;
      return { job: job({ status: "running" }) };
    };
    const seen = vi.fn();
    const p = waitJob<{ tests: string[] }>("j1", seen);
    await vi.waitFor(() => expect(shows).toBe(1));
    FakeES.emit(status(job({ id: "other", status: "done" })));
    FakeES.emit({ jobId: "j1", at: "", type: "progress", message: "Writing" });
    FakeES.emit(status(job({ status: "running" })));
    FakeES.emit(status(job({ status: "done", result: { tests: ["a"] } })));
    FakeES.emit(status(job({ status: "failed" })));
    expect(await p).toEqual({ tests: ["a"] });
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it("rejects a failed or cancelled job with its reason", async () => {
    net.routes["jobs.show"] = () => null;
    const failed = waitJob("j1");
    FakeES.emit(status(job({ status: "failed", error: "Claude is not signed in" })));
    await expect(failed).rejects.toThrow("Claude is not signed in");
    const plain = waitJob("j1");
    FakeES.emit(status(job({ status: "failed" })));
    await expect(plain).rejects.toThrow("The job failed.");
    const cancelled = waitJob("j1");
    FakeES.emit(status(job({ status: "cancelled" })));
    await expect(cancelled).rejects.toThrow("Cancelled.");
  });

  it("is also settled by reading the job back when the stream drops the status", async () => {
    vi.useFakeTimers();
    let n = 0;
    net.routes["jobs.show"] = () => {
      n++;
      if (n === 1) throw new Fail("busy", 500);
      return { job: job({ status: n === 2 ? "running" : "done", result: 42 }) };
    };
    const p = waitJob<number>("j1");
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe(42);
    expect(callsOf("jobs.show")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(callsOf("jobs.show")).toHaveLength(3);
  });

  it("runs a job command: hands the job id over, then waits for its result", async () => {
    net.routes["gen.tests"] = () => ({ jobId: "j7" });
    net.routes["jobs.show"] = () => ({ job: job({ id: "j7", status: "done", result: "ok" }) });
    const started = vi.fn();
    expect(await run("gen.tests", {}, undefined, started)).toBe("ok");
    expect(started).toHaveBeenCalledWith("j7");
    net.routes["x.y"] = () => ({ jobId: 3 });
    expect(await run("x.y", {})).toEqual({ jobId: 3 });
    net.routes["x.z"] = () => null;
    expect(await run("x.z", {})).toBeNull();
  });
});
