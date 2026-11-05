import { describe, expect, it } from "vitest";
import {
  isIntegrated,
  isLegacyIgpu,
  isVirtual,
  matchName,
  mergeGpus,
  rankGpus,
  usableGpus,
} from "../../../../src/core/lib/machine/gpus.ts";
import { mainGpu } from "../../../../src/core/lib/machine/profile.ts";
import { parseLlamaDevices } from "../../../../src/core/lib/machine/sources.ts";
import { chooseBackend } from "../../../../src/core/rag/runtimes/llamacpp.ts";
import type { GpuInfo, MachineProfile } from "../../../../src/core/types.ts";

const gpu = (name: string, vramTotalMB: number | null = null, over: Partial<GpuInfo> = {}): GpuInfo => ({
  name,
  vendor: /nvidia|rtx/i.test(name) ? "nvidia" : /amd|radeon/i.test(name) ? "amd" : "intel",
  vramTotalMB,
  vramUsedMB: null,
  source: "wmi",
  ...over,
});
const pc = (gpus: GpuInfo[]): MachineProfile => ({
  at: "2026-11-05T10:00:00.000Z",
  ramTotalMB: 32000,
  ramFreeMB: 20000,
  cpu: { model: "cpu", threads: 8 },
  gpus,
  drives: [],
  loaded: [],
});

// The names below are the cases llmfit (github.com/AlexsJones/llmfit, MIT) met on real machines
describe("integrated or discrete", () => {
  it("Intel is integrated unless it names a discrete Arc product code", () => {
    for (const n of [
      "Intel(R) UHD Graphics 620",
      "Intel(R) Iris(R) Xe Graphics",
      "Intel(R) Graphics",
      "Intel(R) Arc(TM) Graphics",
      "Intel(R) Arc(TM) 140V GPU",
    ])
      expect(isIntegrated(n), n).toBe(true);
    for (const n of ["Intel(R) Arc(TM) A770 Graphics", "Intel(R) Arc(TM) A370M Graphics", "Intel(R) Arc(TM) Pro B60"])
      expect(isIntegrated(n), n).toBe(false);
  });

  it("AMD « Radeon Graphics » and the Radeon ###M names are integrated; RX, Pro and Vega are discrete", () => {
    for (const n of ["AMD Radeon(TM) Graphics", "AMD Radeon 780M Graphics", "AMD Radeon 890M", "AMD Radeon 610M"])
      expect(isIntegrated(n), n).toBe(true);
    for (const n of ["AMD Radeon RX 7600", "AMD Radeon RX 7900M", "AMD Radeon Pro W7900", "Radeon RX Vega 56 Graphics"])
      expect(isIntegrated(n), n).toBe(false);
    expect(isIntegrated("NVIDIA GeForce RTX 4060 Laptop GPU")).toBe(false);
  });

  it("Intel HD / UHD and the old Core controllers are no GPU for a model; Iris Xe and Arc are", () => {
    expect(isLegacyIgpu("Intel(R) UHD Graphics 620")).toBe(true);
    expect(isLegacyIgpu("Intel(R) HD Graphics 520")).toBe(true);
    expect(isLegacyIgpu("Intel(R) 4th Gen Core Processor Integrated Graphics Controller")).toBe(true);
    expect(isLegacyIgpu("Intel(R) Iris(R) Xe Graphics")).toBe(false);
    expect(isLegacyIgpu("Intel(R) Arc(TM) Graphics")).toBe(false);
    expect(isLegacyIgpu("AMD Radeon(TM) Graphics")).toBe(false);
  });

  it("remote, basic and virtual adapters are not GPUs", () => {
    for (const n of [
      "Microsoft Basic Display Adapter",
      "Microsoft Remote Display Adapter",
      "Parsec Virtual Display Adapter",
      "Microsoft Hyper-V Video",
    ])
      expect(isVirtual(n), n).toBe(true);
    expect(isVirtual("NVIDIA GeForce RTX 5080")).toBe(false);
  });
});

describe("matching one adapter's name across sources", () => {
  it("an exact match first, through (R) and (TM)", () => {
    const list = ["Intel(R) Arc(TM) A770 Graphics", "Intel Arc A770 Graphics (DG2)"];
    expect(matchName("Intel Arc A770 Graphics", list, (x) => x)).toBe("Intel(R) Arc(TM) A770 Graphics");
  });

  it("a partial match only when one candidate fits", () => {
    expect(matchName("NVIDIA RTX 4090", ["RTX 4090", "RTX 4090 Ti"], (x) => x)).toBe("RTX 4090");
    expect(matchName("RTX 4090", ["NVIDIA RTX 4090", "NVIDIA RTX 4090 Ti"], (x) => x)).toBeUndefined();
    expect(matchName("", ["x"], (x) => x)).toBeUndefined();
  });
});

describe("one list from every source", () => {
  it("nvidia-smi for NVIDIA, the registry size for the others, the free memory from llama.cpp", () => {
    const gpus = mergeGpus({
      nvidia: [gpu("NVIDIA GeForce RTX 3050 Laptop GPU", 4096, { vramUsedMB: 300, source: "nvidia-smi" })],
      wmi: [
        { name: "NVIDIA GeForce RTX 3050 Laptop GPU" },
        { name: "AMD Radeon RX 7600", driver: "31.0" },
        { name: "Microsoft Basic Display Adapter" },
      ],
      registry: new Map([["AMD Radeon RX 7600", 8176]]),
      llama: parseLlamaDevices(
        "Available devices:\n  Vulkan0: AMD Radeon RX 7600 (8176 MiB, 7000 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 3050 Laptop GPU (4096 MiB, 100 MiB free)\n",
      ),
    });
    expect(gpus.map((g) => [g.name, g.vramTotalMB, g.vramUsedMB, g.source, g.integrated])).toEqual([
      ["NVIDIA GeForce RTX 3050 Laptop GPU", 4096, 300, "nvidia-smi", false],
      ["AMD Radeon RX 7600", 8176, 1176, "llama.cpp", false],
    ]);
  });

  it("a GPU only llama.cpp sees is listed with its figures", () => {
    const gpus = mergeGpus({
      nvidia: [],
      wmi: [],
      registry: new Map(),
      llama: [{ id: "Vulkan0", name: "AMD Radeon RX 6600", totalMB: 8176, freeMB: 8000 }],
    });
    expect(gpus).toEqual([
      {
        name: "AMD Radeon RX 6600",
        vendor: "amd",
        vramTotalMB: 8176,
        vramUsedMB: 176,
        source: "llama.cpp",
        integrated: false,
      },
    ]);
  });

  it("never takes an integrated GPU's figures from Vulkan: they are the PC's RAM echoed back", () => {
    // `llama-server --list-devices` of the Vulkan build b12032 on a 64 GB PC with an RTX 5080 and a Core Ultra
    const llama = parseLlamaDevices(
      "Available devices:\r\n  Vulkan0: NVIDIA GeForce RTX 5080 (16193 MiB, 15400 MiB free)\r\n  Vulkan1: Intel(R) Graphics (37037 MiB, 37037 MiB free)\r\n",
    );
    expect(llama).toHaveLength(2);
    const listed = mergeGpus({
      nvidia: [gpu("NVIDIA GeForce RTX 5080", 16303, { vramUsedMB: 2038, source: "nvidia-smi" })],
      wmi: [{ name: "NVIDIA GeForce RTX 5080" }, { name: "Intel(R) Graphics" }],
      registry: new Map(),
      llama,
    });
    expect(listed.map((g) => [g.name, g.vramTotalMB, g.vramUsedMB, g.source, g.integrated])).toEqual([
      ["NVIDIA GeForce RTX 5080", 16303, 2038, "nvidia-smi", false],
      ["Intel(R) Graphics", null, null, "wmi", true],
    ]);
    const alone = mergeGpus({ nvidia: [], wmi: [], registry: new Map(), llama: [llama[1]] });
    expect(alone[0]).toMatchObject({ name: "Intel(R) Graphics", vramTotalMB: null, integrated: true });
  });

  it("reads llama.cpp's device list, and nothing from a list without devices", () => {
    expect(
      parseLlamaDevices("Available devices:\n  CUDA0: NVIDIA GeForce RTX 5080 (16302 MiB, 14980 MiB free)\n"),
    ).toEqual([{ id: "CUDA0", name: "NVIDIA GeForce RTX 5080", totalMB: 16302, freeMB: 14980 }]);
    expect(parseLlamaDevices("Available devices:\n  (none)\n")).toEqual([]);
  });
});

describe("the GPU models run on", () => {
  it("a discrete GPU before an integrated one that reports more memory (an APU's 8 GB carve-out)", () => {
    const m = pc([gpu("AMD Radeon(TM) Graphics", 8192), gpu("NVIDIA GeForce RTX 3050 Laptop GPU", 4096)]);
    expect(mainGpu(m)?.name).toBe("NVIDIA GeForce RTX 3050 Laptop GPU");
    expect(rankGpus(m.gpus).map((g) => g.name)).toEqual([
      "NVIDIA GeForce RTX 3050 Laptop GPU",
      "AMD Radeon(TM) Graphics",
    ]);
  });

  it("an integrated GPU when it is the only one; none when it is an Intel HD / UHD or a virtual adapter", () => {
    expect(mainGpu(pc([gpu("Intel(R) Iris(R) Xe Graphics", 128)]))?.name).toBe("Intel(R) Iris(R) Xe Graphics");
    expect(mainGpu(pc([gpu("Intel(R) UHD Graphics 620", 128)]))).toBeNull();
    expect(mainGpu(pc([gpu("Microsoft Basic Display Adapter")]))).toBeNull();
    expect(usableGpus([gpu("Intel(R) UHD Graphics 620"), gpu("AMD Radeon RX 7600", 8192)]).map((g) => g.name)).toEqual([
      "AMD Radeon RX 7600",
    ]);
  });

  it("the llama.cpp build follows: CUDA for a recent NVIDIA driver, Vulkan for another usable GPU, else the processor", () => {
    expect(chooseBackend(pc([gpu("Intel(R) UHD Graphics 620")]))).toBe("cpu");
    expect(chooseBackend(pc([gpu("Intel(R) Iris(R) Xe Graphics")]))).toBe("vulkan");
    expect(
      chooseBackend(pc([gpu("Intel(R) UHD Graphics 630"), gpu("NVIDIA GeForce RTX 3050", 4096, { driver: "591.44" })])),
    ).toBe("cuda");
  });
});
