import { describe, expect, it } from "vitest";
import { ggufNeedMB, LLAMA_COMPUTE_MB, needOf } from "../../../../src/core/lib/fit/need.ts";
import { deviceFor, deviceOf, gpuPool, onIntegratedGpu } from "../../../../src/core/lib/fit/placement.ts";
import { fitOf } from "../../../../src/core/lib/fit/verdict.ts";
import { catalogEntry } from "../../../../src/core/lib/models-catalog.ts";
import { suggestPack } from "../../../../src/core/lib/models-packs.ts";
import type { CatalogEntry, GpuInfo, MachineProfile, PerfLine } from "../../../../src/core/types.ts";

const e = (id: string) => catalogEntry(id) as CatalogEntry;
const H = { headroom: 0.15, lines: [] };
const gpu = (name: string, vramTotalMB: number | null = null, vramUsedMB: number | null = null): GpuInfo => ({
  name,
  vendor: /nvidia|rtx/i.test(name) ? "nvidia" : /amd|radeon/i.test(name) ? "amd" : "intel",
  vramTotalMB,
  vramUsedMB,
  source: "wmi",
});
const pc = (gpus: GpuInfo[], ram = { total: 32000, free: 20000 }): MachineProfile => ({
  at: "2026-11-05T10:00:00.000Z",
  system: { platform: "win32", arch: "x64" },
  ramTotalMB: ram.total,
  ramFreeMB: ram.free,
  cpu: { model: "AMD Ryzen 7 7840U", threads: 16 },
  gpus,
  drives: [],
  loaded: [],
});
const apu = (ram?: { total: number; free: number }) => pc([gpu("AMD Radeon 780M Graphics", 512)], ram);

describe("a model on an integrated GPU takes the PC's memory", () => {
  it("its pool is the RAM, not the carve-out the registry reports", () => {
    expect(gpuPool(apu())).toMatchObject({ shared: true, totalMB: 32000, freeMB: 20000 });
    expect(gpuPool(pc([gpu("NVIDIA GeForce RTX 3050", 4096, 300)]))).toMatchObject({
      shared: false,
      totalMB: 4096,
      freeMB: 3796,
      freeMeasured: true,
    });
    expect(gpuPool(pc([]))).toBeNull();
  });

  it("fits when the models on the GPU and on the processor fit the free RAM together", () => {
    const f = fitOf([e("qwen3-embedding-4b-q4"), e("qwen3-reranker-0.6b-q8")], apu(), H);
    expect(f.verdict).toBe("fits");
    expect(f.device).toBe("gpu");
    expect(f.needMB.ram).toBe(3430 + 1300);
    expect(f.message).toMatch(/^Fits on AMD Radeon 780M Graphics, which shares the PC's memory/);
  });

  it("tight past the margin, too small past the PC's memory — never « GPU too small » for its carve-out", () => {
    const pair = [e("qwen3-embedding-4b-q4"), e("qwen3-reranker-0.6b-q8")];
    expect(fitOf(pair, apu({ total: 16000, free: 5000 }), H).verdict).toBe("tight");
    const small = fitOf(pair, apu({ total: 4000, free: 3000 }), H);
    expect(small.verdict).toBe("ram-too-small");
    expect(small.message).toMatch(/AMD Radeon 780M Graphics is integrated: it uses the PC's memory/);
  });

  it("the pack suggested leaves llama.cpp off an integrated GPU: Performance (DirectML) rather than Quality", () => {
    expect(onIntegratedGpu(e("qwen3-embedding-8b-q4"), apu())).toBe(true);
    expect(suggestPack(apu())).toBe("performance");
    expect(suggestPack(pc([gpu("NVIDIA GeForce RTX 4080", 16384, 1200)], { total: 64000, free: 40000 }))).toBe(
      "quality",
    );
  });
});

describe("where a model runs: one decision", () => {
  it("DirectML and llama.cpp go to a usable GPU, everything else and every model on an Intel UHD to the processor", () => {
    const iris = pc([gpu("Intel(R) Iris(R) Xe Graphics", 128)]);
    const uhd = pc([gpu("Intel(R) UHD Graphics 620", 128)]);
    expect([deviceFor(e("bge-m3-fp16"), iris), deviceOf(e("bge-m3-fp16"), iris)]).toEqual(["gpu", "dml"]);
    expect([deviceFor(e("qwen3-embedding-4b-q4"), iris), deviceOf(e("qwen3-embedding-4b-q4"), iris)]).toEqual([
      "gpu",
      "gpu",
    ]);
    expect(deviceOf(e("bge-m3-q8"), iris)).toBe("cpu");
    expect(deviceOf(e("bge-m3-fp16"), uhd)).toBe("cpu");
    expect(deviceOf(e("qwen3-embedding-4b-q4"), uhd)).toBe("cpu");
    expect(deviceOf(e("bge-m3-fp16"), null)).toBe("cpu");
  });
});

describe("what a model needs", () => {
  const shape = { layers: 36, kvHeads: 8, keyLength: 128, valueLength: 128, ctx: 8192 };

  it("a GGUF model: its weights, a KV cache of 16 bits per layer, KV head and token of context, the compute buffers", () => {
    expect(ggufNeedMB(shape, 4460)).toBe(4460 + 1152 + LLAMA_COMPUTE_MB);
    expect(ggufNeedMB({ ...shape, ctx: 32768 }, 4460)).toBe(4460 + 4608 + LLAMA_COMPUTE_MB);
  });

  it("measured here first, then its GGUF shape for its context, then the catalog, then the download size", () => {
    const withShape = { ...e("qwen3-embedding-8b-q4"), gguf: shape };
    expect(needOf(withShape, [])).toEqual({ vram: 6124, ram: 6124 });
    const loaded: PerfLine[] = [
      {
        at: "2026-11-05T10:00:00.000Z",
        op: "model.load",
        model: "qwen3-embedding-8b-q4",
        items: 1,
        ms: 900,
        vramMB: 5853,
      },
    ];
    expect(needOf(withShape, loaded).vram).toBe(5853);
    expect(needOf(e("qwen3-embedding-8b-q4"), [])).toEqual({ vram: 5730, ram: 6230 });
    const bare = { ...e("qwen3-embedding-8b-q4"), size: { downloadMB: 1000, ramMB: 0, vramMB: 0 } };
    expect(needOf(bare, [])).toEqual({ vram: 1200, ram: 1200 });
  });

  it("an LLM run with a longer context needs more, and the verdict follows", () => {
    const llm = { ...e("qwen3-embedding-8b-q4"), id: "llm-test", label: "An LLM", gguf: { ...shape, ctx: 32768 } };
    const card = pc([gpu("NVIDIA GeForce RTX 4060", 8188, 500)]);
    expect(fitOf([{ ...llm, gguf: shape }], card, H).verdict).toBe("fits");
    expect(fitOf([llm], card, H).verdict).toBe("gpu-too-small");
  });
});
