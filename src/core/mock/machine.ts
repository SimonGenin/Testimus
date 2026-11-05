import { homedir, tmpdir } from "node:os";
import { parse } from "node:path";
import { env } from "../env.ts";
import type { GpuInfo, LoadedModel, MachineProfile } from "../types.ts";

export const MOCK_MACHINES = ["gpu16", "gpu-small", "cpu-only", "unknown", "dev", "mac", "mac-intel", "apu"] as const;
export type MockMachine = (typeof MOCK_MACHINES)[number];

const GB = 1024;

function gpu(name: string, totalMB: number | null, usedMB: number | null, source: GpuInfo["source"]): GpuInfo {
  const vendor = /nvidia|geforce|rtx/i.test(name) ? "nvidia" : /radeon|amd/i.test(name) ? "amd" : "intel";
  return {
    name,
    vendor,
    ...(vendor === "nvidia" ? { driver: "591.44" } : { driver: "32.0.101.6913" }),
    vramTotalMB: totalMB,
    vramUsedMB: usedMB,
    source,
  };
}

// ponytail: drives the core on this host can write to — Windows drive letters there, the home folder elsewhere (as
// models.hardware reads them): a C:\ offered on a Mac is a folder the core refuses
function drives(): MachineProfile["drives"] {
  if (process.platform !== "win32") return [{ root: homedir(), freeMB: 640 * GB, totalMB: 1863 * GB }];
  const roots = new Set(["C:\\", "D:\\", parse(tmpdir()).root.toUpperCase()]);
  return [...roots].sort().map((root) => ({
    root,
    freeMB: root === "C:\\" ? 92 * GB : 640 * GB,
    totalMB: root === "C:\\" ? 475 * GB : 1863 * GB,
  }));
}

export function mockMachine(kind: MockMachine, loaded: LoadedModel[] = []): MachineProfile {
  const held = loaded.reduce((a, l) => a + l.vramMB, 0);
  const base = { at: env.now().toISOString(), system: { platform: "win32", arch: "x64" }, drives: drives(), loaded };
  switch (kind) {
    case "gpu-small":
      return {
        ...base,
        ramTotalMB: 16 * GB,
        ramFreeMB: 9 * GB,
        cpu: { model: "Intel(R) Core(TM) i5-12500H", threads: 16 },
        gpus: [gpu("NVIDIA GeForce RTX 3050 Laptop GPU", 4 * GB, 300 + held, "nvidia-smi")],
      };
    case "cpu-only":
      return {
        ...base,
        loaded: [],
        ramTotalMB: 6 * GB,
        ramFreeMB: 4 * GB,
        cpu: { model: "Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz", threads: 8 },
        gpus: [],
      };
    case "unknown":
      return {
        ...base,
        ramTotalMB: 32 * GB,
        ramFreeMB: 20 * GB,
        cpu: { model: "AMD Ryzen 7 7700X 8-Core Processor", threads: 16 },
        gpus: [gpu("AMD Radeon RX 7600", null, null, "wmi")],
      };
    case "mac":
      return {
        ...base,
        system: { platform: "darwin", arch: "arm64" },
        drives: [{ root: "/", freeMB: 210 * GB, totalMB: 926 * GB }],
        loaded: [],
        ramTotalMB: 32 * GB,
        ramFreeMB: 14 * GB,
        cpu: { model: "Apple M2 Pro", threads: 12 },
        gpus: [],
      };
    case "mac-intel":
      return {
        ...base,
        system: { platform: "darwin", arch: "x64" },
        onnx: "1.23.2",
        drives: [{ root: "/", freeMB: 180 * GB, totalMB: 932 * GB }],
        loaded: [],
        ramTotalMB: 64 * GB,
        ramFreeMB: 15 * GB,
        cpu: { model: "Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz", threads: 16 },
        gpus: [],
      };
    case "apu":
      return {
        ...base,
        loaded: [],
        ramTotalMB: 32 * GB,
        ramFreeMB: 18 * GB,
        cpu: { model: "AMD Ryzen 7 7840U w/ Radeon 780M Graphics", threads: 16 },
        gpus: [{ ...gpu("AMD Radeon 780M Graphics", 512, null, "registry"), integrated: true }],
      };
    case "dev":
      return {
        ...base,
        ramTotalMB: 64978,
        ramFreeMB: 41200,
        cpu: { model: "Intel(R) Core(TM) Ultra 9 285K", threads: 24 },
        gpus: [
          gpu("NVIDIA GeForce RTX 5080", 16303, 2282 + held, "nvidia-smi"),
          gpu("Intel(R) Graphics", null, null, "wmi"),
        ],
      };
    default:
      return {
        ...base,
        ramTotalMB: 32 * GB,
        ramFreeMB: 21 * GB,
        cpu: { model: "AMD Ryzen 9 7900X 12-Core Processor", threads: 24 },
        gpus: [gpu("NVIDIA GeForce RTX 4080", 16 * GB, 1200 + held, "nvidia-smi")],
      };
  }
}

export function mockMachineKind(raw = process.env.TESTIMUS_MOCK_MACHINE): MockMachine {
  return (MOCK_MACHINES as readonly string[]).includes(raw ?? "") ? (raw as MockMachine) : "gpu16";
}
