import type { CatalogEntry, GgufShape, PerfLine } from "../../types.ts";
import { measuredMB } from "../models-perf.ts";

const MiB = 1024 * 1024;
// ponytail: llama.cpp's compute and output buffers at its default batch, rounded up; the first load measures the real one
export const LLAMA_COMPUTE_MB = 512;

// The memory a GGUF model takes in llama.cpp at the context it is run with: its weights, then the KV cache (a key and
// a value of 16 bits per layer, per KV head, per token of context), then the compute buffers
export function ggufNeedMB(shape: GgufShape, weightsMB: number): number {
  const kvBytes = shape.layers * shape.ctx * shape.kvHeads * (shape.keyLength + shape.valueLength) * 2;
  return Math.round(weightsMB + kvBytes / MiB + LLAMA_COMPUTE_MB);
}

// What a model needs on this PC, from the most trusted source there is: what it took here when loaded, else what its
// GGUF shape gives for its context, else the catalog's figure, else its download size with a fifth more
export function needOf(entry: CatalogEntry, lines?: PerfLine[]): { vram: number; ram: number } {
  const measured = measuredMB(entry.id, lines);
  const known = entry.gguf ? ggufNeedMB(entry.gguf, entry.size.downloadMB) : null;
  const estimate = Math.round(entry.size.downloadMB * 1.2);
  return {
    vram: measured.vram ?? known ?? (entry.size.vramMB || estimate),
    ram: measured.ram ?? known ?? (entry.size.ramMB || estimate),
  };
}
