import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";

const spawned: { command: string; args: string[] | object; opts: unknown }[] = [];

vi.doMock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (command: string, args: string[] | object, opts?: unknown) => {
    spawned.push({ command, args, opts: Array.isArray(args) ? opts : args });
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
    });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  },
}));

const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
Object.defineProperty(process, "platform", { value: "win32" });
vi.resetModules();
const { run } = await import("../../../src/shared/run/process.ts");
Object.defineProperty(process, "platform", platform);

afterAll(() => {
  vi.doUnmock("node:child_process");
});

describe("process on Windows: a .cmd shim goes through cmd", () => {
  it("a shim path with a space, quoted by the caller, still goes through cmd as one line", async () => {
    spawned.length = 0;
    const exe = '"C:\\Users\\Jean Dupont\\AppData\\Roaming\\npm\\claude.cmd"';
    await run({ exe, args: ["-p", "--model", "opus"] });
    expect(spawned[0].command).toBe(`${exe} -p --model opus`);
    expect(spawned[0].opts).toMatchObject({ shell: true });
  });

  it("a shim path with a space, given bare, is quoted for cmd", async () => {
    spawned.length = 0;
    await run({ exe: "C:\\Users\\Jean Dupont\\AppData\\Roaming\\npm\\claude.cmd", args: ["--version"] });
    expect(spawned[0].command).toBe('"C:\\Users\\Jean Dupont\\AppData\\Roaming\\npm\\claude.cmd" --version');
    expect(spawned[0].opts).toMatchObject({ shell: true });
  });

  it("a quoted shim still refuses a cmd metacharacter", async () => {
    spawned.length = 0;
    const exit = await run({ exe: '"C:\\a b\\claude.cmd"', args: ["a&calc"] });
    expect(spawned).toEqual([]);
    expect(exit.error).toMatch(/unsafe argument: a&calc/);
  });
});
