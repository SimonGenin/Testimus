import { homedir } from "node:os";
import { join } from "node:path";
import { start, unsafeShimArgument } from "../shared/run/process.ts";

export type HttpReq = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBytes?: Uint8Array;
  binary?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};
export type HttpRes = { status: number; headers: Record<string, string>; text?: string; bytes?: Uint8Array };

export type ClaudeSpawn = {
  exe: string;
  args: string[];
  cwd: string;
  stdin: string;
  signal?: AbortSignal;
  onLine?(line: string): void;
  onSpawn?(pid: number): void;
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
  // ponytail: how long a read waits before it answers — 0 but in --mock, where TESTIMUS_MOCK_READ_MS slows one on purpose
  readMs(name: string): number;
};

async function nodeHttp(req: HttpReq): Promise<HttpRes> {
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 60000);
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: (req.bodyBytes as BodyInit | undefined) ?? req.body,
    signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  if (req.binary) return { status: res.status, headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  return { status: res.status, headers, text: await res.text() };
}

export async function nodeSpawnClaude(run: ClaudeSpawn): Promise<ClaudeOut> {
  const exe = run.exe || "claude";
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(exe)) {
    const unsafe = unsafeShimArgument(exe, run.args);
    if (unsafe !== null)
      throw new Error(`Refused to start claude through cmd with an unsafe argument: ${unsafe.slice(0, 60)}`);
  }
  if (run.signal?.aborted) return { code: 130, stdout: "", stderr: "Cancelled before claude started." };
  const proc = start({
    exe,
    args: run.args,
    cwd: run.cwd,
    stdin: run.stdin,
    signal: run.signal,
    onSpawn: run.onSpawn,
    onLine: run.onLine ? (line, stream) => stream === "stdout" && run.onLine?.(line) : undefined,
  });
  const exit = await proc.exited;
  if (proc.pid === undefined && exit.error) throw new Error(exit.error);
  return { code: exit.code, stdout: exit.stdout, stderr: exit.stderr };
}

export const env: Env = {
  mock: false,
  http: nodeHttp,
  homeDir: () => process.env.TESTIMUS_HOME || homedir(),
  dataDir: () => join(process.env.APPDATA || join(homedir(), ".config"), "Testimus"),
  localDir: () => join(process.env.LOCALAPPDATA || join(homedir(), ".local", "share"), "Testimus"),
  spawnClaude: nodeSpawnClaude,
  now: () => new Date(),
  readMs: () => 0,
};
