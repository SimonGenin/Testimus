import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { cancelJob, listJobs, waitJob } from "../../../../src/core/jobs.ts";
import { readRegistry } from "../../../../src/core/lib/models-registry.ts";
import { setupMock } from "../../../../src/core/mock/index.ts";
import { call } from "../registry.ts";

type Pack = { id: string; available: boolean; lighter: string | null; active: boolean };
type Fit = { verdict: string };

let project = "";

beforeAll(async () => {
  process.env.TESTIMUS_MOCK_DOWNLOAD_MS = "20";
  delete process.env.TESTIMUS_MACHINE;
  project = (await setupMock()) ?? "";
}, 60_000);

describe("models.* through the registry, outputs checked against their schemas (serve --mock)", () => {
  it("reads: catalog, list, dirs, hardware, fit, perf", async () => {
    const catalog = await call<{ id: string }[]>("models.catalog", {}, null);
    expect(catalog.length).toBeGreaterThan(5);
    expect((await call<{ id: string }[]>("models.catalog", { kind: "reranker" }, null)).length).toBeLessThan(
      catalog.length,
    );
    expect((await call<{ model: string }[]>("models.list", {}, null)).map((r) => r.model)).toContain("bge-m3-q8");
    const dirs = await call<{ dir: string | null; runtimesDir: string | null }>("models.dirs", {}, null);
    expect(dirs.dir).toBe(readRegistry().dir);
    expect(dirs.runtimesDir).toBe(join(dirs.dir ?? "", "runtimes"));
    expect((await call<{ gpus: unknown[] }>("models.hardware", { refresh: true }, null)).gpus.length).toBe(1);
    expect((await call<Fit>("models.fit", { embedding: "bge-m3-q8" }, null)).verdict).toBe("fits");
    await expect(invoke("models.fit", {}, { project: null })).rejects.toThrow(/Name a model/);
    expect((await call<{ op: string }[]>("models.perf", { model: "bge-m3-q8" }, null)).length).toBeGreaterThan(0);
  });

  it("packs name the next lighter pack available; planPack plans and starts nothing", async () => {
    const packs = await call<Pack[]>("models.packs", {}, project);
    expect(packs.find((p) => p.id === "quality")?.lighter).toBe("balanced");
    expect(packs.find((p) => p.id === "light")?.lighter).toBeNull();
    const plan = await call<{ pack: string; plan: { download: { model: string }[]; dir: string | null } }>(
      "models.planPack",
      { pack: "performance" },
      project,
    );
    expect(plan.plan.download.map((d) => d.model)).toEqual(["qwen3-embedding-0.6b-onnx-fp16"]);
    expect(plan.plan.dir).toBe(readRegistry().dir);
    expect(listJobs(project).filter((j) => j.kind === "models-usePack")).toEqual([]);
    await expect(invoke("models.planPack", { pack: "nope" }, { project })).rejects.toThrow(/not available/);
  });

  it("advice, then dismissAdvice hides it", async () => {
    const advice = await call<{ id: string }[]>("models.advice", {}, project);
    expect(advice).toHaveLength(1);
    expect(await call("models.dismissAdvice", { id: advice[0].id }, project)).toEqual({ dismissed: advice[0].id });
    expect(await call("models.advice", {}, project)).toEqual([]);
    await expect(invoke("models.dismissAdvice", { id: "gone" }, { project })).rejects.toThrow(/No current advice/);
  });

  it("use: dryRun says the fit and a lighter model and changes nothing; then it activates and starts the index", async () => {
    const dry = await call<{ dryRun: boolean; indexJob: string | null; lighter: string | null; fit: Fit }>(
      "models.use",
      { embedding: "qwen3-embedding-8b-q4", dryRun: true },
      project,
    );
    expect(dry).toMatchObject({ dryRun: true, indexJob: null });
    expect(dry.lighter).not.toBe("qwen3-embedding-8b-q4");
    expect(listJobs(project).filter((j) => j.kind === "rag-index" && j.status === "running")).toEqual([]);
    const used = await call<{ indexJob: string | null; reindex: boolean; choice: { embedding: string } }>(
      "models.use",
      { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null },
      project,
    );
    expect(used).toMatchObject({ reindex: true, choice: { embedding: "qwen3-embedding-0.6b-onnx-q8" } });
    expect(used.indexJob).toMatch(/^rag-index-/);
    cancelJob(used.indexJob ?? "", project);
    await waitJob(used.indexJob ?? "").catch(() => {});
  }, 60_000);

  it("usePack is a job with its steps; its result names the index job", async () => {
    const out = await call<{ pack: string; indexJob: string | null }>("models.usePack", { pack: "light" }, project);
    expect(out.pack).toBe("light");
    const job = listJobs(project).find((j) => j.kind === "models-usePack" && j.subject === "light");
    expect(job?.status).toBe("done");
    expect(job?.steps?.map((s) => s.id)).toEqual(["activate"]);
    if (out.indexJob) {
      cancelJob(out.indexJob, project);
      await waitJob(out.indexJob).catch(() => {});
    }
  }, 60_000);

  it("pull, verify, remove, pullRuntime, add", async () => {
    const pulled = await call<{ via: string; where: string }>("models.pull", { model: "qwen3-embedding-4b-q8" }, null);
    expect(pulled.via).toBe("download");
    expect(existsSync(pulled.where)).toBe(true);
    const v = await call<{ ok: boolean }>("models.verify", { model: "qwen3-embedding-0.6b-onnx-q8" }, null);
    expect(v.ok).toBe(true);
    expect(listJobs(null).some((j) => j.kind === "models-verify" && j.status === "done")).toBe(true);
    expect(await call("models.remove", { model: "qwen3-embedding-4b-q8" }, null)).toMatchObject({ removed: "files" });
    const rt = await call<{ backend: string }>("models.pullRuntime", { backend: "cpu" }, null);
    expect(rt.backend).toBe("cpu");
    const bge = readRegistry().installs.find((i) => i.model === "bge-m3-q8");
    const added = await call<{ model: string; via: string }>(
      "models.add",
      { path: bge?.path ?? "", model: "bge-m3-q8" },
      null,
    );
    expect(added).toMatchObject({ model: "bge-m3-q8", via: "path" });
  }, 60_000);

  it("planDir plans and changes nothing; setDir is a job that moves the downloads", async () => {
    const target = join(mkdtempSync(join(tmpdir(), "testimus-models-dir-")), "models");
    const plan = await call<{ action: string; files: number }>("models.planDir", { dir: target, move: true }, null);
    expect(plan.action).toBe("move");
    expect(plan.files).toBeGreaterThan(0);
    expect(readRegistry().dir).not.toBe(target);
    await expect(invoke("models.setDir", { dir: target }, { project: null })).rejects.toThrow(/Say what to do/);
    const out = await call<{ action: string; cancelled: boolean }>("models.setDir", { dir: target, move: true }, null);
    expect(out).toMatchObject({ action: "move", cancelled: false });
    expect(readRegistry().dir).toBe(target);
    const job = listJobs(null).find((j) => j.kind === "models-dir" && j.subject === `move to ${target}`);
    expect(job?.status).toBe("done");
  }, 60_000);
});
