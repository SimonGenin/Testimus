import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const CLI = join(ROOT, "src", "faces", "cli.ts");

type Core = {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<number>;
};

function startCore(args: string[], extraEnv: Record<string, string> = {}): Core {
  const child = spawn(process.execPath, [CLI, "serve", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
  const exit = new Promise<number>((r) => child.on("exit", (code) => r(code ?? -1)));
  return { child, stdout: () => out, stderr: () => err, exit };
}

async function until(test: () => boolean, ms: number, what: string, core: Core): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`${what} — stderr:\n${core.stderr()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function alive(pid: number): boolean {
  if (process.platform === "win32") {
    const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], { encoding: "utf8" });
    return r.stdout.includes(`"${pid}"`);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hostRequest(url: string, host: string, cookie: string): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(
      url,
      { method: "POST", headers: { host, cookie, "content-type": "application/json" } },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    req.on("error", fail);
    req.end("{}");
  });
}

describe("serve for the desktop shell (real process)", () => {
  let core: Core;
  let ready: { ready: boolean; url: string; pid: number; version: string };

  beforeAll(async () => {
    core = startCore(["--mock", "--port", "0", "--ready-json", "--exit-with-stdin", "--no-open"], {
      TESTIMUS_SHELL: "desktop/0.2.0",
    });
    await until(() => core.stdout().includes("\n"), 60000, "no ready line", core);
    ready = JSON.parse(core.stdout().split("\n")[0]);
  }, 70000);

  afterAll(() => {
    if (core.child.exitCode === null) core.child.kill();
  });

  it("prints exactly one ready line first, with the real port", () => {
    expect(core.stdout()).toBe(`${core.stdout().split("\n")[0]}\n`);
    expect(Object.keys(ready)).toEqual(["ready", "url", "pid", "version"]);
    expect(ready.ready).toBe(true);
    expect(ready.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(ready.url).not.toBe("http://127.0.0.1:0/");
    expect(ready.pid).toBe(core.child.pid);
    expect(ready.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("answers on that port, and its guard knows the real port and no other", async () => {
    const v = await fetch(`${ready.url}api/system/version`);
    expect(v.status).toBe(200);
    expect(((await v.json()) as { mock: boolean }).mock).toBe(true);
    const page = await fetch(ready.url);
    const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^testimus_session=/);
    const port = Number(new URL(ready.url).port);
    const api = `${ready.url}api/tests/list`;
    expect(await hostRequest(api, `127.0.0.1:${port}`, cookie)).toBe(200);
    expect(await hostRequest(api, `localhost:${port}`, cookie)).toBe(200);
    expect(await hostRequest(api, `127.0.0.1:${port === 4317 ? 4318 : 4317}`, cookie)).toBe(403);
    expect(await hostRequest(api, "127.0.0.1:0", cookie)).toBe(403);
  });

  it("exits when its stdin closes, leaving no process behind", async () => {
    core.child.stdin.end();
    const code = await Promise.race([core.exit, new Promise<number>((r) => setTimeout(() => r(-99), 15000))]);
    expect(code).toBe(0);
    expect(core.stderr()).toContain("Testimus stopping (stdin closed).");
    expect(alive(ready.pid)).toBe(false);
  }, 20000);
});

describe("serve start-up errors", () => {
  it("refuses a bad port on stderr, with nothing on stdout and a non-zero exit", async () => {
    const core = startCore(["--port", "99999", "--ready-json", "--no-open"]);
    expect(await core.exit).not.toBe(0);
    expect(core.stdout()).toBe("");
    expect(core.stderr()).toContain("Not a port: 99999.");
  }, 30000);

  it("reports a port already in use on stderr and exits non-zero", async () => {
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
    const port = (busy.address() as AddressInfo).port;
    try {
      const core = startCore(["--mock", "--port", String(port), "--ready-json", "--exit-with-stdin", "--no-open"]);
      const code = await Promise.race([core.exit, new Promise<number>((r) => setTimeout(() => r(-99), 60000))]);
      expect(code).toBe(1);
      expect(core.stdout()).toBe("");
      expect(core.stderr()).toMatch(/EADDRINUSE/);
    } finally {
      busy.close();
    }
  }, 70000);

  it("takes another free port when the asked one is in use and --port-fallback is given", async () => {
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
    const port = (busy.address() as AddressInfo).port;
    const core = startCore([
      "--mock",
      "--port",
      String(port),
      "--port-fallback",
      "--ready-json",
      "--exit-with-stdin",
      "--no-open",
    ]);
    try {
      await until(() => core.stdout().includes("\n"), 60000, "no ready line", core);
      const line = JSON.parse(core.stdout().split("\n")[0]) as { ready: boolean; url: string };
      const got = Number(new URL(line.url).port);
      expect(line.ready).toBe(true);
      expect(got).toBeGreaterThan(0);
      expect(got).not.toBe(port);
    } finally {
      core.child.stdin.end();
      await Promise.race([core.exit, new Promise((r) => setTimeout(r, 10000))]);
      if (core.child.exitCode === null) core.child.kill();
      busy.close();
    }
  }, 70000);
});
