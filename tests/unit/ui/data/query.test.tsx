// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallResult, JobCommand } from "../../../../src/core/commands/index.ts";
import type { JobEvent } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { apply, keysOfKind, keysOfPaths } from "../../../../src/ui/lib/data/events.ts";
import {
  createQueryClient,
  execute,
  isReachable,
  key,
  setReachable,
  tuning,
  useCommand,
  useReachable,
  useRead,
} from "../../../../src/ui/lib/data/query.ts";

type Handler = (name: string, input: unknown, project: string | null) => unknown;
let handler: Handler;
let calls: { name: string; input: unknown; project: string | null }[];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  setProject("/p");
  setReachable(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const name = url.replace(/^\/api\//, "").replace("/", ".");
      const header = (init.headers as Record<string, string>)["X-Testimus-Project"];
      const project = header ? decodeURIComponent(header) : null;
      const input = JSON.parse(String(init.body ?? "{}"));
      calls.push({ name, input, project });
      init.signal?.throwIfAborted();
      try {
        return json(200, await handler(name, input, project));
      } catch (e) {
        if (e instanceof TypeError) throw e;
        const err = e as { status?: number; message: string; code?: string };
        return json(err.status ?? 400, { error: err.message, code: err.code });
      }
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(client = createQueryClient()) {
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

function Two() {
  const a = useRead("tests.list");
  const b = useRead("tests.list");
  return <p>{a.data && b.data ? `${(a.data as unknown as { tests: unknown[] }).tests.length} both` : "loading"}</p>;
}

describe("keys", () => {
  it("are [project, command, input], and a machine command has no project", () => {
    expect(key("tests.show", { id: "T1" })).toEqual(["/p", "tests.show", { id: "T1" }]);
    expect(key("tests.list")).toEqual(["/p", "tests.list"]);
    expect(key("claude.status")).toEqual([null, "claude.status"]);
    expect(key("tests.list", undefined, "/other")).toEqual(["/other", "tests.list"]);
  });
});

describe("reads", () => {
  it("cache by key and send one request for identical reads", async () => {
    handler = () => ({ tests: [{ id: "T1" }] });
    const { wrapper } = wrap();
    render(<Two />, { wrapper });
    expect(await screen.findByText("1 both")).toBeInTheDocument();
    expect(calls.filter((c) => c.name === "tests.list")).toHaveLength(1);
    expect(calls[0].project).toBe("/p");
  });

  it("pass their cancel to the request when the reader goes away", async () => {
    let seen: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce(async (_u, init) => {
      seen = (init as RequestInit).signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const { wrapper } = wrap();
    const { unmount } = renderHook(() => useRead("tests.list"), { wrapper });
    await waitFor(() => expect(seen).toBeDefined());
    unmount();
    await waitFor(() => expect(seen?.aborted).toBe(true));
  });

  it("are read again when an event says their file changed, and only those", async () => {
    let n = 0;
    handler = (name, input) => ({ name, input, n: ++n });
    const { client, wrapper } = wrap();
    const t1 = renderHook(() => useRead("tests.show", { id: "T1" }), { wrapper });
    const t2 = renderHook(() => useRead("tests.show", { id: "T2" }), { wrapper });
    await waitFor(() => expect(t1.result.current.data && t2.result.current.data).toBeTruthy());
    const before = calls.length;
    const e: JobEvent = { jobId: "", at: "", type: "changed", paths: ["tests/T1/test.md"], project: "/p" };
    act(() => apply(client, e));
    await waitFor(() => expect(calls.length).toBe(before + 1));
    expect(calls.at(-1)?.input).toEqual({ id: "T1" });
  });

  it("ignore the events of another project", async () => {
    handler = () => ({});
    const { client, wrapper } = wrap();
    const r = renderHook(() => useRead("tests.list"), { wrapper });
    await waitFor(() => expect(r.result.current.data).toBeTruthy());
    const before = calls.length;
    act(() => apply(client, { jobId: "", at: "", type: "changed", paths: ["tests/T1/test.md"], project: "/other" }));
    await new Promise((res) => setTimeout(res, 20));
    expect(calls.length).toBe(before);
  });
});

describe("the event tables", () => {
  it("map a changed path to the reads that show it", () => {
    expect(keysOfPaths(["tests/T1/test.md"])).toContainEqual(["tests.show", { id: "T1" }]);
    expect(keysOfPaths(["docs/D1/doc.json"])).toContainEqual(["docs.show", { id: "D1" }]);
    expect(keysOfPaths(["docs/D1/doc.md"])).toContainEqual(["docs.list"]);
    expect(keysOfPaths(["CLAUDE.md"])).toEqual([["project.notes"]]);
    expect(keysOfPaths(["contexts/c1/context.md"])).toContainEqual(["contexts.list"]);
    expect(keysOfPaths(["somewhere/else.txt"])).toEqual([]);
  });

  it("map a finished job's kind to what it changed outside the files", () => {
    expect(keysOfKind("rag-index")).toContainEqual(["rag.status"]);
    expect(keysOfKind("models-pull")).toContainEqual(["models.list"]);
    expect(keysOfKind("docs.convert")).toContainEqual(["docs.list"]);
    expect(keysOfKind("describe-figures")).toContainEqual(["docs.show"]);
    expect(keysOfKind("unknown")).toEqual([]);
  });
});

describe("commands", () => {
  it("re-read the project once they succeeded", async () => {
    let n = 0;
    handler = (name) => (name === "tests.list" ? { n: ++n } : { ok: true });
    const { wrapper } = wrap();
    const r = renderHook(() => ({ list: useRead("tests.list"), save: useCommand("review.set") }), { wrapper });
    await waitFor(() => expect(r.result.current.list.data).toEqual({ n: 1 }));
    await act(() => r.result.current.save.mutateAsync({ id: "T1", review: "validated" } as never));
    await waitFor(() => expect(r.result.current.list.data).toEqual({ n: 2 }));
  });

  it("apply an optimistic change and put it back when the call fails", async () => {
    handler = (name) => {
      if (name === "tests.remove") throw Object.assign(new Error("refused"), { status: 400 });
      return { tests: [{ id: "T1" }, { id: "T2" }] };
    };
    const { client, wrapper } = wrap();
    const r = renderHook(() => useRead("tests.list"), { wrapper });
    await waitFor(() => expect(r.result.current.data).toBeTruthy());
    const k = key("tests.list");
    let during: unknown;
    await expect(
      execute(client, "tests.remove", { id: "T1" } as never, {
        invalidates: "none",
        optimistic: (c) => {
          const before = c.getQueryData(k);
          c.setQueryData(k, { tests: [{ id: "T2" }] });
          during = c.getQueryData(k);
          return () => c.setQueryData(k, before);
        },
      }),
    ).rejects.toThrow("refused");
    expect(during).toEqual({ tests: [{ id: "T2" }] });
    expect(client.getQueryData(k)).toEqual({ tests: [{ id: "T1" }, { id: "T2" }] });
  });
});

describe("the server", () => {
  it("is unreachable when a request cannot reach it, and back when one answers", async () => {
    handler = () => {
      throw new TypeError("Failed to fetch");
    };
    const { client, wrapper } = wrap();
    const seen = renderHook(() => useReachable(), { wrapper });
    await expect(execute(client, "tests.list", {} as never, { invalidates: "none" })).rejects.toThrow();
    expect(isReachable()).toBe(false);
    expect(seen.result.current).toBe(false);
    handler = () => ({});
    await execute(client, "tests.list", {} as never, { invalidates: "none" });
    expect(isReachable()).toBe(true);
    await waitFor(() => expect(seen.result.current).toBe(true));
  });
});

describe("call results", () => {
  it("a command that runs as a job answers with its id, any other with its output (types)", () => {
    const job: JobCommand = "rag.index";
    // @ts-expect-error tests.list does not run as a job
    const notJob: JobCommand = "tests.list";
    const started: CallResult<"rag.index"> = { jobId: "rag-index-1" };
    expect([job, notJob, started.jobId]).toEqual(["rag.index", "tests.list", "rag-index-1"]);
  });

  it("keeps a read until the events say otherwise, but never a plan", () => {
    expect(tuning("docs.list")).toEqual({ staleTime: Number.POSITIVE_INFINITY, gcTime: 5 * 60_000 });
    expect(tuning("models.planPack")).toEqual({ staleTime: 0, gcTime: 0 });
    expect(tuning("xray.plan")).toEqual({ staleTime: 0, gcTime: 0 });
    expect(tuning("docs.remove", { dryRun: true })).toEqual({ staleTime: 0, gcTime: 0 });
  });
});
