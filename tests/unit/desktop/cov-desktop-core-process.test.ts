import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type Core,
  http,
  killTree,
  sessionCookie,
  startCore,
  startUiDev,
  stopCore,
  UI_DEV_PORT,
  waitHttp,
} from "../../../src/desktop/core.ts";
import { logDir, logName } from "../../../src/desktop/log.ts";

const root = mkdtempSync(join(tmpdir(), "testimus-cov-core-"));
const node = (script: string) => ({ command: process.execPath, args: ["-e", script], cwd: root });
const READY = `console.log(JSON.stringify({ ready: true, url: "http://127.0.0.1:5555/x", pid: process.pid, version: "0.9.0" }));`;
const STAY = "setInterval(() => {}, 1000);";
const started: Core[] = [];
const start = (script: string, timeoutMs?: number) => {
  const c = startCore(node(script), { ...process.env }, timeoutMs);
  started.push(c);
  return c;
};
const logged = () => readFileSync(join(logDir(), logName(new Date())), "utf8");

beforeEach(() => {
  vi.stubEnv("LOCALAPPDATA", join(root, "local"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const c of started) if (c.child.pid && c.child.exitCode === null) killTree(c.child.pid);
});

describe("startCore", () => {
  it("resolves on the ready line, logs the core's output and stops when its stdin closes", async () => {
    const c = start(
      `console.log("Testimus starting"); console.error("a warning"); ${READY} process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`,
    );
    const r = await c.ready;
    expect(() => c.child.stdin?.emit("error", new Error("EPIPE"))).not.toThrow();
    expect(r).toEqual({
      url: "http://127.0.0.1:5555/",
      origin: "http://127.0.0.1:5555",
      pid: c.child.pid,
      version: "0.9.0",
    });
    await stopCore(c);
    expect(await c.exited).toBe(0);
    await stopCore(c);
    const text = logged();
    expect(text).toContain("starting the core:");
    expect(text).toContain("[core] Testimus starting");
    expect(text).toContain("[core] a warning");
    expect(text).toContain("the core exited (code 0)");
  });

  it("rejects when the core exits before it is ready", async () => {
    const c = start("process.exit(3)");
    await expect(c.ready).rejects.toThrow("The core stopped (exit code 3) before it was ready.");
    expect(await c.exited).toBe(3);
  });

  it("rejects when the core cannot start at all", async () => {
    const c = startCore({ command: join(root, "missing.exe"), args: [], cwd: root }, { ...process.env });
    await expect(c.ready).rejects.toThrow("The core stopped (exit code none) before it was ready.");
    expect(await c.exited).toBeNull();
    await stopCore(c);
    expect(logged()).toContain("the core could not start");
  });

  it("gives up and kills the core when it never says it is ready", async () => {
    const c = start(STAY, 300);
    await expect(c.ready).rejects.toThrow("The core did not answer within 0 s.");
    await c.exited;
    expect(c.child.exitCode !== null || c.child.signalCode !== null).toBe(true);
  });
});

describe("stopCore", () => {
  it("kills the process tree when the core ignores the end of its stdin", async () => {
    const c = start(`${READY} process.stdin.resume(); ${STAY}`);
    await c.ready;
    await stopCore(c, 200);
    await c.exited;
    expect(c.child.exitCode !== null || c.child.signalCode !== null).toBe(true);
    expect(logged()).toContain("did not stop within 0.2 s");
  });

  it("does nothing for a core already killed by a signal", async () => {
    const end = vi.fn();
    const fake = { child: { exitCode: null, signalCode: "SIGKILL", pid: 1, stdin: { end } } } as unknown as Core;
    await stopCore(fake);
    expect(end).not.toHaveBeenCalled();
  });
});

describe("startUiDev", () => {
  it("runs Vite from the checkout on the dev port, pointed at the core", async () => {
    const repo = join(root, "repo");
    mkdirSync(join(repo, "node_modules", "vite", "bin"), { recursive: true });
    writeFileSync(
      join(repo, "node_modules", "vite", "bin", "vite.js"),
      'console.log("vite " + process.argv.slice(2).join(" ")); console.error("api " + process.env.TESTIMUS_API_TARGET);',
    );
    const child = startUiDev(process.execPath, repo, "http://127.0.0.1:5555");
    await new Promise((r) => child.once("exit", r));
    await new Promise((r) => setTimeout(r, 50));
    const text = logged();
    expect(text).toContain(`[ui-dev] vite --port ${UI_DEV_PORT} --strictPort`);
    expect(text).toContain("[ui-dev] api http://127.0.0.1:5555");
  });
});

describe("local http", () => {
  let server: Server;
  let origin = "";
  let status = 200;
  const bodies: { url?: string; method?: string; body: string; headers: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        bodies.push({ url: req.url, method: req.method, body, headers: req.headers });
        if (req.url === "/nocookie/") {
          res.writeHead(200);
          res.end();
          return;
        }
        if (req.url === "/other/") {
          res.writeHead(200, { "set-cookie": ["a=1; Path=/", "b=2"] });
          res.end();
          return;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    origin = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });

  afterAll(() => {
    server.close();
  });

  it("waitHttp answers true once the server answers below 500", async () => {
    status = 404;
    expect(await waitHttp(`${origin}/`, 2000)).toBe(true);
  });

  it("waitHttp keeps trying on a 500 and on a refused connection, then gives up", async () => {
    status = 500;
    expect(await waitHttp(`${origin}/`, 300)).toBe(false);
    expect(await waitHttp("http://127.0.0.1:1/", 300)).toBe(false);
    status = 200;
  });

  it("http posts the body and reads the answer", async () => {
    bodies.length = 0;
    const r = await http(`${origin}/api/x/y`, { method: "POST", headers: { "x-a": "1" }, body: '{"a":1}' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ ok: true });
    expect(bodies[0]).toMatchObject({ method: "POST", body: '{"a":1}' });
    expect(bodies[0].headers["x-a"]).toBe("1");
    await expect(http("http://127.0.0.1:1/", { method: "GET" })).rejects.toThrow();
  });

  it("sessionCookie gives nothing when the core sets no session cookie", async () => {
    expect(await sessionCookie(`${origin}/nocookie`)).toBe("");
    expect(await sessionCookie(`${origin}/other`)).toBe("");
  });

  it("api names the project, and throws the status and text on an error", async () => {
    bodies.length = 0;
    expect(await api(origin, "c=1", "project.list", { a: 1 }, "D:\\p é")).toEqual({ ok: true });
    expect(bodies[0].url).toBe("/api/project/list");
    expect(bodies[0].headers["x-testimus-project"]).toBe(encodeURIComponent("D:\\p é"));
    expect(bodies[0].headers.cookie).toBe("c=1");
    status = 403;
    await expect(api(origin, "", "jobs.list", {})).rejects.toThrow('jobs.list: HTTP 403 {"ok":true}');
    status = 200;
  });
});
