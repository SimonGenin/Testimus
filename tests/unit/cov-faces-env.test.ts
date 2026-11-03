import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notBuilt, projectOf, quietCtx, UserError } from "../../src/core/command.ts";
import { nodeSpawnClaude } from "../../src/core/env.ts";
import { killChildren, killTreeSync as killTree, liveChildren, resolveExe } from "../../src/shared/run/process.ts";
import { semaphore as gate } from "../../src/shared/run/work.ts";
import { tempRoot } from "./cov-faces-helpers.ts";

const root = tempRoot("env");
const node = process.execPath;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("env.http over fetch", () => {
  it("returns text with lower-cased headers, or bytes when asked", async () => {
    const calls: [string, RequestInit][] = [];
    vi.resetModules();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response("hello", { status: 201, headers: { "X-Thing": "1" } });
    });
    const { env } = await import("../../src/core/env.ts");
    const text = await env.http({ method: "POST", url: "https://x.test/a", headers: { a: "b" }, body: "{}" });
    expect(text).toEqual({
      status: 201,
      headers: { "content-type": "text/plain;charset=UTF-8", "x-thing": "1" },
      text: "hello",
    });
    expect(calls[0][1].body).toBe("{}");
    const bytes = new Uint8Array([1, 2, 3]);
    const bin = await env.http({
      method: "PUT",
      url: "https://x.test/b",
      bodyBytes: bytes,
      binary: true,
      timeoutMs: 1000,
    });
    expect(bin.bytes).toEqual(new TextEncoder().encode("hello"));
    expect(bin.text).toBeUndefined();
    expect(calls[1][1].body).toBe(bytes);
  });

  it("follows a redirect and aborts a request that outlives its timeout, against a real local server", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/old") {
        res.writeHead(302, { Location: "/new" }).end();
        return;
      }
      if (req.url === "/new") {
        res.writeHead(200, { "Content-Type": "text/plain", "X-Final": "yes" }).end("landed");
        return;
      }
      setTimeout(() => res.writeHead(200).end("too late"), 3000).unref();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      vi.resetModules();
      const { env } = await import("../../src/core/env.ts");
      const moved = await env.http({ method: "GET", url: `${base}/old` });
      expect(moved.status).toBe(200);
      expect(moved.text).toBe("landed");
      expect(moved.headers["x-final"]).toBe("yes");
      expect(hits).toEqual(["/old", "/new"]);
      const started = Date.now();
      await expect(env.http({ method: "GET", url: `${base}/slow`, timeoutMs: 200 })).rejects.toThrow(
        /timeout|aborted/i,
      );
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  it("finds its folders from the environment or the home folder", async () => {
    const { env } = await import("../../src/core/env.ts");
    const saved = { ...process.env };
    try {
      process.env.TESTIMUS_HOME = join(root, "h");
      process.env.APPDATA = join(root, "ad");
      process.env.LOCALAPPDATA = join(root, "lad");
      expect(env.homeDir()).toBe(join(root, "h"));
      expect(env.dataDir()).toBe(join(root, "ad", "Testimus"));
      expect(env.localDir()).toBe(join(root, "lad", "Testimus"));
      delete process.env.TESTIMUS_HOME;
      delete process.env.APPDATA;
      delete process.env.LOCALAPPDATA;
      expect(env.homeDir()).toBeTruthy();
      expect(env.dataDir()).toMatch(/[\\/]\.config[\\/]Testimus$/);
      expect(env.localDir()).toMatch(/[\\/]\.local[\\/]share[\\/]Testimus$/);
      expect(env.now()).toBeInstanceOf(Date);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});

describe("resolveExe", () => {
  it("keeps a path or a named extension, finds a bare name on PATH", () => {
    expect(resolveExe("C:\\tools\\x")).toBe("C:\\tools\\x");
    expect(resolveExe("tool.exe")).toBe("tool.exe");
    if (process.platform !== "win32") return;
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "covtool.cmd"), "@echo off\r\n");
    const saved = process.env.PATH;
    try {
      process.env.PATH = `${bin};;`;
      expect(resolveExe("covtool")).toBe(join(bin, "covtool.cmd"));
      expect(resolveExe("absent-tool")).toBe("absent-tool");
      delete process.env.PATH;
      expect(resolveExe("absent-tool")).toBe("absent-tool");
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe("nodeSpawnClaude", () => {
  it("collects stdout by line, flushes the last partial line and keeps stderr", async () => {
    const lines: string[] = [];
    const script = "process.stdout.write('one\\n\\n  \\ntwo\\nthree');process.stderr.write('warn');";
    const r = await nodeSpawnClaude({
      exe: node,
      args: ["-e", script],
      cwd: root,
      stdin: "",
      onLine: (l) => lines.push(l),
    });
    expect(r).toEqual({ code: 0, stdout: "one\n\n  \ntwo\nthree", stderr: "warn" });
    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("works without a line callback and passes stdin", async () => {
    const script =
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{process.stdout.write(s.toUpperCase());process.exit(3)})";
    const r = await nodeSpawnClaude({ exe: node, args: ["-e", script], cwd: root, stdin: "prompt" });
    expect(r).toEqual({ code: 3, stdout: "PROMPT", stderr: "" });
  });

  it("does not start when already cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await nodeSpawnClaude({ exe: "", args: [], cwd: root, stdin: "", signal: ctrl.signal });
    expect(r).toEqual({ code: 130, stdout: "", stderr: "Cancelled before claude started." });
  });

  it("kills the process tree on cancel and forgets the child", async () => {
    const ctrl = new AbortController();
    const running = nodeSpawnClaude({
      exe: node,
      args: ["-e", "process.stdout.write('up\\n');setInterval(()=>{},1000)"],
      cwd: root,
      stdin: "",
      signal: ctrl.signal,
      onLine: () => ctrl.abort(),
    });
    const r = await running;
    expect(r.stdout).toBe("up\n");
    expect(r.code).not.toBe(0);
    await vi.waitFor(() => expect(liveChildren()).toEqual([]));
  });

  it.runIf(process.platform === "win32")("kills the grandchild too when cancelled", async () => {
    const script = [
      "const { spawn } = require('node:child_process');",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "process.stdout.write(g.pid + '\\n');",
      "setInterval(() => {}, 1000);",
    ].join("");
    const ctrl = new AbortController();
    let grandchild = 0;
    const r = await nodeSpawnClaude({
      exe: node,
      args: ["-e", script],
      cwd: root,
      stdin: "",
      signal: ctrl.signal,
      onLine: (l) => {
        grandchild = Number(l);
        process.kill(grandchild, 0);
        ctrl.abort();
      },
    });
    expect(r.code).not.toBe(0);
    expect(grandchild).toBeGreaterThan(0);
    await vi.waitFor(() => expect(() => process.kill(grandchild, 0)).toThrow(), { timeout: 5000 });
  });

  it("rejects when the program cannot start, even if cancelled first", async () => {
    const ctrl = new AbortController();
    const p = nodeSpawnClaude({ exe: join(root, "missing.exe"), args: [], cwd: root, stdin: "", signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/ENOENT/);
  });

  it.runIf(process.platform === "win32")("runs a .cmd shim through cmd, refusing cmd metacharacters", async () => {
    const shim = join(root, "say.cmd");
    writeFileSync(shim, "@echo off\r\necho said %1\r\n");
    const r = await nodeSpawnClaude({ exe: shim, args: ['"a b"'], cwd: root, stdin: "" });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('said "a b"');
    await expect(nodeSpawnClaude({ exe: shim, args: ["a&calc"], cwd: root, stdin: "" })).rejects.toThrow(
      "Refused to start claude through cmd with an unsafe argument: a&calc",
    );
  });
});

describe("killTree and killChildren", () => {
  it("kills a running process and every child still alive", async () => {
    const child = spawn(node, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true });
    const gone = new Promise((r) => child.on("exit", r));
    killTree(child.pid as number);
    await gone;
    const ctrl = new AbortController();
    const running = nodeSpawnClaude({
      exe: node,
      args: ["-e", "process.stdout.write('up\\n');setInterval(()=>{},1000)"],
      cwd: root,
      stdin: "",
      signal: ctrl.signal,
      onLine: () => {
        expect(killChildren()).toHaveLength(1);
      },
    });
    const r = await running;
    expect(r.stdout).toBe("up\n");
  });
});

describe("gate", () => {
  it("runs at most n at once and hands a slot to the next waiter", async () => {
    const g = gate(1);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const work = (i: number) =>
      g(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        order.push(i);
        active--;
        if (i === 2) throw new Error("two");
        return i;
      });
    const results = await Promise.allSettled([work(1), work(2), work(3)]);
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(await g(async () => "again")).toBe("again");
  });
});

describe("command helpers", () => {
  it("says a command is not built and needs a project", () => {
    expect(() => notBuilt("rag.x")).toThrow(UserError);
    expect(() => notBuilt("rag.x")).toThrow("rag.x is not built yet.");
    expect(() => projectOf(quietCtx(null))).toThrow("No project is open.");
    const ctx = quietCtx("/p");
    ctx.progress({ message: "x" });
    ctx.log("info", "x");
    ctx.claude({ type: "text", text: "x" });
    expect(projectOf(ctx)).toBe("/p");
  });
});
