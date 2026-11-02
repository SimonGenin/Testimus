import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type HttpReq = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBytes?: Uint8Array;
  binary?: boolean;
  timeoutMs?: number;
};
export type HttpRes = { status: number; headers: Record<string, string>; text?: string; bytes?: Uint8Array };

export type ClaudeSpawn = {
  exe: string;
  args: string[];
  cwd: string;
  stdin: string;
  signal?: AbortSignal;
  onLine?(line: string): void;
};
export type ClaudeOut = { code: number; stdout: string; stderr: string };

export type Env = {
  mock: boolean;
  http(req: HttpReq): Promise<HttpRes>;
  homeDir(): string;
  dataDir(): string;
  localDir(): string;
  spawnClaude(run: ClaudeSpawn): Promise<ClaudeOut>;
  now(): Date;
};

async function nodeHttp(req: HttpReq): Promise<HttpRes> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: (req.bodyBytes as BodyInit | undefined) ?? req.body,
    signal: AbortSignal.timeout(req.timeoutMs ?? 60000),
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  if (req.binary) return { status: res.status, headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  return { status: res.status, headers, text: await res.text() };
}

export function resolveExe(exe: string): string {
  if (process.platform !== "win32" || /[\\/]/.test(exe) || /\.(exe|cmd|bat)$/i.test(exe)) return exe;
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const ext of [".exe", ".cmd", ".bat"]) if (existsSync(join(dir, exe + ext))) return join(dir, exe + ext);
  return exe;
}

const children = new Set<number>();

export function liveChildren(): number[] {
  return [...children];
}

// ponytail: a claude started through cmd is a grandchild — only taskkill /T reaches the whole tree
export function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

export function killChildren(): number[] {
  const pids = liveChildren();
  for (const pid of pids) killTree(pid);
  return pids;
}

export function nodeSpawnClaude(run: ClaudeSpawn): Promise<ClaudeOut> {
  return new Promise((resolve, reject) => {
    const exe = resolveExe(run.exe || "claude");
    const viaShell = process.platform === "win32" && !/\.exe$/i.test(exe);
    // ponytail: cmd re-reads its command line, so through a .cmd shim no argument may carry a cmd metacharacter
    // (the caller only wraps a path with spaces in plain double quotes); the prompt always goes through stdin
    const unsafe = viaShell ? [exe, ...run.args].find((a) => /[&|<>^%!"\r\n]/.test(a.replace(/^"(.*)"$/, "$1"))) : null;
    if (unsafe !== null && unsafe !== undefined) {
      reject(new Error(`Refused to start claude through cmd with an unsafe argument: ${unsafe.slice(0, 60)}`));
      return;
    }
    if (run.signal?.aborted) {
      resolve({ code: 130, stdout: "", stderr: "Cancelled before claude started." });
      return;
    }
    const child = viaShell
      ? spawn([exe, ...run.args].join(" "), { cwd: run.cwd, shell: true, windowsHide: true, env: process.env })
      : spawn(exe, run.args, { cwd: run.cwd, windowsHide: true, env: process.env });
    const pid = child.pid;
    if (pid) {
      children.add(pid);
      child.on("exit", () => children.delete(pid));
    }
    let stdout = "";
    let stderr = "";
    let pending = "";
    const onAbort = () => (pid ? killTree(pid) : child.kill());
    run.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      if (!run.onLine) return;
      pending += d;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) run.onLine(l);
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", (e) => {
      run.signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.on("close", (code) => {
      run.signal?.removeEventListener("abort", onAbort);
      if (pending.trim() && run.onLine) run.onLine(pending);
      resolve({ code: code ?? (run.signal?.aborted ? 130 : 1), stdout, stderr });
    });
    child.stdin.end(run.stdin, "utf8");
  });
}

export const env: Env = {
  mock: false,
  http: nodeHttp,
  homeDir: () => process.env.TESTIMUS_HOME || homedir(),
  dataDir: () => join(process.env.APPDATA || join(homedir(), ".config"), "Testimus"),
  localDir: () => join(process.env.LOCALAPPDATA || join(homedir(), ".local", "share"), "Testimus"),
  spawnClaude: nodeSpawnClaude,
  now: () => new Date(),
};

// ponytail: the smallest semaphore that works — a finished slot is handed straight to the next waiter
export function gate(n: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>) => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r));
    else active++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
