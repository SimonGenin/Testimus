import type { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply =
  | { status?: number; headers?: Record<string, unknown>; text?: string }
  | "timeout"
  | ((req: FakeReq) => void);
type FakeReq = EventEmitter & {
  url: string;
  opts: { method?: string; headers?: Record<string, string>; timeout?: number };
  written: string[];
  write(s: string): void;
  end(): void;
  destroy(e?: Error): void;
};

const h = vi.hoisted(() => ({
  replies: [] as unknown[],
  requests: [] as unknown[],
  spawned: [] as unknown[],
  spawnSync: vi.fn(),
  killTree: vi.fn(async () => {}),
  pid: undefined as number | undefined,
  child: null as unknown,
}));

vi.mock("node:http", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    request: (url: string, opts: FakeReq["opts"], cb: (res: unknown) => void) => {
      const req = new Emitter() as FakeReq;
      req.url = url;
      req.opts = opts;
      req.written = [];
      req.write = (s: string) => {
        req.written.push(s);
      };
      req.destroy = (e?: Error) => {
        queueMicrotask(() => req.emit("error", e ?? new Error("socket hang up")));
      };
      req.end = () => {
        const reply = (h.replies.shift() ?? {}) as Reply;
        queueMicrotask(() => {
          if (reply === "timeout") return req.emit("timeout");
          if (typeof reply === "function") return reply(req);
          const res = new Emitter() as EventEmitter & {
            statusCode?: number;
            headers: Record<string, unknown>;
            resume(): void;
          };
          res.statusCode = reply.status;
          res.headers = reply.headers ?? {};
          res.resume = () => {};
          cb(res);
          if (reply.text) res.emit("data", Buffer.from(reply.text));
          res.emit("end");
        });
      };
      h.requests.push(req);
      return req;
    },
  };
});

vi.mock("node:child_process", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    spawn: (command: string, args: string[], opts: unknown) => {
      const child = Object.assign(new Emitter(), {
        stdout: null,
        stderr: null,
        stdin: null,
        pid: h.pid,
        exitCode: null,
        signalCode: null,
      });
      h.spawned.push({ command, args, opts });
      h.child = child;
      return child;
    },
    spawnSync: h.spawnSync,
  };
});

vi.mock("../../../src/shared/run/process.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/shared/run/process.ts")>()),
  killTree: h.killTree,
}));

// ponytail: the setup file already loaded src/shared/run/process.ts (through env.ts), before the child_process mock
vi.resetModules();
const core = await import("../../../src/desktop/core.ts");

const reqs = () => h.requests as FakeReq[];
const json = (v: unknown, status = 200) => ({ status, text: JSON.stringify(v) });

beforeEach(() => {
  vi.stubEnv("LOCALAPPDATA", mkdtempSync(join(tmpdir(), "testimus-cov-fakes-")));
  h.replies.length = 0;
  h.requests.length = 0;
  h.spawned.length = 0;
  h.spawnSync.mockReset();
  h.killTree.mockClear();
  h.pid = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const onPlatform = (platform: string, run: () => void) => {
  const d = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  try {
    run();
  } finally {
    if (d) Object.defineProperty(process, "platform", d);
  }
};

describe("http edge cases", () => {
  it("gives status 0 when the answer has none, and no body when there is no text", async () => {
    h.replies.push({});
    expect(await core.http("http://127.0.0.1:9/", { method: "GET" })).toEqual({ status: 0, headers: {}, text: "" });
    expect(reqs()[0].written).toEqual([]);
    expect(reqs()[0].opts.timeout).toBe(5000);
  });

  it("fails with the url when the core does not answer in time", async () => {
    h.replies.push("timeout");
    await expect(core.http("http://127.0.0.1:9/api/x/y", { method: "POST", body: "{}" })).rejects.toThrow(
      "http://127.0.0.1:9/api/x/y did not answer",
    );
  });

  it("sessionCookie reads a single set-cookie header", async () => {
    h.replies.push({ status: 200, headers: { "set-cookie": "testimus_session=s1; Path=/; HttpOnly" } });
    expect(await core.sessionCookie("http://127.0.0.1:9")).toBe("testimus_session=s1");
    expect(reqs()[0].url).toBe("http://127.0.0.1:9/");
  });

  it("waitHttp treats a missing status as a failure and a hung request as a retry", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    h.replies.push({}, "timeout", { status: 200 });
    const done = core.waitHttp("http://localhost:4318/", 10_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await done).toBe(true);
    expect(reqs()).toHaveLength(3);
    expect(reqs()[0].opts).toMatchObject({ method: "GET", timeout: 2000 });
  });
});

describe("runningJobs", () => {
  const O = "http://127.0.0.1:9";
  it("asks without a project when none is known, and keeps jobs of any pid when the core's is unknown", async () => {
    h.replies.push(
      json({ last: "", projects: [{ dir: "D:\\gone", exists: false }] }),
      json([
        { id: "a", kind: "generate", subject: "", status: "running", pid: 1 },
        { id: "b", kind: "check", subject: "", status: "done" },
        { id: "a", kind: "generate", subject: "dup", status: "running" },
      ]),
    );
    const jobs = await core.runningJobs(O, "c");
    expect(jobs.map((j) => [j.id, j.project])).toEqual([["a", undefined]]);
    expect(reqs()[1].opts.headers?.["x-testimus-project"]).toBeUndefined();
  });

  it("keeps a job without a pid, drops another core's job and survives a broken listing", async () => {
    h.replies.push(
      { status: 500, text: "boom" },
      json([
        { id: "nopid", kind: "pull", subject: "", status: "running" },
        { id: "other", kind: "push", subject: "", status: "running", pid: 2 },
        { id: "mine", kind: "push", subject: "", status: "running", pid: 7 },
      ]),
    );
    expect((await core.runningJobs(O, "c", 7)).map((j) => j.id)).toEqual(["nopid", "mine"]);
  });

  it("deduplicates projects and ignores a project whose jobs cannot be listed", async () => {
    h.replies.push(
      json({
        last: "D:\\a",
        projects: [
          { dir: "D:\\a", exists: true },
          { dir: "D:\\b", exists: true },
        ],
      }),
      { status: 403, text: "no" },
      json([{ id: "b1", kind: "fix", subject: "", status: "running" }]),
    );
    const jobs = await core.runningJobs(O, "c", 7);
    expect(jobs).toEqual([{ id: "b1", kind: "fix", subject: "", status: "running", project: "D:\\b" }]);
    expect(reqs()).toHaveLength(3);
  });

  it("cancelJobs goes on after a cancel fails", async () => {
    h.replies.push({ status: 500, text: "x" }, json({}));
    await core.cancelJobs(O, "c", [
      { id: "1", kind: "k", subject: "", status: "running", project: "D:\\a" },
      { id: "2", kind: "k", subject: "", status: "running" },
    ]);
    expect(reqs().map((r) => r.url)).toEqual([`${O}/api/jobs/cancel`, `${O}/api/jobs/cancel`]);
    expect(reqs()[0].written).toEqual(['{"id":"1"}']);
  });
});

describe("processes without pipes", () => {
  it("startCore treats a child without a pid as one that could not start, and times out quietly", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const c = core.startCore({ command: "x", args: ["a"], cwd: "C:\\" }, { A: "1" }, 1000);
    expect(h.spawned[0]).toMatchObject({
      command: "x",
      args: ["a"],
      opts: { cwd: "C:\\", env: { A: "1" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    });
    const ready = expect(c.ready).rejects.toThrow("within 1 s");
    await vi.advanceTimersByTimeAsync(1000);
    await ready;
    expect(h.killTree).not.toHaveBeenCalled();
    (h.child as EventEmitter).emit("close", 1);
    expect(await c.exited).toBeNull();
    expect(c.child.exitCode).not.toBeNull();
  });

  it("stopCore kills the tree after the timeout and waits at most 3 s more", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.pid = 99;
    const c = core.startCore({ command: "x", args: [], cwd: "C:\\" }, {});
    const stopped = core.stopCore(c, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.killTree).toHaveBeenCalledWith(99);
    await vi.advanceTimersByTimeAsync(3000);
    await stopped;
    (h.child as EventEmitter).emit("close", null);
    expect(await c.exited).toBe(1);
  });

  it("startUiDev copes with a child without pipes", () => {
    const child = core.startUiDev("node", "D:\\repo", "http://127.0.0.1:1");
    expect(child.pid).toBeUndefined();
    const opts = (h.spawned[0] as { opts: { env: Record<string, string>; stdio: string[] } }).opts;
    expect(opts.env.TESTIMUS_API_TARGET).toBe("http://127.0.0.1:1");
    expect(opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    (h.child as EventEmitter).emit("close", 0);
  });
});

describe("findNode", () => {
  it("looks for node without .exe off Windows, and reads Path as well as PATH", () => {
    let found: string | null = null;
    onPlatform("linux", () => {
      found = core.findNode({ PATH: "/usr/bin" }, (p) => p.endsWith("node"));
    });
    expect(found).toBe(join("/usr/bin", "node"));
    if (process.platform === "win32")
      expect(core.findNode({ Path: "C:\\n" }, (p) => p === join("C:\\n", "node.exe"))).toBe(join("C:\\n", "node.exe"));
    else expect(core.findNode({ Path: "/n" }, (p) => p === join("/n", "node"))).toBe(join("/n", "node"));
    expect(core.findNode({}, () => true)).toBeNull();
  });
});
