import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/core/env.ts";
import { type ModelDeps, modelRows } from "../../src/core/lib/doctor.ts";
import { type AdviceInput, fitsVariant, packVariantThatFits } from "../../src/core/lib/models-advice.ts";
import { catalog, catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { deviceFor, fitOf, needOf } from "../../src/core/lib/models-fit.ts";
import {
  type HardwareDeps,
  mainGpu,
  measureMachine,
  parseNvidiaSmi,
  parseRegistryVram,
  parseWmi,
} from "../../src/core/lib/models-hardware.ts";
import { packRows } from "../../src/core/lib/models-packs.ts";
import { ensureServer, loadedServers, serverIo, stopAllServers } from "../../src/core/rag/runtimes/llama-server.ts";
import type { CatalogEntry, MachineProfile, Pack } from "../../src/core/types.ts";

const e = (id: string) => catalogEntry(id) as CatalogEntry;
const H = { headroom: 0.15, lines: [] };

function devPc(over: Partial<MachineProfile> = {}): MachineProfile {
  return {
    at: "2026-11-02T10:00:00.000Z",
    ramTotalMB: 65000,
    ramFreeMB: 40000,
    cpu: { model: "Intel Core Ultra 9 285K", threads: 24 },
    gpus: [
      {
        name: "NVIDIA GeForce RTX 5080",
        vendor: "nvidia",
        driver: "591.44",
        vramTotalMB: 16303,
        vramUsedMB: 2490,
        source: "nvidia-smi",
      },
    ],
    drives: [{ root: "D:\\", freeMB: 500000, totalMB: 1900000 }],
    loaded: [],
    ...over,
  };
}

describe("needs of a model", () => {
  it("measured on this PC first, then the catalog, then the file size × 1.2", () => {
    const q = e("qwen3-embedding-8b-q8");
    expect(needOf(q, []).vram).toBe(9100);
    expect(
      needOf(q, [{ at: "2026-11-01T00:00:00Z", op: "model.load", model: q.id, items: 1, ms: 4000, vramMB: 9300 }]).vram,
    ).toBe(9300);
    expect(needOf({ ...q, size: { downloadMB: 1000, ramMB: 0, vramMB: 0 } }, []).vram).toBe(1200);
  });

  it("GGUF on the GPU when there is one; ONNX on the GPU only with a DirectML dtype", () => {
    expect(deviceFor(e("qwen3-embedding-4b-q8"), devPc())).toBe("gpu");
    expect(deviceFor(e("qwen3-embedding-4b-q8"), devPc({ gpus: [] }))).toBe("cpu");
    expect(deviceFor(e("bge-m3-q8"), devPc())).toBe("cpu");
    expect(deviceFor(e("bge-m3-fp16"), devPc())).toBe("gpu");
  });
});

describe("fit verdicts", () => {
  it("fits, with the numbers", () => {
    const f = fitOf([e("qwen3-embedding-4b-q8"), e("qwen3-reranker-0.6b-q8")], devPc(), H);
    expect(f.verdict).toBe("fits");
    expect(f.needMB.vram).toBe(4600 + 1300);
    expect(f.freeMB.vram).toBe(16303 - 2490);
    expect(f.message).toMatch(/Fits: .* need about 5\.8 GB; the GPU has 15\.9 GB, 13\.5 GB free/);
  });

  it("checks the embedding and the reranker together: Quality's first variant is tight on the dev PC", () => {
    const alone = fitOf([e("qwen3-embedding-8b-q8")], devPc(), H);
    expect(alone.verdict).toBe("fits");
    const pair = fitOf([e("qwen3-embedding-8b-q8"), e("qwen3-reranker-4b-q8")], devPc(), H);
    expect(pair.verdict).toBe("tight");
    expect(pair.needMB.vram).toBe(13900);
    expect(pair.message).toMatch(/13\.6 GB; the GPU has 15\.9 GB, 13\.5 GB free\. Other programs use 2\.4 GB/);
    const quiet = fitOf(
      [e("qwen3-embedding-8b-q8"), e("qwen3-reranker-4b-q8")],
      devPc({ gpus: [{ ...devPc().gpus[0], vramUsedMB: 1000 }] }),
      H,
    );
    expect(quiet.verdict).toBe("tight");
    expect(quiet.message).toMatch(/14\.9 GB free \(12\.7 GB usable with the 15 % margin\)/);
  });

  it("tight when it fits only once other loaded models are unloaded, naming them", () => {
    const busy = devPc({
      gpus: [{ ...devPc().gpus[0], vramUsedMB: 2490 + 9100 }],
      loaded: [{ name: "qwen3-embedding:8b-q8_0", sizeMB: 9300, vramMB: 9100, runtime: "ollama" }],
    });
    const f = fitOf([e("qwen3-embedding-4b-q8")], busy, H);
    expect(f.verdict).toBe("tight");
    expect(f.unload).toEqual(["qwen3-embedding:8b-q8_0"]);
    expect(f.message).toMatch(/Tight — Ollama holds qwen3-embedding:8b-q8_0, 8\.9 GB/);
  });

  it("a model already loaded by Ollama counts as there", () => {
    const busy = devPc({
      gpus: [{ ...devPc().gpus[0], vramUsedMB: 2490 + 9100 }],
      loaded: [{ name: "qwen3-embedding:8b-q8_0", sizeMB: 9300, vramMB: 9100, runtime: "ollama" }],
    });
    expect(fitOf([e("qwen3-embedding-8b-q8")], busy, H).verdict).toBe("fits");
  });

  it("GPU too small: runs partly on the processor", () => {
    const small = devPc({ gpus: [{ ...devPc().gpus[0], name: "RTX 3050", vramTotalMB: 8192, vramUsedMB: 500 }] });
    const f = fitOf([e("qwen3-embedding-8b-q8")], small, H);
    expect(f.verdict).toBe("gpu-too-small");
    expect(f.message).toMatch(
      /Your GPU has 8\.0 GB, 7\.5 GB free\. .* needs about 8.9 GB: it will run partly on the processor/,
    );
  });

  it("RAM too small refuses", () => {
    const tiny = devPc({ gpus: [], ramTotalMB: 1024, ramFreeMB: 512 });
    const f = fitOf([e("bge-m3-q8")], tiny, H);
    expect(f.verdict).toBe("ram-too-small");
    expect(f.message).toMatch(/1\.1 GB of memory; this PC has 1\.0 GB/);
    const gpuSmallRam = devPc({
      ramTotalMB: 4096,
      gpus: [{ ...devPc().gpus[0], vramTotalMB: 4096, vramUsedMB: 0 }],
    });
    expect(fitOf([e("qwen3-embedding-8b-q8")], gpuSmallRam, H).verdict).toBe("ram-too-small");
  });

  it("unknown when the GPU memory is not known (non-NVIDIA without a registry figure)", () => {
    const amd = devPc({
      gpus: [{ name: "AMD Radeon 780M", vendor: "amd", vramTotalMB: null, vramUsedMB: null, source: "wmi" }],
    });
    const f = fitOf([e("qwen3-embedding-4b-q4")], amd, H);
    expect(f.verdict).toBe("unknown");
    expect(f.message).toMatch(/Cannot check the memory of AMD Radeon 780M: try it/);
  });

  it("CPU only: compares with free RAM and the margin", () => {
    const cpu = devPc({ gpus: [], ramTotalMB: 16000, ramFreeMB: 2600 });
    expect(fitOf([e("bge-m3-q8")], cpu, H).verdict).toBe("fits");
    const f = fitOf([e("bge-m3-q8"), e("bge-reranker-v2-m3-q8")], cpu, H);
    expect(f.verdict).toBe("tight");
    expect(f.device).toBe("cpu");
  });
});

describe("machine profile", () => {
  it("parses nvidia-smi, WMI and the registry's qwMemorySize", () => {
    expect(
      parseNvidiaSmi(
        "name, driver_version, memory.total [MiB], memory.used [MiB]\nNVIDIA GeForce RTX 5080, 591.44, 16303 MiB, 2490 MiB\n",
      ),
    ).toEqual([
      {
        name: "NVIDIA GeForce RTX 5080",
        vendor: "nvidia",
        driver: "591.44",
        vramTotalMB: 16303,
        vramUsedMB: 2490,
        source: "nvidia-smi",
      },
    ]);
    expect(parseWmi('{"Name":"Intel(R) Graphics","DriverVersion":"32.0"}')).toEqual([
      { name: "Intel(R) Graphics", driver: "32.0" },
    ]);
    expect(parseWmi('[{"Name":"Microsoft Remote Display Adapter"},{"Name":"AMD Radeon RX 7600"}]')).toEqual([
      { name: "AMD Radeon RX 7600" },
    ]);
    const key = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
    const sizes = `${key}\\0001\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x3faf00000\r\n\r\nEnd of search: 1 match(es) found.`;
    const descs = `${key}\\0000\r\n    DriverDesc    REG_SZ    Intel(R) Graphics\r\n\r\n${key}\\0001\r\n    DriverDesc    REG_SZ    AMD Radeon RX 7600\r\n`;
    expect([...parseRegistryVram(sizes, descs)]).toEqual([["AMD Radeon RX 7600", 16303]]);
  });

  it("builds the profile from injected tools: NVIDIA from nvidia-smi, others with registry VRAM", async () => {
    const calls: string[] = [];
    const deps: HardwareDeps = {
      exec: async (cmd, args) => {
        calls.push(cmd);
        if (cmd === "nvidia-smi")
          return {
            code: 0,
            stdout: "name, driver_version, memory.total [MiB], memory.used [MiB]\nRTX 5080, 591.44, 16303 MiB, 100 MiB",
          };
        if (cmd === "powershell.exe")
          return {
            code: 0,
            stdout: '[{"Name":"Intel(R) Graphics"},{"Name":"NVIDIA GeForce RTX 5080"},{"Name":"AMD Radeon"}]',
          };
        if (args.includes("DriverDesc"))
          return { code: 0, stdout: "HKEY_X\\0002\n    DriverDesc    REG_SZ    AMD Radeon\n" };
        return { code: 0, stdout: "HKEY_X\\0002\n    HardwareInformation.qwMemorySize    REG_QWORD    0x200000000\n" };
      },
      statfs: (root) => (root === "D:\\" ? { freeMB: 1000, totalMB: 2000 } : null),
      drives: () => ["C:\\", "D:\\"],
      loaded: async () => [{ name: "m", sizeMB: 10, vramMB: 5, runtime: "ollama" }],
      mem: () => ({ totalMB: 32000, freeMB: 16000 }),
      cpu: () => ({ model: "cpu", threads: 8 }),
    };
    const p = await measureMachine(deps);
    if (process.platform === "win32") {
      expect(p.gpus.map((g) => [g.name, g.vendor, g.vramTotalMB, g.source])).toEqual([
        ["RTX 5080", "nvidia", 16303, "nvidia-smi"],
        ["Intel(R) Graphics", "intel", null, "wmi"],
        ["AMD Radeon", "amd", 8192, "registry"],
      ]);
      expect(calls.sort()).toEqual(["nvidia-smi", "powershell.exe", "reg.exe", "reg.exe"]);
    }
    expect(p.drives).toEqual([{ root: "D:\\", freeMB: 1000, totalMB: 2000 }]);
    expect(p.loaded).toHaveLength(1);
    expect(mainGpu(p)?.name).toBe("RTX 5080");
  });

  it("no tool answers: no GPU, still a profile", async () => {
    const p = await measureMachine({
      exec: async () => ({ code: 1, stdout: "" }),
      statfs: () => null,
      drives: () => [],
      loaded: async () => [],
      mem: () => ({ totalMB: 8000, freeMB: 4000 }),
      cpu: () => ({ model: "cpu", threads: 4 }),
    });
    expect(p.gpus).toEqual([]);
    expect(mainGpu(p)).toBeNull();
  });
});

describe("Testimus' own llama.cpp servers are not « other loaded models » for the model they serve (#6)", () => {
  const saved = { ...serverIo, http: env.http };
  let next = 300;
  beforeEach(() => {
    rmSync(registryFile(), { force: true });
    serverIo.spawn = () => ({ pid: ++next, onOutput: () => {}, exited: new Promise(() => {}) });
    serverIo.freePort = async () => 40000 + next;
    serverIo.kill = async () => {};
    serverIo.sleep = async () => {};
    env.http = async () => ({ status: 200, headers: {}, text: JSON.stringify({ status: "ok" }) });
  });
  afterEach(async () => {
    await stopAllServers();
    Object.assign(serverIo, saved);
    env.http = saved.http;
  });

  const GPU12 = { ...devPc().gpus[0], name: "RTX 4070", vramTotalMB: 12288, vramUsedMB: 2490 + 4600 };
  async function serving4b(): Promise<MachineProfile> {
    await ensureServer({
      exe: "llama-server.exe",
      model: "D:/models/Qwen/Qwen3-Embedding-4B-GGUF/Qwen3-Embedding-4B-Q8_0.gguf",
      kind: "embedding",
      catalogId: "qwen3-embedding-4b-q8",
      sizeMB: 4600,
    });
    return devPc({ gpus: [GPU12], loaded: loadedServers() });
  }

  it("the profile names a llama-server by the catalog id of the model it serves", async () => {
    const m = await serving4b();
    expect(m.loaded).toEqual([{ name: "qwen3-embedding-4b-q8", sizeMB: 4600, vramMB: 4600, runtime: "llamacpp" }]);
  });

  it("fit: the served model fits; another candidate is tight and names it to unload", async () => {
    const m = await serving4b();
    const same = fitOf([e("qwen3-embedding-4b-q8"), e("qwen3-reranker-0.6b-q8")], m, H);
    expect(same.verdict).toBe("fits");
    expect(same.unload).toEqual([]);
    expect(same.needMB.vram).toBe(1300);
    const other = fitOf([e("qwen3-embedding-8b-q4")], m, H);
    expect(other.verdict).toBe("tight");
    expect(other.unload).toEqual(["qwen3-embedding-4b-q8"]);
    expect(other.message).toMatch(/llama\.cpp holds Qwen3 Embedding 4B \(8-bit\)/);
  });

  it("a server named by its GGUF file (older start) is recognised too", () => {
    const m = devPc({
      gpus: [GPU12],
      loaded: [{ name: "Qwen3-Embedding-4B-Q8_0.gguf", sizeMB: 4600, vramMB: 4600, runtime: "llamacpp" }],
    });
    expect(fitOf([e("qwen3-embedding-4b-q8"), e("qwen3-reranker-0.6b-q8")], m, H).verdict).toBe("fits");
  });

  it("models.packs keeps the variant in use; models.advice sees it fit", async () => {
    const m = await serving4b();
    const rows = await packRows(null, "task", { machine: async () => m, ollama: async () => null, lines: [] });
    const balanced = rows.find((r) => r.id === "balanced");
    expect(balanced).toMatchObject({ variant: 0, embedding: "qwen3-embedding-4b-q8" });
    expect(balanced?.fit?.verdict).toBe("fits");
    const pack = catalog().packs.find((p) => p.id === "balanced") as Pack;
    const input: AdviceInput = {
      choice: { pack: "balanced" },
      variant: pack.variants[0],
      machine: m,
      lines: [],
      budgets: { queryMs: 1000, indexPassagesPerSec: 5, headroom: 0.15 },
    };
    expect(fitsVariant(pack.variants[0], input).verdict).toBe("fits");
    expect(packVariantThatFits(pack, input)?.i).toBe(0);
  });

  it("doctor: model.fit is ok for the pair being served, a warning for another one", async () => {
    const m = await serving4b();
    const deps = (wanted: string[]): ModelDeps => ({
      machine: async () => m,
      ollama: async () => null,
      active: async () => ({ embedding: null, reranker: null, wanted }),
      space: async () => null,
    });
    const rows = async (wanted: string[]) =>
      Object.fromEntries((await modelRows(null, deps(wanted))).map((r) => [r.id, r]));
    expect((await rows(["qwen3-embedding-4b-q8", "qwen3-reranker-0.6b-q8"]))["model.fit"].state).toBe("ok");
    const other = (await rows(["qwen3-embedding-8b-q4"]))["model.fit"];
    expect(other.state).toBe("warn");
    expect(other.detail).toMatch(/llama\.cpp holds Qwen3 Embedding 4B \(8-bit\)/);
  });
});
