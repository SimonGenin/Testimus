import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, type HttpRes } from "../../../../../src/core/env.ts";
import { journalFile, readPerf } from "../../../../../src/core/lib/models-perf.ts";
import {
  autoLayers,
  ensureServer,
  loadedServers,
  memoryReport,
  type Proc,
  serverArgs,
  serverIo,
  stopAllServers,
} from "../../../../../src/core/rag/runtimes/llama-server.ts";

// The lines llama.cpp b12032 prints while it loads a model (src/llama-model.cpp, llama-kv-cache.cpp, llama-context.cpp)
const FULL = [
  "load_tensors: offloaded 37/37 layers to GPU",
  "load_tensors:        CUDA0 model buffer size =  4400.00 MiB",
  "load_tensors:   CPU_Mapped model buffer size =   166.92 MiB",
  "llama_kv_cache:      CUDA0 KV buffer size =  1152.00 MiB",
  "llama_context:  CUDA_Host  output buffer size =     0.58 MiB",
  "sched_reserve:      CUDA0 compute buffer size =   300.75 MiB",
  "sched_reserve:  CUDA_Host compute buffer size =    24.01 MiB",
].join("\n");
const PARTIAL = [
  "load_tensors: offloaded 20/37 layers to GPU",
  "load_tensors:      Vulkan0 model buffer size =  2400.00 MiB",
  "load_tensors:   CPU_Mapped model buffer size =  2166.92 MiB",
  "llama_kv_cache:    Vulkan0 KV buffer size =   622.00 MiB",
].join("\n");

describe("what llama.cpp says it allocated", () => {
  it("sums the GPU buffers and the host ones apart, and reads how many layers went to the GPU", () => {
    expect(memoryReport(FULL)).toEqual({ gpuMB: 5853, hostMB: 192, layers: { onGpu: 37, total: 37 } });
    expect(memoryReport(PARTIAL)).toEqual({ gpuMB: 3022, hostMB: 2167, layers: { onGpu: 20, total: 37 } });
  });

  it("is null for a log without a memory line", () => {
    expect(memoryReport("main: server is listening on http://127.0.0.1:52000\n")).toBeNull();
  });
});

describe("who places the layers", () => {
  it("llama.cpp does from the build Testimus downloads on; an older or unknown build gets every layer", () => {
    expect(autoLayers("b12032")).toBe(true);
    expect(autoLayers("b13000")).toBe(true);
    expect(autoLayers("b4500")).toBe(false);
    expect(autoLayers("unknown")).toBe(false);
    expect(autoLayers(undefined)).toBe(false);
    const ngl = (build?: string) => {
      const a = serverArgs("m.gguf", "embedding", 1, "k", build);
      return a[a.indexOf("-ngl") + 1];
    };
    expect(ngl("b12032")).toBe("auto");
    expect(ngl("b4500")).toBe("99");
    expect(ngl()).toBe("99");
  });
});

const saved = { ...serverIo, http: env.http };
const perf = { model: "qwen3-embedding-8b-q4", runtime: "llamacpp" as const, device: "gpu" as const };
let log = "";
let proc: (Proc & { say(t: string): void; exit(c: number | null): void }) | null = null;

beforeEach(() => {
  rmSync(journalFile(), { force: true });
  log = "";
  let clock = 1_000_000;
  serverIo.spawn = () => {
    const listeners: ((t: string) => void)[] = [];
    let exit: (c: number | null) => void = () => {};
    proc = {
      pid: 900,
      onOutput: (cb) => listeners.push(cb),
      exited: new Promise((r) => {
        exit = r;
      }),
      exit: (c) => exit(c),
      say: (t) => {
        for (const l of listeners) l(t);
      },
    };
    return proc;
  };
  serverIo.freePort = async () => 52000;
  serverIo.kill = async () => proc?.exit(1);
  serverIo.now = () => clock;
  serverIo.sleep = async (ms) => {
    clock += ms;
  };
  serverIo.randomKey = () => "k";
  serverIo.vramUsedMB = async () => 1000;
  env.http = async (): Promise<HttpRes> => {
    for (const line of log.split("\n")) proc?.say(`${line}\n`);
    log = "";
    return { status: 200, headers: {}, text: JSON.stringify({ status: "ok" }) };
  };
});

afterEach(async () => {
  await stopAllServers();
  Object.assign(serverIo, saved);
  env.http = saved.http;
});

describe("a load measured by llama.cpp's own report", () => {
  it("records the GPU memory llama.cpp allocated, on any GPU maker, and holds it as the model's share", async () => {
    log = FULL;
    await ensureServer({ exe: "x.exe", build: "b12032", model: "D:/m/e8.gguf", kind: "embedding", perf, sizeMB: 4460 });
    const load = readPerf().find((l) => l.op === "model.load");
    expect(load?.vramMB).toBe(5853);
    expect(load?.partialOffload).toBe(false);
    expect(loadedServers()[0].vramMB).toBe(5853);
  });

  it("marks a load that left layers on the processor as a partial offload, whatever nvidia-smi says", async () => {
    log = PARTIAL;
    await ensureServer({ exe: "x.exe", build: "b12032", model: "D:/m/e8.gguf", kind: "embedding", perf, sizeMB: 4460 });
    const load = readPerf().find((l) => l.op === "model.load");
    expect(load?.vramMB).toBe(3022);
    expect(load?.partialOffload).toBe(true);
  });

  it("without a report, falls back to the NVIDIA memory used before and after", async () => {
    let used = 1000;
    serverIo.vramUsedMB = async () => {
      used += 600;
      return used;
    };
    await ensureServer({ exe: "x.exe", model: "D:/m/e8.gguf", kind: "embedding", perf, sizeMB: 4460 });
    const load = readPerf().find((l) => l.op === "model.load");
    expect(load?.vramMB).toBe(600);
    expect(load?.partialOffload).toBeUndefined();
    expect(loadedServers()[0].vramMB).toBe(4460);
  });
});
