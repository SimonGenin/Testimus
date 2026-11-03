import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogEntry, registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { fitOf } from "../../../../src/core/lib/models-fit.ts";
import { measureMachine, pinMachineProfile } from "../../../../src/core/lib/models-hardware.ts";
import { packRows, suggestPack } from "../../../../src/core/lib/models-packs.ts";
import { journalFile, recordPerf } from "../../../../src/core/lib/models-perf.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import type { CatalogEntry } from "../../../../src/core/types.ts";

const mac = mockMachine("mac");
const macIntel = mockMachine("mac-intel");
const entry = (id: string) => catalogEntry(id) as CatalogEntry;
const judge = (ids: string[], machine = mac) => fitOf(ids.map(entry), machine, { headroom: 0.15 });

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  rmSync(journalFile(), { force: true });
  pinMachineProfile(mac);
});

afterEach(() => {
  pinMachineProfile(null);
});

describe("what this system runs", () => {
  it("llama.cpp and DirectML models are not supported off Windows, whatever the memory", () => {
    const gguf = judge(["qwen3-embedding-8b-q4", "qwen3-reranker-4b-q8"]);
    expect(gguf.verdict).toBe("unsupported");
    expect(gguf.message).toMatch(/^Not supported on macOS: Qwen3 Embedding 8B .* llama\.cpp, which Testimus ships/);
    expect(judge(["qwen3-embedding-0.6b-onnx-fp16"]).verdict).toBe("unsupported");
    expect(judge(["qwen3-embedding-0.6b-onnx-q8", "bge-reranker-v2-m3-q8"], macIntel).verdict).toBe("fits");
  });

  it("memory is not enough: a model never run on this system is untested, whatever the memory", () => {
    const f = judge(["qwen3-embedding-0.6b-onnx-q8", "bge-reranker-v2-m3-q8"]);
    expect(f.verdict).toBe("untested");
    expect(f.message).toMatch(
      /^Not proven on macOS arm64: Qwen3 Embedding 0\.6B \(8-bit, CPU\) and BGE Reranker v2 M3 \(8-bit, CPU\) have never run on this system, so they may not run at all; .* Memory: fits on the processor/,
    );
    const intel = judge(["qwen3-embedding-0.6b-onnx-q8"], macIntel);
    expect(intel.verdict).toBe("fits");
    expect(intel.message).toMatch(/^Fits on the processor \(no GPU Testimus can use\): /);
  });

  it("a load that succeeded on this PC proves the model here", () => {
    recordPerf({ at: "2026-11-03T10:00:00.000Z", op: "model.load", model: "bge-m3-q8", items: 1, ms: 2300 });
    recordPerf({ at: "2026-11-03T10:01:00.000Z", op: "model.load", model: "bge-m3-fp16", items: 0, ms: 90, oom: true });
    expect(judge(["bge-m3-q8"]).verdict).toBe("fits");
    expect(judge(["qwen3-embedding-0.6b-onnx-q8"]).verdict).toBe("untested");
  });

  it("onnxruntime that does not load makes every transformers model unsupported, on Windows too", () => {
    const f = judge(["bge-m3-q8"], { ...mockMachine("dev"), onnx: null });
    expect(f.verdict).toBe("unsupported");
    expect(f.message).toMatch(/onnxruntime, which does not load on this PC/);
    expect(judge(["bge-m3-q8"], { ...macIntel, onnx: null }).verdict).toBe("unsupported");
  });

  it("a profile without a system is the Windows PC it was taken on", () => {
    const { system: _, ...old } = mockMachine("cpu-only");
    expect(judge(["qwen3-embedding-0.6b-q8"], { ...old, ramTotalMB: 32000, ramFreeMB: 20000 }).verdict).toBe("fits");
  });

  it("packs skip what this system cannot run: Quality is not available on a Mac, the others fall to their CPU variant", async () => {
    const rows = await packRows(null, "task", { machine: async () => macIntel });
    expect(rows.map((r) => [r.id, r.variant, r.available, r.embedding, r.fit?.verdict, r.processorOnly])).toEqual([
      ["light", 0, true, "bge-m3-q8", "fits", false],
      ["performance", 1, true, "qwen3-embedding-0.6b-onnx-q8", "fits", true],
      ["balanced", 2, true, "qwen3-embedding-0.6b-onnx-q8", "fits", true],
      ["quality", null, false, null, "unsupported", false],
    ]);
    expect(rows[3].skipped[0]).toMatch(/^Not supported on macOS/);
  });

  it("without a GPU the suggestion is Light: a pack made for a GPU falls to the processor, several times slower", () => {
    expect(suggestPack(macIntel)).toBe("light");
    expect(suggestPack(mac)).toBe("light");
    expect(suggestPack({ ...mockMachine("cpu-only"), ramTotalMB: 64000, ramFreeMB: 40000 })).toBe("light");
  });

  it("on a system nothing is proven on, the packs say untested", async () => {
    const rows = await packRows(null, "task", { machine: async () => mac });
    expect(rows.map((r) => [r.id, r.variant, r.fit?.verdict])).toEqual([
      ["light", 0, "untested"],
      ["performance", 1, "untested"],
      ["balanced", 2, "untested"],
      ["quality", null, "unsupported"],
    ]);
    expect(rows[1].skipped).toEqual([expect.stringMatching(/DirectML/)]);
  });

  it("the profile says which system it was measured on", async () => {
    const p = await measureMachine({
      exec: async () => ({ code: 1, stdout: "" }),
      statfs: () => null,
      drives: () => [],
      loaded: async () => [],
      mem: () => ({ totalMB: 16000, freeMB: 8000 }),
      cpu: () => ({ model: "Apple M2 Pro", threads: 12 }),
      system: () => ({ platform: "darwin", arch: "arm64" }),
      onnx: async () => null,
    });
    expect(p.system).toEqual({ platform: "darwin", arch: "arm64" });
    expect(p.onnx).toBeNull();
  });
});
