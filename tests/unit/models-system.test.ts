import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { fitOf } from "../../src/core/lib/models-fit.ts";
import { measureMachine, pinMachineProfile } from "../../src/core/lib/models-hardware.ts";
import { packRows, suggestPack } from "../../src/core/lib/models-packs.ts";
import { journalFile } from "../../src/core/lib/models-perf.ts";
import { mockMachine } from "../../src/core/mock/machine.ts";
import type { CatalogEntry } from "../../src/core/types.ts";

const mac = mockMachine("mac");
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
    expect(judge(["qwen3-embedding-0.6b-onnx-q8", "bge-reranker-v2-m3-q8"]).verdict).toBe("fits");
  });

  it("a profile without a system is the Windows PC it was taken on", () => {
    const { system: _, ...old } = mockMachine("cpu-only");
    expect(judge(["qwen3-embedding-0.6b-q8"], { ...old, ramTotalMB: 32000, ramFreeMB: 20000 }).verdict).toBe("fits");
  });

  it("packs skip what this system cannot run: Quality is not available on a Mac, the others fall to their CPU variant", async () => {
    const rows = await packRows(null, "task", { machine: async () => mac });
    expect(rows.map((r) => [r.id, r.variant, r.available, r.embedding])).toEqual([
      ["light", 0, true, "bge-m3-q8"],
      ["performance", 1, true, "qwen3-embedding-0.6b-onnx-q8"],
      ["balanced", 2, true, "qwen3-embedding-0.6b-onnx-q8"],
      ["quality", null, false, null],
    ]);
    const quality = rows[3];
    expect(quality.fit?.verdict).toBe("unsupported");
    expect(quality.skipped[0]).toMatch(/^Not supported on macOS/);
    expect(suggestPack(mac)).toBe("performance");
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
    });
    expect(p.system).toEqual({ platform: "darwin", arch: "arm64" });
  });
});
