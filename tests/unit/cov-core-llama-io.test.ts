import { afterEach, describe, expect, it, vi } from "vitest";

const smi: { err: Error | null; stdout: string | undefined } = { err: null, stdout: "" };

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execFile: (_cmd: string, _args: string[], _opts: object, cb: (e: Error | null, out?: string) => void) => {
      cb(smi.err, smi.stdout);
    },
  };
});

const { serverIo } = await import("../../src/core/rag/runtimes/llama-server.ts");

const node = process.execPath;
const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
const systemRoot = process.env.SystemRoot;

afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  process.env.SystemRoot = systemRoot;
});

function sleeper() {
  return serverIo.spawn(node, ["-e", "setInterval(() => {}, 1000)"]);
}

describe("llama-server process io", () => {
  it("spawns a process, streams stdout and stderr, and resolves its exit code", async () => {
    const p = serverIo.spawn(node, ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"]);
    const seen: string[] = [];
    p.onOutput((t) => seen.push(t));
    expect(p.pid).toBeTypeOf("number");
    expect(await p.exited).toBe(3);
    expect(seen.join("")).toContain("out");
    expect(seen.join("")).toContain("err");
  });

  it("a missing executable exits with -1 and says why", async () => {
    const p = serverIo.spawn("D:/nowhere/llama-server-missing.exe", []);
    const seen: string[] = [];
    p.onOutput((t) => seen.push(t));
    expect(await p.exited).toBe(-1);
    expect(seen.join("")).toMatch(/ENOENT/);
  });

  it("finds a free loopback port", async () => {
    const port = await serverIo.freePort();
    expect(port).toBeGreaterThan(0);
  });

  it("kills a process tree (Windows) and synchronously", async () => {
    const a = sleeper();
    await serverIo.kill(a.pid as number);
    expect(await a.exited).not.toBe(0);
    const b = sleeper();
    serverIo.killSync(b.pid as number);
    expect(await b.exited).not.toBe(0);
  });

  it("falls back to C:\\Windows without SystemRoot, and a taskkill that cannot start still resolves", async () => {
    const a = sleeper();
    const b = sleeper();
    process.env.SystemRoot = "";
    await serverIo.kill(a.pid as number);
    process.env.SystemRoot = "D:/no-such-windows";
    await serverIo.kill(b.pid as number);
    process.env.SystemRoot = systemRoot;
    for (const p of [a, b])
      try {
        process.kill(p.pid as number);
      } catch {}
    expect(await a.exited).not.toBe(0);
    expect(await b.exited).not.toBe(0);
  });

  it("on other platforms it signals the process, ignoring one already gone", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const a = sleeper();
    await serverIo.kill(a.pid as number);
    await a.exited;
    await serverIo.kill(a.pid as number);
    const b = sleeper();
    serverIo.killSync(b.pid as number);
    await b.exited;
    serverIo.killSync(b.pid as number);
  });

  it("sleeps and makes a random key", async () => {
    const t = Date.now();
    await serverIo.sleep(5);
    expect(Date.now() - t).toBeGreaterThanOrEqual(3);
    expect(serverIo.randomKey()).toMatch(/^[0-9a-f]{48}$/);
    expect(serverIo.now()).toBeGreaterThan(0);
  });

  it("reads the NVIDIA memory used: summed over GPUs, null on error or no output", async () => {
    smi.err = null;
    smi.stdout = "1200\r\n800\n\n";
    expect(await serverIo.vramUsedMB()).toBe(2000);
    smi.stdout = undefined;
    expect(await serverIo.vramUsedMB()).toBeNull();
    smi.stdout = "garbage";
    expect(await serverIo.vramUsedMB()).toBeNull();
    smi.err = new Error("not found");
    smi.stdout = "100";
    expect(await serverIo.vramUsedMB()).toBeNull();
  });
});
