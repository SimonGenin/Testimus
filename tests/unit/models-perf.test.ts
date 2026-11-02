import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { env } from "../../src/core/env.ts";
import {
  cleanLine,
  isMemoryError,
  journalFile,
  KEEP_LINES,
  measuredMB,
  memoryFailures,
  type PerfRecord,
  perfStats,
  prunePerf,
  readPerf,
  recordPerf,
  speedLine,
  variantSpeed,
} from "../../src/core/lib/models-perf.ts";
import type { PerfLine } from "../../src/core/types.ts";

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

beforeEach(() => rmSync(journalFile(), { force: true }));

describe("timings journal (§7.9)", () => {
  it("lives in %LOCALAPPDATA%\\Testimus\\perf, one JSON line per operation", () => {
    expect(journalFile()).toBe(
      `${env.localDir()}\\perf\\journal.jsonl`.replace(/\\/g, process.platform === "win32" ? "\\" : "/"),
    );
    recordPerf({ at: at(0), op: "embed.query", model: "bge-m3-q8", device: "cpu", items: 1, ms: 42 });
    recordPerf({
      at: at(0),
      op: "embed.index",
      model: "bge-m3-q8",
      device: "cpu",
      items: 32,
      ms: 800,
      peakRssMB: 1300,
    });
    expect(readPerf().map((l) => l.op)).toEqual(["embed.query", "embed.index"]);
  });

  it("never keeps document or query text: unknown keys and multi-line strings are dropped", () => {
    const sneaky = {
      at: at(0),
      op: "embed.query",
      model: "bge-m3-q8",
      items: 1,
      ms: 10,
      query: "Que se passe-t-il pour les DSO ?",
      text: "EXI_MOP_SPF_511_A_20 …",
      project: "D:\\p\nsecret line",
    } as unknown as PerfLine;
    recordPerf(sneaky);
    const raw = readFileSync(journalFile(), "utf8");
    expect(raw).not.toMatch(/DSO|EXI_MOP|secret/);
    expect(JSON.parse(raw)).toEqual({ at: sneaky.at, op: "embed.query", items: 1, ms: 10, model: "bge-m3-q8" });
    expect(cleanLine({ ...sneaky, op: "nope" as PerfLine["op"] })).toBeNull();
    expect(cleanLine({ ...sneaky, ms: Number.NaN })).toBeNull();
  });

  it("keeps 90 days and at most 100,000 lines, oldest dropped", () => {
    mkdirSync(dirname(journalFile()), { recursive: true });
    const old = JSON.stringify({ at: at(91), op: "rerank", items: 1, ms: 1 });
    const fresh = (i: number) => JSON.stringify({ at: at(1), op: "rerank", items: 1, ms: i });
    const lines = [old, old, ...Array.from({ length: KEEP_LINES + 5 }, (_, i) => fresh(i))];
    writeFileSync(journalFile(), `${lines.join("\n")}\n`);
    expect(prunePerf()).toBe(7);
    const kept = readPerf();
    expect(kept).toHaveLength(KEEP_LINES);
    expect(kept[0].ms).toBe(5);
    expect(prunePerf()).toBe(0);
  });

  it("aggregates per op × model × device: count, p50, p95, throughput, peak memory, offload", () => {
    const lines: PerfLine[] = [];
    for (let i = 1; i <= 20; i++)
      lines.push({ at: at(0), op: "embed.query", model: "q8b", device: "gpu", items: 1, ms: i * 10, vramMB: 9100 });
    lines.push({
      at: at(0),
      op: "embed.index",
      model: "q8b",
      device: "gpu",
      items: 100,
      ms: 2000,
      partialOffload: true,
    });
    lines.push({ at: at(0), op: "embed.index", model: "q8b", device: "gpu", items: 100, ms: 2000 });
    const s = perfStats({ lines });
    const q = s.find((x) => x.op === "embed.query");
    expect(q).toMatchObject({ count: 20, p50: 100, p95: 190, peakMB: 9100, partialOffload: false });
    expect(s.find((x) => x.op === "embed.index")).toMatchObject({ count: 2, perSecond: 50, partialOffload: true });
    expect(perfStats({ lines, last: 5 }).find((x) => x.op === "embed.query")?.count).toBe(5);
    expect(speedLine("q8b", s)).toBe("on this PC: query 100 ms, index 50 passages/s");
    expect(measuredMB("q8b", lines)).toEqual({ vram: 9100, ram: null });
  });

  it("models.perf reads the journal", async () => {
    recordPerf({ at: at(0), op: "rerank", model: "bge-reranker-v2-m3-q8", device: "cpu", items: 5, ms: 150 });
    const r = (await invoke("models.perf", {}, { project: null })) as { op: string; p95: number }[];
    expect(r).toEqual([expect.objectContaining({ op: "rerank", p95: 150, count: 1 })]);
    expect(existsSync(journalFile())).toBe(true);
  });
});

describe("memory failures in the journal (N-perf)", () => {
  it("keeps the oom flag, leaves those lines out of the timings and counts them", () => {
    recordPerf({ at: at(0), op: "model.load", model: "qwen3-embedding-8b-q8", items: 0, ms: 5000, oom: true });
    recordPerf({ at: at(0), op: "model.load", model: "qwen3-embedding-8b-q8", items: 1, ms: 900, vramMB: 9100 });
    expect(readPerf()[0]).toMatchObject({ oom: true });
    const [s] = perfStats({ model: "qwen3-embedding-8b-q8" });
    expect(s).toMatchObject({ op: "model.load", count: 1, p50: 900, oom: 1, peakMB: 9100 });
    expect(memoryFailures("qwen3-embedding-8b-q8", readPerf())).toBe(1);
    expect(memoryFailures("qwen3-embedding-8b-q8", readPerf(), 1)).toBe(0);
    expect(
      cleanLine({ at: at(0), op: "rerank", items: 1, ms: 1, oom: "yes" } as unknown as PerfRecord),
    ).not.toHaveProperty("oom");
  });

  it("recognises memory errors from transformers.js, DirectML and llama.cpp", () => {
    for (const m of [
      "Failed to allocate memory for requested buffer of size 2147483648",
      "D3D12 E_OUTOFMEMORY",
      "cudaMalloc failed: out of memory",
      "std::bad_alloc",
    ])
      expect(isMemoryError(new Error(m))).toBe(true);
    expect(isMemoryError(new Error("Could not locate file: tokenizer.json"))).toBe(false);
  });

  it("the speed line names query, rerank and index throughput", () => {
    const lines: PerfRecord[] = [
      { at: at(0), op: "rerank", model: "r", device: "gpu", items: 30, ms: 25 },
      { at: at(0), op: "embed.query", model: "e", device: "cpu", items: 1, ms: 40 },
      { at: at(0), op: "embed.index", model: "e", device: "cpu", items: 240, ms: 2000 },
    ];
    expect(variantSpeed("e", "r", perfStats({ lines }))).toBe(
      "on this PC: query 40 ms, index 120 passages/s, rerank 25 ms",
    );
    expect(speedLine("nothing", perfStats({ lines }))).toBeUndefined();
  });
});
