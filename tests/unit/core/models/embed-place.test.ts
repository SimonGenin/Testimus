import { availableParallelism } from "node:os";
import { describe, expect, it } from "vitest";
import {
  deviceOf,
  embedPlace,
  embedPlaceText,
  embedThreads,
  llamaOnGpu,
} from "../../../../src/core/lib/fit/placement.ts";
import { catalogEntry } from "../../../../src/core/lib/models-catalog.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import type { CatalogEntry, MachineProfile, ResolvedModel, RuntimeId } from "../../../../src/core/types.ts";

const gpu16 = mockMachine("gpu16");
const cpuOnly = mockMachine("cpu-only");

// ponytail: a model as this PC would resolve it — its catalog runtime, the device the machine gives it
function installed(id: string, machine: MachineProfile, runtime?: RuntimeId): ResolvedModel {
  const entry = catalogEntry(id) as CatalogEntry;
  const rt = runtime ?? (entry.runtimes.includes("transformers") ? "transformers" : "llamacpp");
  return {
    entry,
    install: { model: id, via: "path", runtime: rt, status: "installed" },
    runtime: rt,
    device: deviceOf(entry, machine),
    queryTask: "q",
  } as ResolvedModel;
}

describe("where the embeddings run, per machine", () => {
  it("the processor keeps two threads for the rest of the PC, never less than one for the worker", () => {
    expect(embedThreads(gpu16)).toBe(22);
    expect(embedThreads(cpuOnly)).toBe(6);
    expect(embedThreads({ ...cpuOnly, cpu: { model: "x", threads: 2 } })).toBe(1);
    expect(embedThreads(null)).toBe(Math.max(1, availableParallelism() - 2));
  });

  it("no GPU: an ONNX model on the processor in the separate process, with N cores", () => {
    for (const id of ["bge-m3-q8", "bge-m3-fp16", "qwen3-embedding-0.6b-onnx-fp16"]) {
      const p = embedPlace(installed(id, cpuOnly), cpuOnly);
      expect(p).toEqual({ where: "cpu", engine: "onnxruntime", threads: 6, card: null });
      expect(embedPlaceText(p)).toBe("Embedding: processor, 6 cores, separate process");
    }
  });

  it("a card: an ONNX model with a DirectML form runs on it, in the separate process", () => {
    const p = embedPlace(installed("qwen3-embedding-0.6b-onnx-fp16", gpu16), gpu16);
    expect(p).toEqual({ where: "gpu", engine: "onnxruntime", threads: null, card: "DirectML" });
    expect(embedPlaceText(p)).toBe("Embedding: graphics card (DirectML), separate process");
    expect(embedPlace(installed("bge-m3-fp16", gpu16), gpu16).where).toBe("gpu");
  });

  it("a card never changes the model installed: BGE-M3 8-bit has no DirectML form and stays on the processor", () => {
    const p = embedPlace(installed("bge-m3-q8", gpu16), gpu16);
    expect(p).toEqual({ where: "cpu", engine: "onnxruntime", threads: 22, card: null });
    expect(embedPlaceText(p)).toBe("Embedding: processor, 22 cores, separate process");
  });

  it("a GGUF model runs in its llama-server: on the card its build reaches, else on the processor with N cores", () => {
    const gguf = (m: MachineProfile) => installed("qwen3-embedding-0.6b-q8", m);
    expect(embedPlaceText(embedPlace(gguf(gpu16), gpu16, "cuda"))).toBe("Embedding: graphics card (CUDA), llama.cpp");
    expect(embedPlaceText(embedPlace(gguf(gpu16), gpu16, "vulkan"))).toBe(
      "Embedding: graphics card (Vulkan), llama.cpp",
    );
    expect(embedPlaceText(embedPlace(gguf(gpu16), gpu16))).toBe("Embedding: graphics card, llama.cpp");
    const cpu = embedPlace(gguf(cpuOnly), cpuOnly, "cpu");
    expect(cpu).toEqual({ where: "cpu", engine: "llama.cpp", threads: 6, card: null });
    expect(embedPlaceText(cpu)).toBe("Embedding: processor, 6 cores, llama.cpp");
    expect(embedPlace(gguf(cpuOnly), cpuOnly).where).toBe("cpu");
  });

  it("the llama.cpp build decides as much as the card: a processor build, or a PC without a card, computes on the processor", () => {
    const entry = catalogEntry("qwen3-embedding-0.6b-q8") as CatalogEntry;
    expect(llamaOnGpu(entry, gpu16, "cuda")).toBe(true);
    expect(llamaOnGpu(entry, gpu16, "cpu")).toBe(false);
    expect(llamaOnGpu(entry, cpuOnly, "cuda")).toBe(false);
    expect(llamaOnGpu(entry, null, "cuda")).toBe(true);
    expect(embedPlace(installed(entry.id, gpu16), gpu16, "cpu")).toEqual({
      where: "cpu",
      engine: "llama.cpp",
      threads: 22,
      card: null,
    });
  });

  it("--mock runs every model with its fake runtime: the place said is the one the catalog gives the machine", () => {
    const mock = (id: string): ResolvedModel => ({ ...installed(id, cpuOnly, "mock"), device: "cpu" });
    expect(embedPlace(mock("qwen3-embedding-0.6b-onnx-fp16"), gpu16).where).toBe("gpu");
    expect(embedPlace(mock("bge-m3-q8"), gpu16)).toEqual({
      where: "cpu",
      engine: "onnxruntime",
      threads: 22,
      card: null,
    });
    expect(embedPlace(mock("qwen3-embedding-0.6b-q8"), gpu16).engine).toBe("llama.cpp");
  });
});
