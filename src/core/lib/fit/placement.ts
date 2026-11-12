import { availableParallelism } from "node:os";
import type {
  CatalogEntry,
  Device,
  GpuInfo,
  LlamaBackend,
  MachineProfile,
  ResolvedModel,
  RuntimeId,
} from "../../types.ts";
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

// ponytail: a model process on the processor (the embed worker, a llama-server) leaves two of its threads to the rest
// of the PC (the page, a conversion)
export function embedThreads(machine: MachineProfile | null): number {
  return Math.max(1, (machine?.cpu.threads ?? availableParallelism()) - 2);
}

// Where llama-server computes a model: on the card when its build has one and this PC gives the model the card; a PC
// not profiled yet trusts the build
export function llamaOnGpu(entry: CatalogEntry, machine: MachineProfile | null, backend: LlamaBackend): boolean {
  return backend !== "cpu" && (!machine || deviceFor(entry, machine) === "gpu");
}

export type EmbedPlace = {
  where: "gpu" | "cpu";
  engine: "onnxruntime" | "llama.cpp";
  threads: number | null;
  card: "DirectML" | "CUDA" | "Vulkan" | null;
};

// Where the embeddings of a model run on this PC — always outside the core: an ONNX model in the embed worker (on the
// card through DirectML when its install runs there, else on the processor with embedThreads), a GGUF one in its
// llama-server (on the card when the llama.cpp build has one, else on the processor with embedThreads too). The model
// installed is never changed for a card: an ONNX model without a DirectML form (BGE-M3 8-bit) stays on the processor,
// the packs offer the card's models. `llama` is the llama.cpp build of this PC (null: none yet)
export function embedPlace(
  m: ResolvedModel,
  machine: MachineProfile | null,
  llama: LlamaBackend | null = null,
): EmbedPlace {
  // ponytail: --mock runs every model with its fake runtime; the place said is the one the catalog gives this machine
  const runtime = m.runtime === "mock" ? runtimeFor(m.entry) : m.runtime;
  if (runtime === "llamacpp") {
    const onGpu = llama ? llamaOnGpu(m.entry, machine, llama) : deviceOf(m.entry, machine) !== "cpu";
    if (!onGpu) return { where: "cpu", engine: "llama.cpp", threads: embedThreads(machine), card: null };
    return {
      where: "gpu",
      engine: "llama.cpp",
      threads: null,
      card: llama === "vulkan" ? "Vulkan" : llama ? "CUDA" : null,
    };
  }
  const device = m.runtime === "mock" ? deviceOf(m.entry, machine) : m.device;
  return device === "cpu"
    ? { where: "cpu", engine: "onnxruntime", threads: embedThreads(machine), card: null }
    : { where: "gpu", engine: "onnxruntime", threads: null, card: "DirectML" };
}

export function embedPlaceText(p: EmbedPlace): string {
  const program = p.engine === "llama.cpp" ? "llama.cpp" : "separate process";
  return p.where === "gpu"
    ? `Embedding: graphics card${p.card ? ` (${p.card})` : ""}, ${program}`
    : `Embedding: processor, ${p.threads} cores, ${program}`;
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
