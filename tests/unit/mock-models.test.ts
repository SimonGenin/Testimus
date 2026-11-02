import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { showJob } from "../../src/core/jobs.ts";
import { readRegistry } from "../../src/core/lib/models-registry.ts";
import { setupMock } from "../../src/core/mock/index.ts";
import { fakeSha, type MockModelsOptions, mockDownloads, setupModelsMock } from "../../src/core/mock/models.ts";
import { setActiveChoice } from "../../src/core/rag/activation.ts";

type Pack = {
  id: string;
  active: boolean;
  available: boolean;
  variant: number | null;
  embedding: string | null;
  reranker: string | null;
  fit: { verdict: string; message: string } | null;
  skipped: string[];
  downloadMB: number;
};

let project = "";
const DEFAULTS: MockModelsOptions = {
  machine: "gpu16",
  llamacpp: "found",
  modelsDir: "set",
  advice: "upgrade",
  index: "vectors",
  downloadMs: 30,
};

async function replay(o: Partial<MockModelsOptions>) {
  delete process.env.TESTIMUS_MACHINE;
  const root = mkdtempSync(join(tmpdir(), "testimus-mockm-"));
  return setupModelsMock(root, project, { ...DEFAULTS, ...o });
}

async function waitJob(id: string): Promise<{ status: string; result?: unknown; error?: string }> {
  for (let i = 0; i < 400; i++) {
    const j = showJob(project, id) ?? showJob(null, id);
    if (j && j.job.status !== "running") return j.job as never;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not end`);
}

const packs = async () => (await invoke("models.packs", {}, { project })) as Pack[];

beforeAll(async () => {
  process.env.TESTIMUS_MOCK_DOWNLOAD_MS = "30";
  delete process.env.TESTIMUS_MACHINE;
  project = await setupMock();
}, 60_000);

describe("serve --mock models", () => {
  it("defaults: a 16 GB GPU, llama.cpp found, a models folder, an upgrade advice", async () => {
    const hw = (await invoke("models.hardware", {}, { project: null })) as { gpus: { name: string }[] };
    expect(hw.gpus[0].name).toMatch(/RTX 4080/);
    const r = readRegistry();
    expect(r.dir).toBeTruthy();
    expect(r.llamacpp?.backend).toBe("cuda");
    expect(existsSync(r.llamacpp?.exe ?? "")).toBe(true);
    const list = (await invoke("models.list", {}, { project: null })) as { model: string; via: string }[];
    expect(list.map((l) => `${l.model}:${l.via}`)).toEqual(
      expect.arrayContaining(["bge-m3-q8:path", "bge-reranker-v2-m3-q8:download", "qwen3-embedding-0.6b-q8:download"]),
    );
    const p = await packs();
    expect(p.find((x) => x.id === "light")).toMatchObject({ active: true, downloadMB: 0 });
    const q = p.find((x) => x.id === "quality");
    expect(q).toMatchObject({ variant: 0, embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" });
    expect(q?.skipped).toEqual([]);
    const advice = (await invoke("models.advice", {}, { project })) as { direction: string; to: unknown }[];
    expect(advice).toEqual([expect.objectContaining({ direction: "upgrade", to: { pack: "performance" } })]);
    const perf = (await invoke("models.perf", {}, { project: null })) as { op: string; count: number }[];
    expect(perf.find((s) => s.op === "embed.query")?.count).toBeGreaterThanOrEqual(50);
  });

  it("usePack downloads through the real checked download, then activates and reindexes", async () => {
    const plan = (await invoke("models.usePack", { pack: "performance", dryRun: true }, { project })) as {
      plan: { download: { model: string }[] };
    };
    expect(plan.plan.download.map((d) => d.model)).toEqual(["qwen3-embedding-0.6b-onnx-fp16"]);
    const out = (await invoke("models.usePack", { pack: "performance" }, { project })) as { jobIds: string[] };
    const job = await waitJob(out.jobIds[0]);
    expect(job.status).toBe("done");
    const inst = readRegistry().installs.find((i) => i.model === "qwen3-embedding-0.6b-onnx-fp16");
    expect(inst).toMatchObject({ via: "download", status: "installed" });
    const onnx = join(inst?.path ?? "", "onnx", "model_fp16.onnx_data");
    expect(fakeSha(readFileSync(onnx).length)).toBe(
      readRegistry()
        .catalog?.find((e) => e.id === "qwen3-embedding-0.6b-onnx-fp16")
        ?.source.hf?.files?.at(-1)?.sha256,
    );
    expect((await packs()).find((x) => x.id === "performance")?.active).toBe(true);
  });

  it("a half-downloaded GGUF resumes with a Range request", async () => {
    mockDownloads.fetched.length = 0;
    const r = (await invoke("models.pull", { model: "qwen3-embedding-4b-q8" }, { project: null })) as {
      via: string;
      where: string;
    };
    expect(r.via).toBe("download");
    expect(existsSync(r.where)).toBe(true);
    expect(existsSync(`${r.where}.part`)).toBe(false);
    expect(mockDownloads.fetched).toHaveLength(1);
  });

  it("machine profiles play GPU too small, RAM too small and unknown", async () => {
    await replay({ machine: "gpu-small" });
    let p = await packs();
    expect(p.find((x) => x.id === "quality")?.fit?.verdict).toBe("gpu-too-small");
    const balanced = p.find((x) => x.id === "balanced");
    expect(balanced).toMatchObject({ variant: 1, embedding: "qwen3-embedding-0.6b-q8", fit: { verdict: "fits" } });
    expect(balanced?.skipped[0]).toMatch(
      /Qwen3 Embedding 4B \(4-bit\) .*: 4\.6 GB needed, 4\.0 GB on the GPU \(gpu-too-small\)/,
    );
    await replay({ machine: "cpu-only" });
    p = await packs();
    const quality = p.find((x) => x.id === "quality");
    expect(quality).toMatchObject({ available: true, variant: 2, fit: { verdict: "tight" } });
    expect(quality?.skipped[0]).toMatch(/of memory \(ram-too-small\)$/);
    const plan = (await invoke("models.usePack", { pack: "quality", dryRun: true }, { project })) as {
      variant: number;
    };
    expect(plan.variant).toBe(2);
    expect(readRegistry().llamacpp?.backend).toBe("cpu");
    await replay({ machine: "unknown" });
    p = await packs();
    expect(p.find((x) => x.id === "balanced")?.fit?.verdict).toBe("unknown");
    await replay({ machine: "dev" });
    const hw = (await invoke("models.hardware", {}, { project: null })) as { gpus: { name: string }[] };
    expect(hw.gpus.map((g) => g.name)).toEqual(["NVIDIA GeForce RTX 5080", "Intel(R) Graphics"]);
  });

  it("no models folder: the first download stops and asks; llama.cpp absent is fetched in a fake job", async () => {
    const m = await replay({ modelsDir: "unset", llamacpp: "absent" });
    expect(readRegistry().dir).toBeUndefined();
    await expect(invoke("models.usePack", { pack: "balanced" }, { project })).rejects.toThrow(/Choose where models/);
    const dir = join(m.shared, "..", "chosen-models");
    await invoke("models.setDir", { dir }, { project: null });
    const out = (await invoke("models.usePack", { pack: "balanced" }, { project })) as { jobIds: string[] };
    expect((await waitJob(out.jobIds[0])).status).toBe("done");
    expect(readRegistry().llamacpp?.via).toBe("download");
    expect(existsSync(readRegistry().llamacpp?.exe ?? "")).toBe(true);
  });

  it("slow queries or a model partly on the processor give a downgrade advice", async () => {
    setActiveChoice(project, null);
    await replay({ advice: "downgrade" });
    const to = { embedding: "qwen3-embedding-0.6b-q8", reranker: "qwen3-reranker-0.6b-q8" };
    let advice = (await invoke("models.advice", {}, { project })) as {
      direction: string;
      to: unknown;
      reason: string;
    }[];
    expect(advice).toEqual([expect.objectContaining({ direction: "downgrade", to })]);
    expect(advice[0].reason).toMatch(/queries take/);
    setActiveChoice(project, null);
    await replay({ advice: "offload" });
    advice = (await invoke("models.advice", {}, { project })) as { direction: string; to: unknown; reason: string }[];
    expect(advice[0]?.reason).toMatch(/partly on the processor/);
  });
});
