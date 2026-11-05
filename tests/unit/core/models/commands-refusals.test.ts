import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { cancelJob, listJobs } from "../../../../src/core/jobs.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { journalFile } from "../../../../src/core/lib/models-perf.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import { resolveInstalled } from "../../../../src/core/lib/models-resolve.ts";
import { modelsDeps } from "../../../../src/core/lib/models-use.ts";
import { DEFAULT_PROJECT, readProject, settingsFile, writeProject } from "../../../../src/core/lib/project.ts";
import type { ActiveChoice, MachineProfile, RagChoice } from "../../../../src/core/types.ts";

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB: 16303, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
};

const saved = { ...modelsDeps };
let active: ActiveChoice | RagChoice | null = null;
let indexed: string[] = [];
let project = "";

const installAt = (...ids: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-cov-cmdm-i-"));
  writeRegistry({
    ...readRegistry(),
    installs: [
      ...readRegistry().installs,
      ...ids.map((model) => ({
        model,
        via: "path" as const,
        runtime: "llamacpp" as const,
        path: dir,
        status: "verified" as const,
      })),
    ],
  });
};

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  rmSync(journalFile(), { force: true });
  project = mkdtempSync(join(tmpdir(), "testimus-cov-cmdm-"));
  writeProject(project, DEFAULT_PROJECT);
  pinMachineProfile(devPc);
  active = null;
  indexed = [];
  modelsDeps.activeChoice = async () => active as ActiveChoice | null;
  modelsDeps.setActiveChoice = async (_p, c) => {
    active = c;
  };
  modelsDeps.queryTask = async () => "task";
  modelsDeps.startIndex = async (p) => {
    indexed.push(p);
    return "rag-index-fake";
  };
  modelsDeps.activeModels = async () => {
    const c = active;
    const v = c && "embedding" in c ? c : null;
    return {
      embedding: v ? resolveInstalled(v.embedding) : null,
      reranker: v?.reranker ? resolveInstalled(v.reranker) : null,
      choice: c as ActiveChoice | null,
      missing: [],
    } as never;
  };
});
afterEach(() => {
  Object.assign(modelsDeps, saved);
  pinMachineProfile(null);
});

describe("models.use — refusals and the reference", () => {
  it("needs an embedding when none is in use", async () => {
    await expect(invoke("models.use", {}, { project })).rejects.toThrow(/Name the embedding to use/);
  });

  it("refuses a reranker that is not one, and a pair too big for the RAM", async () => {
    await expect(
      invoke("models.use", { embedding: "qwen3-embedding-4b-q8", reranker: "qwen3-embedding-0.6b-q8" }, { project }),
    ).rejects.toThrow(/is not a reranker/);
    pinMachineProfile({ ...devPc, gpus: [], ramTotalMB: 1000, ramFreeMB: 500 });
    await expect(invoke("models.use", { embedding: "qwen3-embedding-8b-q8" }, { project })).rejects.toThrow(
      /of memory; this PC has/,
    );
  });

  it("a failure to read the models in use counts as none in use", async () => {
    modelsDeps.activeModels = async () => {
      throw new Error("broken");
    };
    await expect(invoke("models.use", {}, { project })).rejects.toThrow(/Name the embedding to use/);
  });

  it("an installed pair becomes the team reference when asked", async () => {
    installAt("qwen3-embedding-4b-q8");
    const r = (await invoke(
      "models.use",
      { embedding: "qwen3-embedding-4b-q8", reranker: null, reference: true },
      { project },
    )) as { reindex: boolean };
    expect(r.reindex).toBe(true);
    expect(readProject(project).rag.reference).toEqual({ embedding: "qwen3-embedding-4b-q8", reranker: null });
    expect(indexed).toEqual([project]);
  });
});

describe("models.setDir — a copy cancelled while awaited", () => {
  it("reports the cancel and keeps the old copy", async () => {
    const base = mkdtempSync(join(tmpdir(), "testimus-cov-cmdm-dir-"));
    const old = join(base, "old");
    const onnx = join(old, "Xenova", "bge-m3");
    mkdirSync(join(onnx, "onnx"), { recursive: true });
    writeFileSync(join(onnx, "config.json"), "{}");
    writeFileSync(join(onnx, "onnx", "model_quantized.onnx"), Buffer.alloc(4_000_000, 7));
    writeRegistry({
      ...readRegistry(),
      dir: old,
      installs: [{ model: "bge-m3-q8", via: "download", runtime: "transformers", path: onnx, status: "installed" }],
    });
    const run = invoke("models.setDir", { dir: join(base, "new"), copy: true }, { project: null, wait: true });
    let id = "";
    for (let i = 0; i < 1000; i++) {
      const job = listJobs(null).find((j) => j.kind === "models-dir" && j.status === "running");
      if (job) {
        id = job.id;
        cancelJob(job.id);
        break;
      }
      await new Promise((r) => setImmediate(r));
    }
    await expect(run).resolves.toMatchObject({ action: "copy", cancelled: true });
    expect(listJobs(null).find((j) => j.id === id)?.status).toBe("cancelled");
    expect(existsSync(join(onnx, "onnx", "model_quantized.onnx"))).toBe(true);
    expect(readRegistry().dir).toBe(old);
  });
});

describe("models.usePack, models.advice, models.pullRuntime", () => {
  it("an unknown pack is refused as unknown", async () => {
    await expect(invoke("models.usePack", { pack: "nope" }, { project })).rejects.toThrow(/unknown pack/);
  });

  it("no advice while no model is in use", async () => {
    expect(await invoke("models.advice", {}, { project })).toEqual([]);
  });

  it("pullRuntime with a named backend skips the machine's choice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-cov-cmdm-rt-"));
    writeRegistry({ ...readRegistry(), dir });
    const asked: string[] = [];
    modelsDeps.llama = async () =>
      ({
        chooseBackend: () => {
          throw new Error("not asked");
        },
        pullLlamaBuild: async (backend: string, d: string, onProgress: (p: object) => void) => {
          asked.push(backend);
          onProgress({ file: "llama.zip", loaded: 1024 * 1024, total: 2 * 1024 * 1024 });
          return { exe: join(d, "x", "llama-server.exe"), build: "b1", backend, via: "download" };
        },
      }) as unknown as Awaited<ReturnType<typeof modelsDeps.llama>>;
    const r = await invoke("models.pullRuntime", { backend: "vulkan" }, { project: null, wait: true });
    expect(r).toMatchObject({ backend: "vulkan", build: "b1" });
    expect(asked).toEqual(["vulkan"]);
  });
});
