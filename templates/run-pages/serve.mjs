// The small server of a Testimus run exported as pages: it serves this folder on 127.0.0.1 only, and writes back
// only the results of the run's tests (results/<testId>.json and the screenshots in results/<testId>/). Node only,
// no dependency. Usage: node serve.mjs [--port 8765] [--no-open]
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const WANTED = Number(option("--port", "8765"));
const MAX_JSON = 2 * 1024 * 1024;
const MAX_PICTURE = 20 * 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
const PICTURE = /^[A-Za-z0-9][\w.-]*\.(png|jpe?g|gif|webp|bmp)$/i;
const TEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const testIds = () => {
  try {
    const run = JSON.parse(readFileSync(join(ROOT, "run.json"), "utf8"));
    return new Set((run.tests ?? []).map((t) => t.id).filter((id) => TEST_ID.test(id) && !id.includes("..")));
  } catch {
    return new Set();
  }
};

// a path asked for is a file of this folder, or nothing — never above it, never a hidden file
function inside(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes("\0") || rel.includes("\\")) return null;
  const abs = resolve(ROOT, `.${rel.startsWith("/") ? rel : `/${rel}`}`);
  const back = relative(ROOT, abs);
  if (back.startsWith("..") || resolve(ROOT, back) !== abs) return null;
  if (back.split(sep).some((p) => p.startsWith("."))) return null;
  return abs;
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readBody(req, max) {
  return new Promise((ok, fail) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        fail(Object.assign(new Error("Too large."), { status: 413 }));
        req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => ok(Buffer.concat(parts)));
    req.on("error", fail);
  });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function state() {
  const run = JSON.parse(readFileSync(join(ROOT, "run.json"), "utf8"));
  const results = {};
  const dir = join(ROOT, "results");
  if (existsSync(dir))
    for (const f of readdirSync(dir))
      if (f.endsWith(".json") && TEST_ID.test(f.slice(0, -5)))
        try {
          results[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
        } catch {}
  return { run, results };
}

// a write goes to results/<a test of the run>.json (a JSON object) or results/<a test of the run>/<picture>, nothing else
async function put(req, res, path) {
  const m = /^\/results\/([^/]+?)(?:\.json|\/([^/]+))$/.exec(path);
  const id = m?.[1];
  if (!m || !id || !testIds().has(id)) return send(res, 403, { error: "Only the results of the run's tests are written." });
  if (m[2] === undefined) {
    const body = await readBody(req, MAX_JSON);
    let value;
    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      return send(res, 400, { error: "Not JSON." });
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return send(res, 400, { error: "Not a result." });
    writeAtomic(join(ROOT, "results", `${id}.json`), `${JSON.stringify(value, null, 2)}\n`);
    return send(res, 200, { ok: true });
  }
  if (!PICTURE.test(m[2])) return send(res, 403, { error: "Only a picture is written beside a result." });
  const body = await readBody(req, MAX_PICTURE);
  writeAtomic(join(ROOT, "results", id, m[2]), body);
  return send(res, 200, { ok: true });
}

let port = 0;

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: "Not this host." });
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`)
      return send(res, 403, { error: "Not this page." });
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method === "PUT") return await put(req, res, url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "GET and PUT only." });
    if (url.pathname === "/api/state") return send(res, 200, state());
    const file = inside(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!file || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: "Not found." });
    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.status ?? 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

function open(url) {
  const [cmd, cmdArgs] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true, windowsVerbatimArguments: true }).unref();
  } catch {}
}

function listen(at, tries) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 0) listen(at === 0 ? 0 : at + 1, tries - 1);
    else {
      console.error(`Cannot listen on 127.0.0.1: ${e.message}`);
      process.exit(1);
    }
  });
  server.listen(at, "127.0.0.1", () => {
    port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    console.log(`READY ${url}`);
    console.log(`The run is open on ${url} — keep this window open while you test; Ctrl+C stops it.`);
    if (!flag("--no-open")) open(url);
  });
}

listen(Number.isFinite(WANTED) ? WANTED : 8765, 20);
