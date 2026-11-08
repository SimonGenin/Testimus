import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, fixtureCopy } from "../registry.ts";

const RUN = "recette-j5-sectionneurs";
let project = "";
let out = "";
let child: ChildProcess | null = null;
let port = 0;

// ponytail: the server the pages ship (templates/run-pages/serve.mjs), started as a tester starts it, on a free port
beforeAll(async () => {
  project = fixtureCopy("serve-pages");
  out = join(mkdtempSync(join(tmpdir(), "testimus-serve-")), "pages");
  await call("runs.export", { run: RUN, dir: out }, project);
  child = spawn(process.execPath, [join(out, "serve.mjs"), "--port", "0", "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  port = await new Promise<number>((ok, fail) => {
    let text = "";
    child?.stdout?.on("data", (b) => {
      text += String(b);
      const m = /READY http:\/\/127\.0\.0\.1:(\d+)\//.exec(text);
      if (m) ok(Number(m[1]));
    });
    child?.once("exit", (code) => fail(new Error(`serve.mjs exited ${code}`)));
  });
}, 30_000);

afterAll(() => {
  child?.kill();
  rmSync(project, { recursive: true, force: true });
  rmSync(join(out, ".."), { recursive: true, force: true });
});

function ask(
  method: string,
  path: string,
  o: { body?: string | Buffer; host?: string; origin?: string; type?: string } = {},
): Promise<{ status: number; text: string }> {
  return new Promise((ok, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          host: o.host ?? `127.0.0.1:${port}`,
          ...(o.origin ? { origin: o.origin } : {}),
          ...(o.type ? { "content-type": o.type } : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => {
          text += String(c);
        });
        res.on("end", () => ok({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", fail);
    if (o.body) req.write(o.body);
    req.end();
  });
}

describe("the pages' server (serve.mjs)", () => {
  it("listens on 127.0.0.1 only and serves the page, the pictures and the run's state", async () => {
    expect((await ask("GET", "/")).text).toContain('id="run-data"');
    expect((await ask("GET", "/images/LFRPS12-1420/fig-40.png")).status).toBe(200);
    const state = JSON.parse((await ask("GET", "/api/state")).text);
    expect(state.run.slug).toBe(RUN);
    expect(Object.keys(state.results).sort()).toEqual(["LFRPS12-1420", "local-3f9a12c0"]);
  });

  it("writes a test's result and its screenshot, and nothing else", async () => {
    const result = JSON.stringify({ status: "passed", steps: [{ ok: true }], updatedAt: "2026-11-09T10:00:00Z" });
    expect((await ask("PUT", "/results/LFRPS12-1398.json", { body: result, type: "application/json" })).status).toBe(
      200,
    );
    expect(JSON.parse(readFileSync(join(out, "results", "LFRPS12-1398.json"), "utf8")).status).toBe("passed");
    expect((await ask("PUT", "/results/LFRPS12-1398/capture-1a2b3c4d.png", { body: Buffer.from("png") })).status).toBe(
      200,
    );
    expect(existsSync(join(out, "results", "LFRPS12-1398", "capture-1a2b3c4d.png"))).toBe(true);

    for (const path of [
      "/run.json",
      "/index.html",
      "/serve.mjs",
      "/results/LFRPS12-9999.json",
      "/results/LFRPS12-1398/notes.txt",
      "/results/LFRPS12-1398/../../run.json",
      "/results/..%2F..%2Frun.json",
      "/results/LFRPS12-1398/%2e%2e%2f%2e%2e%2fevil.png",
    ])
      expect((await ask("PUT", path, { body: "{}" })).status, path).toBeGreaterThanOrEqual(403);
    expect((await ask("PUT", "/results/LFRPS12-1398.json", { body: "not json" })).status).toBe(400);
    expect((await ask("POST", "/results/LFRPS12-1398.json", { body: "{}" })).status).toBe(405);
    expect(readFileSync(join(out, "run.json"), "utf8")).toContain(`"slug": "${RUN}"`);
    expect(existsSync(join(out, "..", "evil.png"))).toBe(false);
  });

  it("refuses a path out of its folder, another host name (DNS rebinding) and another page's origin", async () => {
    expect((await ask("GET", "/../../etc/hosts")).status).toBe(404);
    expect((await ask("GET", "/%2e%2e/%2e%2e/etc/hosts")).status).toBe(404);
    expect((await ask("GET", "/.hidden")).status).toBe(404);
    expect((await ask("GET", "/", { host: `evil.example:${port}` })).status).toBe(403);
    const r = await ask("PUT", "/results/LFRPS12-1398.json", { body: "{}", origin: "http://evil.example" });
    expect(r.status).toBe(403);
  });
});
