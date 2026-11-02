import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { log } from "./log.ts";

export const READY_TIMEOUT_MS = 30_000;
export const STOP_TIMEOUT_MS = 10_000;
export const UI_DEV_PORT = 4318;

export type Ready = { url: string; origin: string; pid?: number; version?: string };
export type Launch = { command: string; args: string[]; cwd: string };
export type Core = { child: ChildProcess; ready: Promise<Ready>; exited: Promise<number | null> };

export type RunningJob = {
  id: string;
  kind: string;
  subject: string;
  status: string;
  pid?: number;
  progress?: { done: number; total: number };
  project?: string;
};

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export function localOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" || !LOCAL_HOSTS.includes(u.hostname) || !u.port) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function parseReady(line: string): Ready | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.ready !== true || typeof o.url !== "string") return null;
  const origin = localOrigin(o.url);
  if (!origin) return null;
  return {
    url: `${origin}/`,
    origin,
    pid: typeof o.pid === "number" && Number.isInteger(o.pid) ? o.pid : undefined,
    version: typeof o.version === "string" ? o.version : undefined,
  };
}

export function findNode(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string | null {
  if (env.TESTIMUS_NODE) return exists(env.TESTIMUS_NODE) ? env.TESTIMUS_NODE : null;
  const exe = process.platform === "win32" ? "node.exe" : "node";
  const path = env.PATH ?? env.Path ?? "";
  for (const dir of path.split(delimiter)) {
    if (!dir.trim()) continue;
    const candidate = join(dir.trim().replace(/^"|"$/g, ""), exe);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function shellArgs(
  argv: string[],
  cwd: string,
  isDir: (p: string) => boolean,
): { mock: boolean; uiDev: boolean; folder: string | null } {
  const rest = argv.slice(1);
  let folder: string | null = null;
  for (const a of rest) {
    if (!a || a.startsWith("-")) continue;
    const abs = resolve(cwd, a);
    if (isDir(abs)) folder = abs;
  }
  return { mock: rest.includes("--mock"), uiDev: rest.includes("--ui-dev"), folder };
}

export const SERVE_FLAGS = ["serve", "--port", "0", "--no-open", "--ready-json", "--exit-with-stdin"];

export function coreLaunch(o: {
  packaged: boolean;
  exeDir: string;
  repo: string;
  node: string | null;
  mock: boolean;
  port?: number;
  project?: string | null;
}): Launch {
  const flags = [
    ...(o.port ? SERVE_FLAGS.map((f, i) => (i === 2 ? String(o.port) : f)) : SERVE_FLAGS),
    ...(o.port ? ["--port-fallback"] : []),
    ...(o.mock ? ["--mock"] : []),
    ...(o.project && !o.mock ? ["--project", o.project] : []),
  ];
  if (o.packaged)
    return {
      command: join(o.exeDir, "node", "node.exe"),
      args: [join(o.exeDir, "app", "testimus.mjs"), ...flags],
      cwd: o.exeDir,
    };
  if (!o.node) throw new Error("Node was not found on the PATH: install Node 26 or set TESTIMUS_NODE to node.exe.");
  return { command: o.node, args: [join(o.repo, "src", "faces", "cli.ts"), ...flags], cwd: o.repo };
}

export function coreEnv(
  base: NodeJS.ProcessEnv,
  o: { shellVersion: string; packaged: boolean; exeDir: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, TESTIMUS_SHELL: `desktop/${o.shellVersion}` };
  delete env.ELECTRON_RUN_AS_NODE;
  if (o.packaged) {
    env.NODE_USE_ENV_PROXY = "1";
    env.TESTIMUS_HOME_BIN = o.exeDir;
  }
  if (env.NODE_USE_ENV_PROXY === "1") {
    const keys = Object.keys(env).filter((k) => k.toUpperCase() === "NO_PROXY");
    const value = keys.map((k) => env[k]).find((v) => v?.trim());
    for (const k of keys) delete env[k];
    env.NO_PROXY = withLoopback(value);
  }
  return env;
}

// ponytail: Node 26 sends even 127.0.0.1 through HTTP_PROXY under NODE_USE_ENV_PROXY=1 unless NO_PROXY names it; the
// user's own NO_PROXY is kept and the loopback names appended
export function withLoopback(value: string | undefined): string {
  const loopback = ["localhost", "127.0.0.1", "::1"];
  const have = (value ?? "").split(",").map((s) => s.trim().toLowerCase());
  const missing = loopback.filter((h) => !have.includes(h));
  if (!missing.length) return value ?? "";
  return value?.trim() ? `${value},${missing.join(",")}` : missing.join(",");
}

export function startCore(launch: Launch, env: NodeJS.ProcessEnv, timeoutMs = READY_TIMEOUT_MS): Core {
  log("shell", `starting the core: ${launch.command} ${launch.args.join(" ")}`);
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      log("shell", `the core exited (code ${code})`);
      resolve(code);
    });
    child.once("error", (e) => {
      log("shell", `the core could not start: ${e.message}`);
      resolve(null);
    });
  });
  const ready = new Promise<Ready>((resolve, reject) => {
    let done = false;
    const finish = (r: Ready | Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (r instanceof Error) reject(r);
      else resolve(r);
    };
    const timer = setTimeout(() => {
      finish(new Error(`The core did not answer within ${Math.round(timeoutMs / 1000)} s.`));
      if (child.pid) killTree(child.pid);
    }, timeoutMs);
    if (child.stdout)
      createInterface({ input: child.stdout }).on("line", (line) => {
        log("core", line);
        const r = parseReady(line);
        if (r) finish(r);
      });
    if (child.stderr) createInterface({ input: child.stderr }).on("line", (line) => log("core", line));
    child.stdin?.on("error", () => {});
    exited.then((code) => finish(new Error(`The core stopped (exit code ${code ?? "none"}) before it was ready.`)));
  });
  ready.catch(() => {});
  return { child, ready, exited };
}

export function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
  else
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
}

export async function stopCore(core: Core, timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
  if (core.child.exitCode !== null || core.child.signalCode !== null || !core.child.pid) return;
  core.child.stdin?.end();
  const timedOut = await Promise.race([
    core.exited.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), timeoutMs)),
  ]);
  if (!timedOut) return;
  log("shell", `the core did not stop within ${timeoutMs / 1000} s: killing its process tree`);
  killTree(core.child.pid);
  await Promise.race([core.exited, new Promise((r) => setTimeout(r, 3000))]);
}

export function startUiDev(node: string, repo: string, target: string): ChildProcess {
  const child = spawn(
    node,
    [join(repo, "node_modules", "vite", "bin", "vite.js"), "--port", String(UI_DEV_PORT), "--strictPort"],
    {
      cwd: repo,
      env: { ...process.env, TESTIMUS_API_TARGET: target },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  for (const s of [child.stdout, child.stderr])
    if (s) createInterface({ input: s }).on("line", (l) => log("ui-dev", l));
  return child;
}

export async function waitHttp(url: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = request(url, { method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => req.destroy());
      req.end();
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ponytail: node:http rather than fetch, which adds an Origin header the core's guard would refuse
export function http(
  url: string,
  o: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: o.method, headers: o.headers, timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`${url} did not answer`)));
    if (o.body) req.write(o.body);
    req.end();
  });
}

export async function sessionCookie(origin: string): Promise<string> {
  const r = await http(`${origin}/`, { method: "GET" });
  const raw = r.headers["set-cookie"];
  const first = (Array.isArray(raw) ? raw : raw ? [raw] : []).find((c) => c.startsWith("testimus_session="));
  return first ? first.split(";")[0] : "";
}

export async function api<T>(
  origin: string,
  cookie: string,
  name: string,
  input: unknown,
  project?: string,
): Promise<T> {
  const [group, verb] = name.split(".");
  const headers: Record<string, string> = { "content-type": "application/json", cookie };
  if (project) headers["x-testimus-project"] = encodeURIComponent(project);
  const r = await http(`${origin}/api/${group}/${verb}`, { method: "POST", headers, body: JSON.stringify(input) });
  if (r.status !== 200) throw new Error(`${name}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text) as T;
}

export async function runningJobs(origin: string, cookie: string, corePid?: number): Promise<RunningJob[]> {
  const listed = await api<{ last: string; projects: { dir: string; exists: boolean }[] }>(
    origin,
    cookie,
    "project.list",
    {},
  ).catch(() => ({ last: "", projects: [] }));
  const dirs = [
    ...new Set([listed.last, ...listed.projects.filter((p) => p.exists).map((p) => p.dir)].filter(Boolean)),
  ];
  const seen = new Map<string, RunningJob>();
  for (const dir of dirs.length ? dirs : [undefined]) {
    const jobs = await api<RunningJob[]>(origin, cookie, "jobs.list", { running: true }, dir).catch(() => []);
    for (const j of jobs) if (!seen.has(j.id)) seen.set(j.id, { ...j, project: dir });
  }
  return [...seen.values()].filter(
    (j) => j.status === "running" && (corePid === undefined || j.pid === undefined || j.pid === corePid),
  );
}

export async function cancelJobs(origin: string, cookie: string, jobs: RunningJob[]): Promise<void> {
  for (const j of jobs) await api(origin, cookie, "jobs.cancel", { id: j.id }, j.project).catch(() => {});
}

const KIND: Record<string, string> = {
  generate: "Generate tests",
  fix: "Claude fix",
  check: "Check tests",
  claude: "Claude request",
  chat: "Ask the documents",
  pull: "Pull from Jira",
  push: "Push to Jira",
  "docs.add": "Add document",
  "docs.convert": "Convert document",
  "describe-figures": "Describe figures",
  "rag-index": "Index documents",
  "rag-eval": "Measure search",
  pullModel: "Download model",
};

export function jobLine(j: RunningJob): string {
  const label = KIND[j.kind] ?? j.kind;
  const subject = j.subject ? ` · ${j.subject.length > 60 ? `${j.subject.slice(0, 59)}…` : j.subject}` : "";
  const p = j.progress && j.progress.total > 0 ? `${j.progress.done}/${j.progress.total}` : "running";
  return `${label}${subject} — ${p}`;
}

export type QuitDecision = { ask: false } | { ask: true; message: string; detail: string };

export function quitDecision(jobs: RunningJob[]): QuitDecision {
  if (!jobs.length) return { ask: false };
  return {
    ask: true,
    message: jobs.length === 1 ? "A job is still running." : `${jobs.length} jobs are still running.`,
    detail: `${jobs.map(jobLine).join("\n")}\n\nCancel and quit stops ${jobs.length === 1 ? "it" : "them"} and the Claude runs ${jobs.length === 1 ? "it started" : "they started"}.`,
  };
}
