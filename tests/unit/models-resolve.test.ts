import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalog, catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { pinMachineProfile } from "../../src/core/lib/models-hardware.ts";
import { readRegistry, writeRegistry } from "../../src/core/lib/models-registry.ts";
import { ggufPath, resolveChoice, resolveInstalled } from "../../src/core/lib/models-resolve.ts";
import { settingsFile } from "../../src/core/lib/project.ts";
import type { CatalogEntry, MachineProfile } from "../../src/core/types.ts";

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

const cpuLaptop: MachineProfile = { ...devPc(), gpus: [], ramTotalMB: 16000, ramFreeMB: 8000 };
const amdPc: MachineProfile = {
  ...devPc(),
  gpus: [{ name: "AMD Radeon 780M", vendor: "amd", vramTotalMB: null, vramUsedMB: null, source: "wmi" }],
};

let dir: string;
beforeEach(() => {
  rmSync(registryFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  dir = mkdtempSync(join(tmpdir(), "testimus-resolve-"));
  pinMachineProfile(devPc());
});
afterEach(() => pinMachineProfile(null));

function placeGguf(root: string, id: string): string {
  const file = ggufPath(root, catalogEntry(id) as CatalogEntry) as string;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "gguf");
  return file;
}

describe("source and runtime of one model (§7.2)", () => {
  const id = "qwen3-embedding-4b-q4";
  const machine = async () => devPc();

  it("the file already registered comes first, then a download", async () => {
    const none = await resolveChoice({ embedding: id, reranker: null }, "task", { machine });
    expect(none.sources).toEqual({ [id]: "download" });
    expect(none.embedding).toBeNull();
    expect(none.missing).toEqual([id]);

    const file = placeGguf(join(dir, "share"), id);
    writeRegistry({
      ...readRegistry(),
      installs: [{ model: id, via: "path", runtime: "llamacpp", path: file, status: "verified" }],
    });
    const reg = await resolveChoice({ embedding: id, reranker: null }, "task", { machine });
    expect(reg.sources).toEqual({ [id]: "registered" });
    expect(reg.embedding).toMatchObject({ runtime: "llamacpp", device: "gpu", install: { path: file, device: "gpu" } });
  });

  it("a file in the chosen models folder is found without being registered", async () => {
    writeRegistry({ ...readRegistry(), dir });
    const file = placeGguf(dir, id);
    const r = resolveInstalled(id, "task");
    expect(r).toMatchObject({ runtime: "llamacpp", install: { via: "path", path: file } });
  });

  it("downloads off and nothing here: unavailable, with the reason", async () => {
    writeRegistry({ ...readRegistry(), allowRemote: false });
    const r = await resolveChoice({ embedding: id, reranker: null }, "task", { machine });
    expect(r.sources).toEqual({ [id]: "unavailable" });
    expect(r.reasons?.[id]).toMatch(/downloads are off/);
  });

  it("ONNX entries: DirectML when the entry has a dml dtype and the PC a GPU, else CPU", () => {
    const onnx = join(dir, "onnx");
    writeRegistry({ ...readRegistry(), dir: onnx });
    for (const e of ["bge-m3-fp16", "bge-m3-q8"]) {
      const entry = catalogEntry(e) as CatalogEntry;
      const root = join(onnx, ...(entry.source.hf?.repo.split("/") ?? []));
      for (const f of entry.source.hf?.files ?? []) {
        mkdirSync(dirname(join(root, f.path)), { recursive: true });
        writeFileSync(join(root, f.path), Buffer.alloc(0));
      }
    }
    writeRegistry({
      ...readRegistry(),
      installs: [
        {
          model: "bge-m3-fp16",
          via: "download",
          runtime: "transformers",
          path: join(onnx, "Xenova", "bge-m3"),
          status: "installed",
        },
      ],
    });
    expect(resolveInstalled("bge-m3-fp16")).toMatchObject({ device: "dml", dtype: "fp16", install: { device: "dml" } });
    pinMachineProfile(cpuLaptop);
    writeRegistry({
      ...readRegistry(),
      installs: [
        {
          model: "bge-m3-fp16",
          via: "download",
          runtime: "transformers",
          path: join(onnx, "Xenova", "bge-m3"),
          status: "installed",
        },
      ],
    });
    expect(resolveInstalled("bge-m3-fp16")).toMatchObject({ device: "cpu", dtype: "fp16" });
  });
});

describe("packs (§7.12)", () => {
  it("Quality on the dev PC: variant 1 fits and applies, nothing skipped", async () => {
    const r = await resolveChoice({ pack: "quality" }, "task", { machine: async () => devPc() });
    expect(r.variantIndex).toBe(0);
    expect(r.variant).toEqual({ embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" });
    expect(r.skipped).toEqual([]);
    expect(r.fit?.verdict).toBe("fits");
    expect(r.missing.sort()).toEqual(["qwen3-embedding-8b-q4", "qwen3-reranker-4b-q8"]);
  });

  it("Quality with less free GPU memory: variant 1 is skipped with the numbers, variant 2 applies", async () => {
    const busy = devPc({ gpus: [{ ...devPc().gpus[0], vramUsedMB: 6000 }] } as Partial<MachineProfile>);
    const r = await resolveChoice({ pack: "quality" }, "task", { machine: async () => busy });
    expect(r.variantIndex).toBe(1);
    expect(r.variant).toEqual({ embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-0.6b-q8" });
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatch(
      /Qwen3 Embedding 8B \(4-bit\) \+ Qwen3 Reranker 4B .*: 10\.3 GB needed, 8\.6 GB usable \(tight\)/,
    );
    expect(r.fit?.verdict).toBe("fits");
  });

  it("a pack whose every variant is tight resolves to its lightest, flagged", async () => {
    const small: MachineProfile = { ...cpuLaptop, ramFreeMB: 6000 };
    const r = await resolveChoice({ pack: "quality" }, "task", { machine: async () => small });
    expect(r.variantIndex).toBe(2);
    expect(r.fit?.verdict).toBe("tight");
    expect(r.skipped).toHaveLength(2);
  });

  it("a pack with nothing that fits in RAM is not available, with the reason", async () => {
    const tiny: MachineProfile = { ...cpuLaptop, ramTotalMB: 2000, ramFreeMB: 1500 };
    const r = await resolveChoice({ pack: "quality" }, "task", { machine: async () => tiny });
    expect(r.variant).toBeNull();
    expect(r.skipped.join(" ")).toMatch(/ram-too-small/);
  });

  it("P8 — every pack resolves with transformers.js and llama.cpp, on every kind of PC; Light and Performance with transformers.js only", async () => {
    for (const machine of [devPc(), cpuLaptop, amdPc])
      for (const p of catalog().packs) {
        const r = await resolveChoice({ pack: p.id }, "task", { machine: async () => machine });
        expect(r.variant, `${p.id} on ${machine.gpus[0]?.name ?? "CPU"}`).not.toBeNull();
        for (const s of Object.values(r.sources ?? {})) expect(["registered", "found", "download"]).toContain(s);
        if (p.id === "light" || p.id === "performance")
          for (const id of [r.variant?.embedding, r.variant?.reranker].filter((m): m is string => !!m))
            expect(catalogEntry(id)?.runtimes).toContain("transformers");
      }
  });

  it("unknown GPU memory: GGUF variants are « unknown », the pack falls back to its lightest", async () => {
    const r = await resolveChoice({ pack: "balanced" }, "task", { machine: async () => amdPc });
    expect(r.variantIndex).toBe(1);
    expect(r.fit?.verdict).toBe("unknown");
  });
});
