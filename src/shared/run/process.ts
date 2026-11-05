import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { reasonOf, TimeoutError } from "./work.ts";

export type Stream = "stdout" | "stderr";

export type RunSpec = {
  exe: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  keepStdin?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?(line: string, stream: Stream): void;
  onSpawn?(pid: number): void;
};

export type Exit = {
  code: number;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  error?: string;
};

export type Proc = {
  pid: number | undefined;
  exited: Promise<Exit>;
  write(text: string): void;
  end(): void;
  kill(): Promise<void>;
};

const WIN = process.platform === "win32";
const live = new Map<number, ChildProcess>();

export function resolveExe(exe: string): string {
  if (!WIN || /[\\/]/.test(exe) || /\.(exe|cmd|bat)$/i.test(exe)) return exe;
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const ext of [".exe", ".cmd", ".bat"]) if (existsSync(join(dir, exe + ext))) return join(dir, exe + ext);
  return exe;
}

// ponytail: cmd re-reads its command line, so through a .cmd shim no argument may carry a cmd metacharacter (the caller
// only wraps a path with spaces in plain double quotes); a prompt always goes through stdin
export function unsafeShimArgument(exe: string, args: string[]): string | null {
  return [exe, ...args].find((a) => /[&|<>^%!"\r\n]/.test(a.replace(/^"(.*)"$/, "$1"))) ?? null;
}

function taskkill(): string {
  return join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
}

function descendants(pid: number): number[] {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  const kids = new Map<number, number[]>();
  for (const line of (ps.stdout ?? "").split("\n")) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (!child || !parent) continue;
    kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  const found: number[] = [];
  for (let queue = [pid]; queue.length; ) {
    const next = kids.get(queue.shift() as number) ?? [];
    found.push(...next);
    queue.push(...next);
  }
  return found;
}

// ponytail: a child started through cmd is a grandchild — only taskkill /T reaches the whole tree on Windows; elsewhere
// a child started here leads its own process group, and the group goes with the descendants ps knows (a tree started
// by someone else has no group of its own)
export function killTreeSync(pid: number): void {
  if (WIN) {
    spawnSync(taskkill(), ["/T", "/F", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" });
    return;
  }
  const tree = [pid, ...descendants(pid)];
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
  for (const p of tree)
    try {
      process.kill(p, "SIGKILL");
    } catch {}
}

export function killTree(pid: number): Promise<void> {
  if (!WIN) {
    killTreeSync(pid);
    return Promise.resolve();
  }
  return new Promise((r) => {
    const k = spawn(taskkill(), ["/T", "/F", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" });
    k.on("error", () => r());
    k.on("exit", () => r());
  });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function liveChildren(): number[] {
  return [...live.keys()];
}

export function killChildren(): number[] {
  const pids = liveChildren();
  for (const pid of pids) killTreeSync(pid);
  return pids;
}

function lines(onLine: (line: string) => void): { push(d: string): void; flush(): void } {
  let pending = "";
  return {
    push(d) {
      pending += d;
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const l of parts) if (l.trim()) onLine(l);
    },
    flush() {
      if (pending.trim()) onLine(pending);
      pending = "";
    },
  };
}

export function start(spec: RunSpec): Proc {
  const exe = resolveExe(spec.exe);
  const bare = exe.replace(/^"(.*)"$/, "$1");
  const viaShim = WIN && /\.(cmd|bat)$/i.test(bare);
  const unsafe = viaShim ? unsafeShimArgument(exe, spec.args) : null;
  const refused = (error: string, cancelled = false): Proc => ({
    pid: undefined,
    exited: Promise.resolve({
      code: cancelled ? 130 : 1,
      stdout: "",
      stderr: error,
      cancelled,
      timedOut: false,
      error,
    }),
    write() {},
    end() {},
    kill: () => Promise.resolve(),
  });
  if (unsafe !== null)
    return refused(`Refused to start ${exe} through cmd with an unsafe argument: ${unsafe.slice(0, 60)}`);
  if (spec.signal?.aborted) return refused(`${reasonOf(spec.signal).message} (before the program started)`, true);
  const options = {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    windowsHide: true,
    detached: !WIN,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
  };
  const child = viaShim
    ? spawn([/\s/.test(bare) ? `"${bare}"` : bare, ...spec.args].join(" "), { ...options, shell: true })
    : spawn(exe, spec.args, options);
  const pid = child.pid;
  if (pid) {
    live.set(pid, child);
    spec.onSpawn?.(pid);
  }
  let stdout = "";
  let stderr = "";
  let cancelled = false;
  let timedOut = false;
  const out = lines((l) => spec.onLine?.(l, "stdout"));
  const err = lines((l) => spec.onLine?.(l, "stderr"));
  const kill = () => (pid && live.has(pid) ? killTree(pid) : Promise.resolve());
  const stops = [spec.signal, spec.timeoutMs !== undefined ? AbortSignal.timeout(spec.timeoutMs) : undefined].filter(
    (s): s is AbortSignal => !!s,
  );
  const stopSignal = stops.length ? AbortSignal.any(stops) : undefined;
  const onStop = () => {
    const why = reasonOf(stopSignal as AbortSignal);
    if (why instanceof TimeoutError || why.name === "TimeoutError") timedOut = true;
    else cancelled = true;
    void kill();
  };
  stopSignal?.addEventListener("abort", onStop, { once: true });
  child.stdout?.setEncoding("utf8").on("data", (d: string) => {
    stdout += d;
    out.push(d);
  });
  child.stderr?.setEncoding("utf8").on("data", (d: string) => {
    stderr += d;
    err.push(d);
  });
  child.stdin?.on("error", () => {});
  if (!spec.keepStdin) child.stdin?.end(spec.stdin ?? "", "utf8");
  const exited = new Promise<Exit>((resolve) => {
    let error: string | undefined;
    child.on("error", (e) => {
      error = e.message;
    });
    // ponytail: a grandchild left running holds the pipes open; the group goes with its leader (Windows cannot reach
    // the tree of a parent that already exited)
    child.on("exit", () => {
      if (!WIN && pid)
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
    });
    child.on("close", (code) => {
      if (pid) live.delete(pid);
      stopSignal?.removeEventListener("abort", onStop);
      out.flush();
      err.flush();
      const failed = code === null || code === undefined;
      resolve({
        code: failed ? (cancelled ? 130 : timedOut ? 124 : 1) : code,
        stdout,
        stderr: error && !stderr ? error : stderr,
        cancelled,
        timedOut,
        error,
      });
    });
  });
  return {
    pid,
    exited,
    write: (text) => {
      if (child.stdin?.writable) child.stdin.write(text, "utf8");
    },
    end: () => child.stdin?.end(),
    kill,
  };
}

export function run(spec: RunSpec): Promise<Exit> {
  return start(spec).exited;
}

// ponytail: a program the user opens (a browser, an explorer window) is theirs — it is neither tracked nor killed
export function openDetached(exe: string, args: string[]): void {
  spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true })
    .on("error", () => {})
    .unref();
}

let guarded = false;

// ponytail: whatever ends this process — exit, a console closed, a signal — takes every child tree it started with it
export function killChildrenOnExit(): void {
  if (guarded) return;
  guarded = true;
  process.on("exit", () => {
    killChildren();
  });
}

export function onParentGone(stdin: NodeJS.ReadableStream, gone: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    gone();
  };
  stdin.on("end", once);
  stdin.on("close", once);
  stdin.on("error", once);
  stdin.resume();
}
