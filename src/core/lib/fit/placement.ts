import type { CatalogEntry, Device, GpuInfo, MachineProfile } from "../../types.ts";
import { integrated } from "../machine/gpus.ts";
import { mainGpu } from "../machine/profile.ts";

export function isGguf(entry: CatalogEntry): boolean {
  return !entry.runtimes.includes("transformers");
}

// Where a model's weights live on this PC: on the main GPU when its runtime can reach it (llama.cpp always, onnxruntime
// through DirectML when the catalog has a DirectML variant), else on the processor
export function deviceFor(entry: CatalogEntry, machine: MachineProfile | null): "gpu" | "cpu" {
  if (!machine || !entry.devices.includes("gpu") || !mainGpu(machine)) return "cpu";
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
