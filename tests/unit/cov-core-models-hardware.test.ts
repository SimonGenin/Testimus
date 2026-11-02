import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => ({
  answer: (_cmd: string): { err: (Error & { code?: unknown }) | null; stdout: string | undefined } => ({
    err: null,
    stdout: "",
  }),
  calls: [] as string[],
}));
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execFile: (cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, out?: string) => void) => {
      exec.calls.push(cmd);
      const a = exec.answer(cmd);
      queueMicrotask(() => cb(a.err, a.stdout));
      return {};
    },
  };
});

import { env } from "../../src/core/env.ts";
import {
  driveOf,
  type HardwareDeps,
  hardwareDeps,
  knownMachine,
  machineProfile,
  measureMachine,
  parseNvidiaSmi,
  parseRegistryVram,
  parseWmi,
  pinMachineProfile,
  vendorOf,
} from "../../src/core/lib/models-hardware.ts";
import type { MachineProfile } from "../../src/core/types.ts";

const realNow = env.now;
const platform = process.platform;
const setPlatform = (p: string) => Object.defineProperty(process, "platform", { value: p, configurable: true });

beforeEach(() => {
  exec.calls = [];
  exec.answer = () => ({ err: null, stdout: "" });
  pinMachineProfile(null);
});
afterEach(() => {
  setPlatform(platform);
  env.now = realNow;
  pinMachineProfile(null);
  vi.unstubAllEnvs();
});

describe("the real hardware seams", () => {
  it("run maps a numeric error code, a non-numeric one to 1, and a missing stdout to empty", async () => {
    exec.answer = (cmd) =>
      cmd === "a"
        ? { err: Object.assign(new Error("x"), { code: 3 }), stdout: "out" }
        : cmd === "b"
          ? { err: Object.assign(new Error("x"), { code: "ENOENT" }), stdout: undefined }
          : { err: null, stdout: "ok" };
    expect(await hardwareDeps.exec("a", [], 10)).toEqual({ code: 3, stdout: "out" });
    expect(await hardwareDeps.exec("b", [], 10)).toEqual({ code: 1, stdout: "" });
    expect(await hardwareDeps.exec("c", [], 10)).toEqual({ code: 0, stdout: "ok" });
  });

  it("statfs reads a drive and gives null for a path that does not exist", () => {
    const s = hardwareDeps.statfs(process.cwd());
    expect(s?.totalMB).toBeGreaterThan(0);
    expect(hardwareDeps.statfs("Q:\\definitely\\not\\here\\nope")).toBeNull();
  });

  it("drives lists the Windows roots that exist, and / elsewhere", () => {
    if (platform === "win32") expect(hardwareDeps.drives()).toContain("C:\\");
    setPlatform("linux");
    expect(hardwareDeps.drives()).toEqual(["/"]);
  });

  it("memory, cpu and loaded servers", async () => {
    expect(hardwareDeps.mem().totalMB).toBeGreaterThan(0);
    expect(hardwareDeps.cpu().threads).toBeGreaterThan(0);
    expect(Array.isArray(await hardwareDeps.loaded())).toBe(true);
  });
});

describe("parsers", () => {
  it("nvidia-smi without memory figures gives null VRAM; a decimal registry size is read too", () => {
    expect(parseNvidiaSmi("RTX, 551, [N/A], [N/A]")[0]).toMatchObject({ vramTotalMB: null, vramUsedMB: null });
    const descs = "HKEY_X\\0000\n    DriverDesc    REG_SZ    Card\n";
    const sizes = "HKEY_X\\0000\n    HardwareInformation.qwMemorySize    REG_QWORD    2097152\n";
    expect(parseRegistryVram(sizes, descs).get("Card")).toBe(2);
  });
});

describe("vendorOf and parseWmi", () => {
  it("names the vendor or other", () => {
    expect(vendorOf("Matrox G200")).toBe("other");
    expect(vendorOf("Intel Arc A770")).toBe("intel");
  });

  it("keeps only named real adapters, with their driver when given", () => {
    expect(parseWmi('{"Name":" AMD Radeon ","DriverVersion":"31"}')).toEqual([{ name: "AMD Radeon", driver: "31" }]);
    expect(parseWmi('[{"Name":"Microsoft Basic Display Adapter"},{"Nope":1},null]')).toEqual([]);
    expect(parseWmi("not json")).toEqual([]);
  });
});

const fakeDeps = (over: Partial<HardwareDeps> = {}): HardwareDeps => ({
  exec: async () => ({ code: 1, stdout: "" }),
  statfs: (root) => (root === "C:\\" ? { freeMB: 10, totalMB: 20 } : null),
  drives: () => ["C:\\", "Z:\\"],
  loaded: async () => [],
  mem: () => ({ totalMB: 16000, freeMB: 8000 }),
  cpu: () => ({ model: "cpu", threads: 8 }),
  ...over,
});

describe("measureMachine", () => {
  it("off Windows: only nvidia-smi is asked; a failing exec or loaded list gives nothing", async () => {
    setPlatform("linux");
    const asked: string[] = [];
    const m = await measureMachine(
      fakeDeps({
        exec: async (cmd) => {
          asked.push(cmd);
          throw new Error("no nvidia-smi");
        },
        loaded: async () => {
          throw new Error("no servers");
        },
      }),
    );
    expect(asked).toEqual(["nvidia-smi"]);
    expect(m).toMatchObject({ gpus: [], loaded: [], drives: [{ root: "C:\\", freeMB: 10, totalMB: 20 }] });
  });

  it("on Windows: an nvidia card seen by nvidia-smi is not listed twice, WMI adds the others with registry VRAM", async () => {
    setPlatform("win32");
    const reg = (value: string, v: string) => `HKEY_LOCAL_MACHINE\\X\\0001\n    ${value}    REG_SZ    ${v}\n`;
    const m = await measureMachine(
      fakeDeps({
        exec: async (cmd, args) => {
          if (cmd === "nvidia-smi")
            return {
              code: 0,
              stdout: "name, driver_version, memory.total, memory.used\nRTX 4060, 551, 8188 MiB, 100 MiB\n",
            };
          if (cmd === "powershell.exe")
            return {
              code: 0,
              stdout:
                '[{"Name":"rtx 4060"},{"Name":"NVIDIA Quadro"},{"Name":"AMD Radeon","DriverVersion":"31"},{"Name":"Intel UHD"}]',
            };
          return args.includes("DriverDesc")
            ? { code: 0, stdout: reg("DriverDesc", "AMD Radeon") }
            : { code: 0, stdout: reg("HardwareInformation.qwMemorySize", "0x100000000") };
        },
      }),
    );
    expect(m.gpus.map((g) => `${g.name}:${g.vendor}:${g.source}:${g.vramTotalMB}:${g.driver ?? "-"}`)).toEqual([
      "RTX 4060:nvidia:nvidia-smi:8188:551",
      "AMD Radeon:amd:registry:4096:31",
      "Intel UHD:intel:wmi:null:-",
    ]);
  });
});

describe("machineProfile", () => {
  const profile = (at: string): MachineProfile => ({
    at,
    ramTotalMB: 1,
    ramFreeMB: 1,
    cpu: { model: "x", threads: 1 },
    gpus: [],
    drives: [{ root: "D:\\", freeMB: 1, totalMB: 2 }],
    loaded: [],
  });

  it("measures once, reuses it for ten minutes, and measures again on refresh or when stale", async () => {
    vi.stubEnv("TESTIMUS_MACHINE", "");
    exec.answer = () => ({ err: Object.assign(new Error("absent"), { code: 1 }), stdout: "" });
    const t = Date.parse("2026-11-02T10:00:00Z");
    env.now = () => new Date(t);
    const first = await machineProfile({ refresh: true });
    expect(knownMachine()).toBe(first);
    expect(await machineProfile()).toBe(first);
    const n = exec.calls.length;
    env.now = () => new Date(t + 11 * 60 * 1000);
    const second = await machineProfile();
    expect(second).not.toBe(first);
    expect(exec.calls.length).toBeGreaterThan(n);
    expect(await machineProfile({ refresh: true })).not.toBe(second);
  });

  it("a pinned profile wins over a measure", async () => {
    vi.stubEnv("TESTIMUS_MACHINE", "");
    const p = profile("2026-01-01T00:00:00Z");
    pinMachineProfile(p);
    expect(await machineProfile()).toBe(p);
    expect(knownMachine()).toBe(p);
  });
});

describe("driveOf", () => {
  it("finds the drive of a path, case-insensitively", () => {
    const m = { drives: [{ root: "D:\\", freeMB: 1, totalMB: 2 }] } as MachineProfile;
    expect(driveOf(m, "d:\\models\\x")?.root).toBe("D:\\");
    expect(driveOf(m, "E:\\x")).toBeUndefined();
  });
});
