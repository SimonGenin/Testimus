import type { CatalogEntry, Device, GpuInfo, MachineProfile, RuntimeId } from "../../types.ts";
import { integrated, usableGpus } from "../machine/gpus.ts";
import { mainGpu } from "../machine/profile.ts";

// ponytail: a model run by a native engine (llama.cpp, whisper.cpp) is one file; an ONNX one is a folder
export function isGguf(entry: CatalogEntry): boolean {
  return !entry.runtimes.includes("transformers");
}

// The engine that runs a catalog entry on this PC: onnxruntime when the entry has an ONNX form, else its native engine
export function runtimeFor(entry: CatalogEntry): RuntimeId | null {
  for (const r of ["transformers", "llamacpp", "whispercpp"] as const) if (entry.runtimes.includes(r)) return r;
  return null;
}

// ponytail: whisper.cpp publishes no Vulkan build for Windows — only an NVIDIA card (its CUDA 12.4 build, driver 551
// or later) takes speech off the processor
export const WHISPER_CUDA_DRIVER = 551;
export function nvidiaReady(machine: MachineProfile | null, minDriver: number): boolean {
  return usableGpus(machine?.gpus ?? []).some(
    (g) => g.vendor === "nvidia" && g.driver !== undefined && Number.parseFloat(g.driver) >= minDriver,
  );
}

// Where a model's weights live on this PC: on the main GPU when its runtime can reach it (llama.cpp always, whisper.cpp
// on an NVIDIA card, onnxruntime through DirectML when the catalog has a DirectML variant), else on the processor
export function deviceFor(entry: CatalogEntry, machine: MachineProfile | null): "gpu" | "cpu" {
  if (!machine || !entry.devices.includes("gpu") || !mainGpu(machine)) return "cpu";
  if (entry.runtimes.includes("whispercpp")) return nvidiaReady(machine, WHISPER_CUDA_DRIVER) ? "gpu" : "cpu";
  return isGguf(entry) || entry.dtypeByDevice?.dml ? "gpu" : "cpu";
}

// The device its runtime is told: llama.cpp offloads to « gpu », onnxruntime runs « dml »
export function deviceOf(entry: CatalogEntry, machine: MachineProfile | null): Device {
  if (deviceFor(entry, machine) === "cpu") return "cpu";
  return isGguf(entry) ? "gpu" : "dml";
}

export function onIntegratedGpu(entry: CatalogEntry, machine: MachineProfile): boolean {
  const gpu = mainGpu(machine);
  return !!gpu && integrated(gpu) && deviceFor(entry, machine) === "gpu";
}

export type GpuPool = {
  gpu: GpuInfo;
  shared: boolean;
  totalMB: number | null;
  freeMB: number | null;
  freeMeasured: boolean;
};

// ponytail: an integrated GPU has no memory of its own — what it holds comes out of the PC's RAM, so its pool is the
// RAM (and a model on it competes with the ones on the processor)
export function gpuPool(machine: MachineProfile): GpuPool | null {
  const gpu = mainGpu(machine);
  if (!gpu) return null;
  if (integrated(gpu))
    return { gpu, shared: true, totalMB: machine.ramTotalMB, freeMB: machine.ramFreeMB, freeMeasured: true };
  const total = gpu.vramTotalMB;
  return {
    gpu,
    shared: false,
    totalMB: total,
    freeMB: total === null ? null : total - (gpu.vramUsedMB ?? 0),
    freeMeasured: gpu.vramUsedMB !== null,
  };
}
