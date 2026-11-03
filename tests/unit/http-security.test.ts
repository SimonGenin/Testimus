import fs, { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handler, type ServeState, UI_CSP, uncPath } from "../../src/faces/http.ts";

let server: Server;
let base = "";
let cookie = "";
let project = "";

beforeAll(async () => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-http-")), "p");
  cpSync(join(import.meta.dirname, "..", "fixtures", "project"), project, { recursive: true });
  const state: ServeState = { project, mock: true, port: 0, token: "t0k3n-for-tests" };
  server = createServer(handler(state));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${state.port}`;
  cookie = `testimus_session=${state.token}`;
});

afterAll(() => server.close());

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", body, headers });

describe("HTTP face guard", () => {
  it("serves the page with a SameSite=Strict session cookie", async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get("set-cookie") ?? "").toMatch(/testimus_session=.+SameSite=Strict/);
  });

  it("refuses a cross-site text/plain POST (CSRF)", async () => {
    const r = await post("/api/tests/remove", JSON.stringify({ id: "local-3f9a12c0" }), {
      "content-type": "text/plain",
      origin: "https://evil.example",
    });
    expect(r.status).toBe(403);
  });

  it("refuses a non-JSON body on its own, even from the page's origin with the session (415)", async () => {
    const r = await post("/api/tests/remove", JSON.stringify({ id: "local-3f9a12c0" }), {
      cookie,
      origin: base,
      "content-type": "text/plain",
    });
    expect(r.status).toBe(415);
    const near = await post("/api/tests/list", "{}", { cookie, origin: base, "content-type": "application/jsonx" });
    expect(near.status).toBe(415);
    const ok = await post("/api/tests/list", "{}", { cookie, origin: base, "content-type": "application/json" });
    expect(ok.status).toBe(200);
  });

  it("refuses a chunked non-JSON body like a whole one (415), takes a chunked JSON body", async () => {
    const chunked = (type: string) =>
      new Promise<number>((done, fail) => {
        const req = request(
          `${base}/api/tests/list`,
          { method: "POST", headers: { cookie, origin: base, "content-type": type } },
          (res) => {
            res.resume();
            done(res.statusCode ?? 0);
          },
        );
        req.on("error", fail);
        req.write("{");
        req.end("}");
      });
    expect(await chunked("text/plain")).toBe(415);
    expect(await chunked("application/json")).toBe(200);
  });

  it("answers a badly encoded X-Testimus-Project with 400 and keeps running", async () => {
    const bad = await post("/api/tests/list", "{}", {
      cookie,
      "content-type": "application/json",
      "x-testimus-project": "%E0%A4%A",
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/X-Testimus-Project/);
    const pub = await fetch(`${base}/api/system/version`, { headers: { "x-testimus-project": "%E0%A4%A" } });
    expect(pub.status).toBe(200);
    const file = await fetch(`${base}/files/%E0%A4%A`, { headers: { cookie } });
    expect(file.status).toBe(400);
    const after = await post("/api/tests/list", "{}", { cookie, "content-type": "application/json" });
    expect(after.status).toBe(200);
  });

  it("takes the open project by its path in another case", async () => {
    const r = await fetch(`${base}/files/project.json`, {
      headers: { cookie, "x-testimus-project": encodeURIComponent(project.toUpperCase()) },
    });
    expect(r.status).toBe(process.platform === "win32" ? 200 : 403);
  });

  it("refuses a request without the session cookie", async () => {
    const r = await post("/api/tests/list", "{}", { "content-type": "application/json" });
    expect(r.status).toBe(403);
  });

  it("refuses a foreign Host (DNS rebinding)", async () => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((done) => {
      const req = request(
        `${base}/api/tests/list`,
        { method: "POST", headers: { host: "rebind.attacker.example", cookie, "content-type": "application/json" } },
        (res) => done(res.statusCode ?? 0),
      );
      req.end("{}");
    });
    expect(status).toBe(403);
  });

  it("refuses files of a folder that is not a known project", async () => {
    const r = await fetch(`${base}/files/win.ini?project=${encodeURIComponent("C:\\Windows")}`, {
      headers: { cookie },
    });
    expect(r.status).toBe(403);
  });

  it("serves project files with a sandboxing CSP", async () => {
    const r = await fetch(`${base}/files/project.json`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("answers a same-origin JSON POST, refuses GET and bad JSON", async () => {
    const ok = await post("/api/tests/list", "{}", { cookie, "content-type": "application/json" });
    expect(ok.status).toBe(200);
    const get = await fetch(`${base}/api/tests/list`, { headers: { cookie } });
    expect(get.status).toBe(400);
    const bad = await post("/api/tests/list", "{nope", { cookie, "content-type": "application/json" });
    expect(bad.status).toBe(400);
  });

  it("serves the command list and the event stream on GET only (405 otherwise)", async () => {
    const json = { cookie, "content-type": "application/json" };
    for (const path of ["/api", "/api/", "/api/events"]) {
      const r = await post(path, "{}", json);
      expect(r.status, path).toBe(405);
      expect(r.headers.get("allow"), path).toBe("GET");
    }
    const list = await fetch(`${base}/api`, { headers: { cookie } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { commands: unknown[] }).commands.length).toBeGreaterThan(0);
  });

  it("keeps GET /api/system/version public for start-up probes", async () => {
    const r = await fetch(`${base}/api/system/version`);
    expect(r.status).toBe(200);
  });
});

describe("the UI page's Content-Security-Policy", () => {
  it("serves the page with the CSP, and project files keep their own", async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get("content-security-policy")).toBe(UI_CSP);
    expect(UI_CSP).toContain("default-src 'self'");
    expect(UI_CSP).toContain("connect-src 'self'");
    expect(UI_CSP).toContain("img-src 'self' data: https:");
    expect(UI_CSP).not.toMatch(/script-src|unsafe-eval/);
    const deep = await fetch(`${base}/review`);
    expect(deep.headers.get("content-security-policy")).toBe(UI_CSP);
    const files = await fetch(`${base}/files/project.json`, { headers: { cookie } });
    expect(files.headers.get("content-security-policy")).toContain("sandbox");
    const api = await post("/api/tests/list", "{}", { cookie, "content-type": "application/json" });
    expect(api.headers.get("content-security-policy")).toBeNull();
  });

  it("has no inline script in index.html (the theme runs from /theme.js)", () => {
    const root = join(import.meta.dirname, "..", "..", "src", "ui");
    const html = readFileSync(join(root, "index.html"), "utf8");
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s).toMatch(/\ssrc="/);
      expect(
        s
          .replace(/^<script[^>]*>/, "")
          .replace(/<\/script>$/, "")
          .trim(),
      ).toBe("");
    }
    expect(html).toContain('<script src="/theme.js"></script>');
    expect(readFileSync(join(root, "public", "theme.js"), "utf8")).toContain("testimus.theme");
  });
});

describe("no disk access on a path from a request before it is known", () => {
  const SPIED = [
    "existsSync",
    "statSync",
    "lstatSync",
    "readFileSync",
    "realpathSync",
    "accessSync",
    "openSync",
    "readdirSync",
  ];
  const fsAny = fs as unknown as Record<string, ((...a: unknown[]) => unknown) & { native?: unknown }>;
  const originals = new Map<string, (...a: unknown[]) => unknown>();
  let seen: string[] = [];
  let other = "";

  beforeAll(() => {
    other = join(mkdtempSync(join(tmpdir(), "testimus-http-")), "UNKNOWNMARK");
    cpSync(join(import.meta.dirname, "..", "fixtures", "project"), other, { recursive: true });
    for (const name of SPIED) {
      const original = fsAny[name];
      originals.set(name, original);
      const spy = Object.assign(
        (...a: unknown[]) => {
          seen.push(`${name} ${String(a[0])}`);
          return original(...a);
        },
        original.native ? { native: original.native } : {},
      );
      fsAny[name] = spy;
    }
    syncBuiltinESMExports();
  });

  afterAll(() => {
    for (const [name, original] of originals) fsAny[name] = original;
    syncBuiltinESMExports();
  });

  const raw = (path: string, headers: Record<string, string>) =>
    new Promise<number>((done, fail) => {
      const req = request(`${base}${path}`, { method: "GET", headers }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.on("error", fail);
      req.end();
    });
  const unc = String.raw`\\EVILHOST\share\x`;
  const touched = (mark: string) => seen.filter((s) => s.toUpperCase().includes(mark));

  it("the spy sees the handler's disk access (control)", async () => {
    seen = [];
    expect((await fetch(`${base}/files/project.json`, { headers: { cookie } })).status).toBe(200);
    expect(seen.some((s) => s.startsWith("existsSync") && s.endsWith("project.json"))).toBe(true);
  });

  it("a request the guard refuses touches no file at all, whatever project it names", async () => {
    seen = [];
    const foreign = { host: "evil.example:80" };
    expect(await raw(`/files/a.png?project=${encodeURIComponent(unc)}`, foreign)).toBe(403);
    expect(await raw("/api", { ...foreign, "x-testimus-project": encodeURIComponent(unc) })).toBe(403);
    expect(await raw(`/files/project.json?project=${encodeURIComponent(other)}`, {})).toBe(403);
    expect(seen).toEqual([]);
  });

  it("past the guard, a UNC path is refused before any disk access, in every form", async () => {
    seen = [];
    for (const p of [unc, "//EVILHOST/share/x", String.raw`\\?\UNC\EVILHOST\share\x`, String.raw`\\.\EVILHOST\x`]) {
      expect(await raw(`/files/project.json?project=${encodeURIComponent(p)}`, { cookie })).toBe(403);
      expect(await raw("/files/project.json", { cookie, "x-testimus-project": encodeURIComponent(p) })).toBe(403);
    }
    expect(await raw(`/files/${encodeURIComponent(unc)}`, { cookie })).toBe(404);
    expect(await raw("/files/%5C%5CEVILHOST/share/x", { cookie })).toBe(404);
    expect(touched("EVILHOST")).toEqual([]);
  });

  it("past the guard, a real project that is not known is refused without opening it", async () => {
    seen = [];
    expect(await raw(`/files/project.json?project=${encodeURIComponent(other)}`, { cookie })).toBe(403);
    expect(touched("UNKNOWNMARK")).toEqual([]);
  });

  it("names UNC and device paths", () => {
    for (const p of [
      unc,
      "//h/s",
      String.raw`\\?\UNC\h\s`,
      String.raw`\\?\C:\x`,
      String.raw`\\.\pipe\x`,
      String.raw`/\h\s`,
    ])
      expect(uncPath(p)).toBe(true);
    for (const p of [String.raw`C:\Users\x`, "D:/p", String.raw`relative\x`, String.raw`\single\root`])
      expect(uncPath(p)).toBe(false);
  });
});
