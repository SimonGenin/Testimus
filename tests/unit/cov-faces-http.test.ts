import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { copyFixture, freshEnv, rawRequest, type Seen, tempRoot, withFakes } from "./cov-faces-helpers.ts";

type HttpModule = typeof import("../../src/faces/http.ts");

const root = tempRoot("http");
const ui = join(root, "ui");
mkdirSync(join(ui, "assets"), { recursive: true });
writeFileSync(join(ui, "index.html"), "<html>ui</html>");
writeFileSync(join(ui, "assets", "app.js"), "console.log(1)");
writeFileSync(join(ui, "blob.xyz"), "raw");
const project = copyFixture(root);
const other = copyFixture(root, "other");
writeFileSync(join(project, "notes.md"), "# notes");
const seen: Seen = { aborted: false, started: false };

let http: HttpModule;
let server: Server;
let port = 0;
let state: import("../../src/faces/http.ts").ServeState;
const cookie = "testimus_session=tok";

beforeAll(async () => {
  vi.resetModules();
  process.env.TESTIMUS_UI = ui;
  await freshEnv(root);
  const fakes = await withFakes(seen);
  vi.doMock("../../src/core/commands/index.ts", () => fakes);
  const { writeSettings, readSettings } = await import("../../src/core/lib/project.ts");
  writeSettings({ ...readSettings(), projects: [other, "\\\\host\\share"] });
  http = await import("../../src/faces/http.ts");
  state = { project, mock: true, port: 0, token: "tok" };
  server = createServer(http.handler(state));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  state.port = port;
});

afterAll(() => {
  server.close();
  vi.doUnmock("../../src/core/commands/index.ts");
  delete process.env.TESTIMUS_UI;
});

const api = (path: string, body?: string, headers: Record<string, string> = {}) =>
  rawRequest(port, path, {
    method: "POST",
    body,
    headers: {
      cookie,
      "content-type": "application/json",
      ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : { "content-length": "0" }),
      ...headers,
    },
  });

describe("HTTP face handler", () => {
  it("lists the commands at /api", async () => {
    const r = await rawRequest(port, "/api", { headers: { cookie } });
    const j = JSON.parse(r.text) as { project: string; mock: boolean; commands: { name: string }[] };
    expect(j.project).toBe(project);
    expect(j.mock).toBe(true);
    expect(j.commands.some((c) => c.name === "fake.boom")).toBe(true);
    expect((await rawRequest(port, "/api/", { headers: { cookie } })).status).toBe(200);
  });

  it("refuses an unknown host and a cross-site fetch", async () => {
    expect((await rawRequest(port, "/api", { host: "evil.example", headers: { cookie } })).status).toBe(403);
    const cross = await rawRequest(port, "/api", { headers: { cookie, "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(403);
    expect(cross.text).toContain("Cross-site");
    const origin = await rawRequest(port, "/api", { headers: { cookie, origin: "http://evil.example" } });
    expect(origin.status).toBe(403);
  });

  it("answers the version without a session", async () => {
    const r = await rawRequest(port, "/api/system/version");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toHaveProperty("version");
  });

  it("takes an empty POST as {} and sends null for nothing", async () => {
    const r = await api("/api/fake/void");
    expect(r.status).toBe(200);
    expect(r.text).toBe("null");
    const blank = await api("/api/fake/void", "  ");
    expect(blank.text).toBe("null");
  });

  it("refuses a body that is not JSON and a GET on a command", async () => {
    const bad = await api("/api/fake/void", "{nope");
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text).error).toBe("The request body is not valid JSON.");
    const get = await rawRequest(port, "/api/fake/void", { headers: { cookie } });
    expect(get.status).toBe(400);
    expect(JSON.parse(get.text).error).toBe("Call fake.void with POST and a JSON body.");
  });

  it("answers 500 for an Error and for a thrown string", async () => {
    const boom = await api("/api/fake/boom", "{}");
    expect(boom.status).toBe(500);
    expect(JSON.parse(boom.text).error).toBe("boom");
    const str = await api("/api/fake/str", "{}");
    expect(str.status).toBe(500);
    expect(JSON.parse(str.text).error).toBe("plain text");
  });

  it("starts a job, or waits for it with ?wait=1", async () => {
    const started = JSON.parse((await api("/api/fake/job", "{}")).text) as { jobId: string };
    expect(started.jobId).toMatch(/^fake-/);
    const waited = await api("/api/fake/job?wait=1", "{}");
    expect(JSON.parse(waited.text)).toEqual({ ok: true });
  });

  it("aborts a running command when the caller goes away", async () => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: "/api/fake/slow",
      method: "POST",
      headers: { cookie, "content-type": "application/json", "content-length": "2" },
    });
    req.on("error", () => {});
    req.end("{}");
    await vi.waitFor(() => expect(seen.started).toBe(true));
    req.destroy();
    await vi.waitFor(() => expect(seen.aborted).toBe(true));
  });

  it("opens a known project from the header or the query, refuses an unknown one", async () => {
    const byHeader = await api("/api/project/info", "{}", { "x-testimus-project": encodeURIComponent(other) });
    expect(byHeader.status).toBe(200);
    const byQuery = await api(`/api/project/info?project=${encodeURIComponent(other)}`, "{}");
    expect(byQuery.status).toBe(200);
    const unknown = await api("/api/project/info", "{}", { "x-testimus-project": encodeURIComponent(root) });
    expect(unknown.status).toBe(403);
    const unc = await api("/api/project/info", "{}", { "x-testimus-project": encodeURIComponent("\\\\host\\share") });
    expect(unc.status).toBe(403);
  });

  it("serves project files with the sandbox headers, and only files inside", async () => {
    const md = await rawRequest(port, "/files/notes.md", { headers: { cookie } });
    expect(md.status).toBe(200);
    expect(md.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(md.headers["content-security-policy"]).toContain("sandbox");
    expect((await rawRequest(port, "/files/.", { headers: { cookie } })).status).toBe(404);
    expect((await rawRequest(port, "/files/missing.md", { headers: { cookie } })).status).toBe(404);
    expect((await rawRequest(port, "/files/..%2F..%2Fescape", { headers: { cookie } })).status).toBe(404);
    expect((await rawRequest(port, "/files/%5C%5Chost%5Cshare", { headers: { cookie } })).status).toBe(404);
    const bad = await rawRequest(port, "/files/%E0%A4%A", { headers: { cookie } });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text).error).toBe("The file path is not valid URI encoding.");
  });

  it("serves the UI: index with the session, assets cached, unknown types as bytes, routes to index", async () => {
    const index = await rawRequest(port, "/");
    expect(index.text).toBe("<html>ui</html>");
    expect(String(index.headers["set-cookie"])).toContain("testimus_session=tok");
    const asset = await rawRequest(port, "/assets/app.js");
    expect(asset.headers["cache-control"]).toBe("max-age=31536000, immutable");
    expect(asset.headers["set-cookie"]).toBeUndefined();
    const blob = await rawRequest(port, "/blob.xyz");
    expect(blob.headers["content-type"]).toBe("application/octet-stream");
    expect(blob.headers["cache-control"]).toBe("no-cache");
    const route = await rawRequest(port, "/review/abc");
    expect(route.text).toBe("<html>ui</html>");
    expect(String(route.headers["set-cookie"])).toContain("SameSite=Strict");
  });

  it("answers 500 when the URL cannot be parsed", async () => {
    const r = await rawRequest(port, "//");
    expect(r.status).toBe(500);
  });

  it("answers 503 while stopping", async () => {
    state.stopping = true;
    try {
      const r = await rawRequest(port, "/api", { headers: { cookie } });
      expect(r.status).toBe(503);
      expect(r.headers.connection).toBe("close");
    } finally {
      state.stopping = false;
    }
  });
});

function fakeRes(throwOnHead: boolean, headersSent: boolean) {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const written: string[] = [];
  let heads = 0;
  Object.assign(res, {
    headersSent,
    writableEnded: false,
    written,
    status: 0,
    setHeader() {},
    writeHead(status: number) {
      heads++;
      if (throwOnHead && heads === 1) throw new Error("head failed");
      res.status = status;
    },
    write(s: string) {
      written.push(s);
      return true;
    },
    end(s?: string) {
      if (s) written.push(s);
    },
    destroy: vi.fn(),
  });
  return res;
}

function fakeReq(url: string, method = "GET", body = "") {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as Readable & Record<string, unknown>;
  Object.assign(req, { url, method, headers: { host: `127.0.0.1:${port}`, cookie } });
  return req;
}

describe("HTTP face handler, driven directly", () => {
  it("sends a 500 when answering throws before the headers, destroys the socket after", async () => {
    const h = http.handler({ ...state, stopping: true });
    const before = fakeRes(true, false);
    await h(fakeReq("/api") as never, before as never);
    expect(before.status).toBe(500);
    const after = fakeRes(true, true);
    await h(fakeReq("/api") as never, after as never);
    expect(after.destroy).toHaveBeenCalled();
  });

  it("streams job events on /api/events with a keep-alive ping until the page closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const h = http.handler(state);
      const req = fakeReq("/api/events");
      const res = fakeRes(false, false);
      await h(req as never, res as never);
      expect(res.written).toEqual([": hello\n\n"]);
      const { startJob } = await import("../../src/core/jobs.ts");
      await startJob("evt", "s", null, async () => null).done;
      expect((res.written as string[]).some((w) => w.startsWith("data: "))).toBe(true);
      vi.advanceTimersByTime(15000);
      expect(res.written).toContain(": ping\n\n");
      req.emit("close");
      const n = (res.written as string[]).length;
      await startJob("evt", "s", null, async () => null).done;
      vi.advanceTimersByTime(15000);
      expect((res.written as string[]).length).toBe(n);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a 500 with the text of a non-Error thrown while answering", async () => {
    const h = http.handler({ ...state, stopping: true });
    const res = fakeRes(false, false);
    let first = true;
    res.writeHead = (status: number) => {
      if (first) {
        first = false;
        throw "head text";
      }
      res.status = status;
    };
    await h(fakeReq("/api") as never, res as never);
    expect(res.status).toBe(500);
    expect((res.written as string[]).join("")).toContain("head text");
  });

  it("reads a request without a URL, a host or a length", async () => {
    const h = http.handler(state);
    const noUrl = fakeReq("/");
    noUrl.url = undefined;
    const page = fakeRes(false, false);
    await h(noUrl as never, page as never);
    expect(page.status).toBe(200);
    const noHost = fakeReq("/api");
    noHost.headers = { cookie };
    const refused = fakeRes(false, false);
    await h(noHost as never, refused as never);
    expect(refused.status).toBe(403);
    const noLength = fakeReq("/api/fake/void", "POST");
    const ok = fakeRes(false, false);
    await h(noLength as never, ok as never);
    expect(ok.status).toBe(200);
    const typeless = fakeReq("/api/fake/void", "POST", "{}");
    typeless.headers = { host: `127.0.0.1:${port}`, cookie, "content-length": "2" };
    const unsupported = fakeRes(false, false);
    await h(typeless as never, unsupported as never);
    expect(unsupported.status).toBe(415);
  });

  it("keeps project files inside a project at a drive root", async () => {
    const driveRoot = join(root, "/").slice(0, 3);
    const h = http.handler({ ...state, project: driveRoot });
    const res = fakeRes(false, false);
    await h(fakeReq("/files/testimus-cov-no-such-file.md") as never, res as never);
    expect(res.status).toBe(404);
  });

  it("refuses /files/ when no project is open", async () => {
    const h = http.handler({ ...state, project: null });
    const res = fakeRes(false, false);
    await h(fakeReq("/files/x.md") as never, res as never);
    expect(res.status).toBe(400);
    expect((res.written as string[]).join("")).toContain("No project is open.");
  });
});

describe("HTTP face without a built UI", () => {
  it("says the UI is not built", async () => {
    vi.resetModules();
    await freshEnv(root);
    vi.doMock("node:fs", async (importOriginal) => {
      const fs = await importOriginal<typeof import("node:fs")>();
      const existsSync = (p: string) => (String(p).endsWith("index.html") ? false : fs.existsSync(p));
      return { ...fs, existsSync, default: { ...fs, existsSync } };
    });
    try {
      const h = (await import("../../src/faces/http.ts")).handler({ ...state });
      const res = fakeRes(false, false);
      await h(fakeReq("/") as never, res as never);
      expect(res.status).toBe(404);
      expect((res.written as string[]).join("")).toContain("UI not built");
    } finally {
      vi.doUnmock("node:fs");
    }
  });
});
