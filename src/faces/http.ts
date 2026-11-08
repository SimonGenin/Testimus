import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { UserError } from "../core/command.ts";
import { describe as describeCommand, find, invoke, registry } from "../core/commands/index.ts";
import { env } from "../core/env.ts";
import { subscribe } from "../core/jobs.ts";
import { isProject, readSettings, resolveProjectDir } from "../core/lib/project.ts";
import { loopbackProxyGap, onStopSignals, stopCore } from "../core/shell.ts";
import { watchProject } from "../core/watch.ts";
import { onParentGone, openDetached } from "../shared/run/process.ts";
import { every } from "../shared/run/work.ts";
import { uncPath } from "../shared/unc.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
};

function uiDir(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [process.env.TESTIMUS_UI, join(here, "..", "..", "dist", "ui"), join(here, "ui")];
  for (const c of candidates) if (c && existsSync(join(c, "index.html"))) return c;
  return join(here, "..", "..", "dist", "ui");
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new UserError("The request body is not valid JSON.");
  }
}

function send(res: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

function sendFile(res: ServerResponse, file: string, cache = false, extra: Record<string, string> = {}): void {
  res.writeHead(200, {
    ...extra,
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cache ? "max-age=31536000, immutable" : "no-cache",
  });
  res.end(readFileSync(file));
}

// ponytail: a project file answers a byte range (RFC 7233, one range) so the page's video player can seek; a range
// past the end is 416, a malformed one is ignored and the whole file is sent
export function rangeOf(header: string | undefined, size: number): { start: number; end: number } | "bad" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start >= size || start > end ? "bad" : { start, end };
}

function sendProjectFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const base = { ...FILE_HEADERS, "content-type": type, "cache-control": "no-cache", "accept-ranges": "bytes" };
  const range = rangeOf(req.headers.range, size);
  if (range === "bad") {
    res.writeHead(416, { ...base, "content-range": `bytes */${size}` });
    res.end();
    return;
  }
  if (!range) {
    res.writeHead(200, { ...base, "content-length": String(size) });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(206, {
    ...base,
    "content-length": String(range.end - range.start + 1),
    "content-range": `bytes ${range.start}-${range.end}/${size}`,
  });
  createReadStream(file, { start: range.start, end: range.end }).pipe(res);
}

function inside(root: string, rel: string): string | null {
  const full = normalize(resolve(root, rel));
  return full === root || full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}

export type ServeOpts = { port: number; project: string | null; mock: boolean };
export type ServeState = { project: string | null; mock: boolean; port: number; token: string; stopping?: boolean };

const COOKIE = "testimus_session";
export const UI_CSP =
  "default-src 'self'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'";
const FILE_HEADERS = {
  "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
};

function cookieOf(req: IncomingMessage): string {
  const m = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : "";
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type Refusal = { status: number; error: string };

// ponytail: binding 127.0.0.1 does not stop a page on another site from sending requests here. The API and
// project files answer only a page this server served: a SameSite=Strict session cookie (never sent
// cross-site), a local Host (no DNS rebinding), a local Origin when there is one, and JSON bodies only.
export function guard(req: IncomingMessage, state: ServeState): Refusal | null {
  const local = [`localhost:${state.port}`, `127.0.0.1:${state.port}`, `[::1]:${state.port}`];
  const refuse = (error: string, status = 403): Refusal => ({ status, error });
  if (!local.includes(String(req.headers.host ?? "").toLowerCase())) return refuse("Unknown host.");
  const origin = req.headers.origin;
  if (origin && !local.map((h) => `http://${h}`).includes(origin.toLowerCase()))
    return refuse("Cross-origin request refused.");
  if (req.headers["sec-fetch-site"] === "cross-site") return refuse("Cross-site request refused.");
  if (!same(cookieOf(req), state.token)) return refuse("No Testimus session: open the app from its own address.");
  if (req.method === "POST") {
    const hasBody = req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > 0;
    if (hasBody && !/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] ?? "")))
      return refuse("Send JSON (Content-Type: application/json).", 415);
  }
  return null;
}

// ponytail: kept in the user's data folder so a tab left open survives a restart of Testimus
function sessionToken(): string {
  const file = join(env.dataDir(), "session.key");
  try {
    const kept = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{48}$/.test(kept)) return kept;
  } catch {}
  const token = randomBytes(24).toString("hex");
  mkdirSync(env.dataDir(), { recursive: true });
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

const pathKey = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

// ponytail: the asked folder is matched as a string against the known list before anything touches the disk;
// only the known entry it matches is ever opened
export function knownProject(asked: string, state: ServeState): string | null {
  if (uncPath(asked)) return null;
  const key = pathKey(asked);
  const hit = [state.project, ...readSettings().projects]
    .filter((p): p is string => !!p && !uncPath(p))
    .find((p) => pathKey(p) === key);
  return hit && isProject(resolve(hit)) ? resolve(hit) : null;
}

function askedProject(req: IncomingMessage, url: URL): string | null {
  const header = req.headers["x-testimus-project"];
  if (typeof header !== "string" || !header) return url.searchParams.get("project") || null;
  try {
    return decodeURIComponent(header);
  } catch {
    throw new UserError("The X-Testimus-Project header is not a valid URI-encoded path.");
  }
}

export function handler(state: ServeState) {
  const dist = uiDir();
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await answer(req, res);
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      else res.destroy();
    }
  };

  async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (state.stopping) {
      res.setHeader("connection", "close");
      send(res, 503, { error: "Testimus is stopping." });
      return;
    }
    const guarded = url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/");
    const isPublic = req.method === "GET" && url.pathname === "/api/system/version";
    if (guarded && !isPublic) {
      const refused = guard(req, state);
      if (refused) {
        send(res, refused.status, { error: refused.error });
        return;
      }
    }
    try {
      const asked = guarded && !isPublic ? askedProject(req, url) : null;
      const open = state.project && existsSync(state.project) ? state.project : null;
      const project = asked ? knownProject(asked, state) : open;
      if (asked && !project) {
        send(res, 403, { error: "Not a known Testimus project.", fix: "Open it from the project menu first." });
        return;
      }
      if (project) watchProject(project);
      const listing = url.pathname === "/api" || url.pathname === "/api/" || url.pathname === "/api/events";
      if (listing && req.method !== "GET") {
        res.setHeader("allow", "GET");
        send(res, 405, { error: `${url.pathname} answers GET only.` });
        return;
      }
      if (url.pathname === "/api" || url.pathname === "/api/") {
        send(res, 200, { project: open, mock: state.mock, commands: registry.map(describeCommand) });
        return;
      }
      if (url.pathname === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        res.write(": hello\n\n");
        const unsub = subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
        const stopPing = every(15000, () => res.write(": ping\n\n"));
        req.on("close", () => {
          stopPing();
          unsub();
        });
        return;
      }
      const m = url.pathname.match(/^\/api\/([a-zA-Z]+)\/([a-zA-Z]+)$/);
      if (m) {
        const name = `${m[1]}.${m[2]}`;
        const c = find(name);
        if (req.method !== "POST" && !isPublic) throw new UserError(`Call ${name} with POST and a JSON body.`);
        const input = req.method === "POST" ? await body(req) : {};
        const ctrl = new AbortController();
        res.on("close", () => {
          if (!c.job && !res.writableEnded) ctrl.abort();
        });
        const cause = String(req.headers["x-testimus-cause"] ?? "").match(
          /^(after-failure|follow-up|retry) ([\w.-]+)$/,
        );
        const result = await invoke(name, input, {
          project,
          signal: c.job ? undefined : ctrl.signal,
          wait: url.searchParams.get("wait") === "1",
          ...(cause ? { cause: { jobId: cause[2], why: cause[1] as "after-failure" | "follow-up" | "retry" } } : {}),
        });
        send(res, 200, result ?? null);
        return;
      }
      if (url.pathname.startsWith("/files/")) {
        if (!project) throw new UserError("No project is open.");
        let rel: string;
        try {
          rel = decodeURIComponent(url.pathname.slice("/files/".length));
        } catch {
          throw new UserError("The file path is not valid URI encoding.");
        }
        const file = uncPath(rel) ? null : inside(resolve(project), rel);
        if (!file || !existsSync(file) || !statSync(file).isFile()) {
          send(res, 404, { error: "Not found" });
          return;
        }
        sendProjectFile(req, res, file);
        return;
      }
      const session = {
        "set-cookie": `${COOKIE}=${state.token}; Path=/; HttpOnly; SameSite=Strict`,
        "content-security-policy": UI_CSP,
      };
      const asset = inside(resolve(dist), url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      if (asset && existsSync(asset) && statSync(asset).isFile()) {
        sendFile(res, asset, url.pathname.startsWith("/assets/"), asset.endsWith(".html") ? session : {});
        return;
      }
      const index = join(dist, "index.html");
      if (existsSync(index)) sendFile(res, index, false, session);
      else send(res, 404, { error: "UI not built — run npm run build" });
    } catch (e) {
      if (e instanceof UserError)
        send(res, e.code === "conflict" ? 409 : 400, {
          error: e.message,
          fix: e.fix,
          ...(e.code ? { code: e.code } : {}),
        });
      else send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function portOf(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value.trim()) || port > 65535)
    throw new UserError(`Not a port: ${value}.`, "Use a number from 0 to 65535 (0 lets the system pick a free one).");
  return port;
}

// ponytail: under --ready-json stdout is the shell's channel and carries the ready line only; anything a module
// prints there goes to stderr instead
function stdoutToStderr(): (line: string) => void {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return (line) => write(`${line}\n`);
}

export async function serve(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      project: { type: "string" },
      mock: { type: "boolean" },
      "no-open": { type: "boolean" },
      "ready-json": { type: "boolean" },
      "exit-with-stdin": { type: "boolean" },
      "port-fallback": { type: "boolean" },
    },
    strict: false,
  });
  const ready = values["ready-json"] === true ? stdoutToStderr() : null;
  const port = portOf(String(values.port ?? process.env.TESTIMUS_PORT ?? 4317));
  const mock = values.mock === true;
  let project = resolveProjectDir(typeof values.project === "string" ? values.project : undefined);
  if (mock) {
    const { setupMock } = await import("../core/mock/index.ts");
    project = await setupMock();
  }
  const state: ServeState = { project, mock, port, token: sessionToken() };
  const server = createServer(handler(state));
  const listen = (p: number) =>
    new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(p, "127.0.0.1", () => {
        server.off("error", fail);
        ok();
      });
    });
  // ponytail: the desktop shell asks for the port of its last run (same origin, so the page's localStorage —
  // theme, widths — survives a restart) and takes any free one when that port is taken
  try {
    await listen(port);
  } catch (e) {
    // ponytail: taken (EADDRINUSE) or, on Windows, inside a range Hyper-V/WinNAT reserved since the last run (EACCES)
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (values["port-fallback"] !== true || port === 0 || !["EADDRINUSE", "EACCES"].includes(code)) throw e;
    await listen(0);
  }
  state.port = (server.address() as AddressInfo).port;
  const stop = (why: string) => {
    if (state.stopping) {
      if (why.startsWith("SIG")) process.exit(1);
      return;
    }
    state.stopping = true;
    process.stderr.write(`Testimus stopping (${why}).\n`);
    void stopCore({
      closeServer: () => {
        server.close();
        server.closeIdleConnections();
      },
      dropConnections: () => server.closeAllConnections(),
      exit: (code) => process.exit(code),
    });
  };
  onStopSignals((s) => stop(s));
  process.on("unhandledRejection", (e) =>
    process.stderr.write(`Testimus: unhandled error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`),
  );
  const gap = loopbackProxyGap();
  if (gap) process.stderr.write(`Testimus: ${gap}. Run testimus system doctor for the fix.\n`);
  if (values["exit-with-stdin"] === true) onParentGone(process.stdin, () => stop("stdin closed"));
  const url = `http://localhost:${state.port}/`;
  process.stderr.write(`Testimus on ${url}${mock ? " (mock)" : ""}${project ? ` — project ${project}` : ""}\n`);
  if (ready) {
    const { version } = (await invoke("system.version", {}, { project: null })) as { version: string };
    ready(JSON.stringify({ ready: true, url: `http://127.0.0.1:${state.port}/`, pid: process.pid, version }));
  }
  if (!values["no-open"] && !mock && !ready) {
    if (process.platform === "win32") openDetached("cmd", ["/c", "start", "", url]);
    else openDetached(process.platform === "darwin" ? "open" : "xdg-open", [url]);
  }
}
