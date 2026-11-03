import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFixture, freshEnv, rawRequest, tempRoot } from "./cov-faces-helpers.ts";

const root = tempRoot("serve");
const project = copyFixture(root);

let out = "";
let err = "";
let exitCalls: number[] = [];
let stops: ((why: string) => void)[] = [];
let parentGone: (() => void)[] = [];
let spawned: unknown[][] = [];
let rejections: ((...a: unknown[]) => void)[] = [];
const writeBefore = process.stdout.write;
const envBefore = { ...process.env };

async function load() {
  vi.resetModules();
  await freshEnv(root);
  vi.doMock("../../src/core/shell.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    onStopSignals: (stop: (why: string) => void) => {
      stops.push(stop);
      return () => {};
    },
    onParentGone: (_stdin: unknown, stop: () => void) => {
      parentGone.push(stop);
    },
  }));
  vi.doMock("node:child_process", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    spawn: (...a: unknown[]) => {
      spawned.push(a);
      const child = { on: () => child, unref() {} };
      return child;
    },
  }));
  return await import("../../src/faces/http.ts");
}

function portFromLog(): number {
  const m = /Testimus on http:\/\/localhost:(\d+)\//.exec(err);
  if (!m) throw new Error(`no port in: ${err}`);
  return Number(m[1]);
}

async function stopNow(why = "SIGTERM") {
  const stop = stops[stops.length - 1];
  stop(why);
  await vi.waitFor(() => expect(exitCalls).toContain(0), { timeout: 15000 });
  return stop;
}

beforeEach(() => {
  out = "";
  err = "";
  exitCalls = [];
  stops = [];
  parentGone = [];
  spawned = [];
  rejections = process.listeners("unhandledRejection") as typeof rejections;
  vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
    out += String(s);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
    err += String(s);
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    exitCalls.push(code);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.stdout.write = writeBefore;
  vi.doUnmock("../../src/core/shell.ts");
  vi.doUnmock("node:child_process");
  for (const l of process.listeners("unhandledRejection"))
    if (!rejections.includes(l as never)) process.off("unhandledRejection", l as never);
  for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k];
  Object.assign(process.env, envBefore);
});

describe("serve", () => {
  it("serves a project on a free port with a kept session, warns about a proxy gap, and stops once", async () => {
    process.env.NODE_USE_ENV_PROXY = "1";
    process.env.HTTP_PROXY = "http://proxy.example:8080";
    process.env.NO_PROXY = "";
    process.env.no_proxy = "";
    const { serve } = await load();
    await serve(["--port", "0", "--no-open", "--project", project]);
    const port = portFromLog();
    expect(err).toContain(`— project ${project}`);
    expect(err).toContain("NO_PROXY does not list");
    const token = readFileSync(join(root, "appdata", "session.key"), "utf8");
    const r = await rawRequest(port, "/api", { headers: { cookie: `testimus_session=${token}` } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).project).toBe(project);
    const stop = await stopNow();
    expect(err).toContain("Testimus stopping (SIGTERM).");
    stop("again");
    expect(exitCalls).toEqual([0]);
    stop("SIGINT");
    expect(exitCalls).toEqual([0, 1]);
    expect(spawned).toEqual([]);
  });

  it("reuses a kept session key and replaces a damaged one", async () => {
    const file = join(root, "appdata", "session.key");
    const kept = "a".repeat(48);
    writeFileSync(file, kept);
    let { serve } = await load();
    await serve(["--port", "0", "--no-open"]);
    expect(readFileSync(file, "utf8")).toBe(kept);
    await stopNow();
    writeFileSync(file, "damaged");
    stops = [];
    exitCalls = [];
    ({ serve } = await load());
    await serve(["--port", "0", "--no-open"]);
    expect(readFileSync(file, "utf8")).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(file, "utf8")).not.toBe(kept);
    await stopNow();
  });

  it("prints only the ready line on stdout and stops when stdin closes", async () => {
    const { serve } = await load();
    await serve(["--port", "0", "--ready-json", "--exit-with-stdin"]);
    const ready = JSON.parse(out.trim()) as { ready: boolean; url: string; pid: number; version: string };
    expect(ready.ready).toBe(true);
    expect(ready.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(ready.pid).toBe(process.pid);
    process.stdout.write("stray");
    expect(err).toContain("stray");
    expect(parentGone).toHaveLength(1);
    parentGone[0]();
    await vi.waitFor(() => expect(exitCalls).toContain(0), { timeout: 15000 });
    expect(err).toContain("Testimus stopping (stdin closed).");
    expect(spawned).toEqual([]);
  });

  it("opens the browser when nothing says not to, and logs unhandled rejections", async () => {
    process.env.TESTIMUS_PORT = "0";
    const { serve } = await load();
    await serve([]);
    expect(spawned).toHaveLength(1);
    expect(spawned[0][0]).toBe(
      process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open",
    );
    const added = process.listeners("unhandledRejection").filter((l) => !rejections.includes(l as never));
    expect(added).toHaveLength(1);
    const noStack = new Error("flat");
    noStack.stack = undefined;
    for (const e of [new Error("deep"), noStack, "text"]) (added[0] as (e: unknown) => void)(e);
    expect(err).toContain("Testimus: unhandled error: Error: deep");
    expect(err).toContain("Testimus: unhandled error: flat");
    expect(err).toContain("Testimus: unhandled error: text");
    await stopNow();
  });

  it("starts the mock sandbox without opening a browser", async () => {
    const { serve } = await load();
    await serve(["--mock", "--port", "0"]);
    expect(err).toMatch(/Testimus on http:\/\/localhost:\d+\/ \(mock\) — project /);
    expect(spawned).toEqual([]);
    await stopNow();
  });

  it("refuses a port that is not one, or that is taken", async () => {
    const { serve } = await load();
    await expect(serve(["--port", "abc"])).rejects.toThrow("Not a port: abc.");
    await expect(serve(["--port", "70000"])).rejects.toThrow("Not a port: 70000.");
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
    try {
      const port = (busy.address() as AddressInfo).port;
      await expect(serve(["--port", String(port), "--no-open"])).rejects.toThrow(/EADDRINUSE/);
    } finally {
      busy.close();
    }
  });
});
