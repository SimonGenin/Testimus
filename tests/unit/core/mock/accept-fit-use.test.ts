import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { showJob } from "../../../../src/core/jobs.ts";
import { recordPerf } from "../../../../src/core/lib/models-perf.ts";
import { readSettings, writeSettings } from "../../../../src/core/lib/project.ts";
import { setupMock } from "../../../../src/core/mock/index.ts";
import { setupModelsMock } from "../../../../src/core/mock/models.ts";
import type { DoctorCheck } from "../../../../src/core/types.ts";

let project = "";
const TIGHT = { embedding: "qwen3-embedding-8b-q8", reranker: "qwen3-reranker-4b-q8" };

async function waitJob(id: string): Promise<{ status: string; error?: string }> {
  for (let i = 0; i < 400; i++) {
    const j = showJob(project, id) ?? showJob(null, id);
    if (j && j.job.status !== "running") return j.job as never;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${id} did not end`);
}

const fitRow = async () =>
  ((await invoke("system.doctor", {}, { project })) as { checks: DoctorCheck[] }).checks.find(
    (c) => c.id === "model.fit",
  ) as DoctorCheck;
const forget = () => writeSettings({ ...readSettings(), rag: { ...readSettings().rag, fitAccepted: {} } });

beforeAll(async () => {
  process.env.TESTIMUS_MOCK_DOWNLOAD_MS = "20";
  delete process.env.TESTIMUS_MACHINE;
  project = (await setupMock()) ?? "";
  await setupModelsMock(mkdtempSync(join(tmpdir(), "testimus-mockm-")), project, {
    machine: "gpu16",
    llamacpp: "found",
    modelsDir: "set",
    advice: "none",
    index: "vectors",
    downloadMs: 20,
  });
  for (const model of [TIGHT.embedding, TIGHT.reranker]) await invoke("models.pull", { model }, { project });
}, 60_000);

describe("« Use anyway » in Settings › Models counts for the system check", () => {
  it("models.use without accept leaves the tight fit to do; with accept it is OK, marked Used anyway", async () => {
    forget();
    const plain = (await invoke("models.use", TIGHT, { project })) as { fit: { verdict: string } };
    expect(["tight", "gpu-too-small"]).toContain(plain.fit.verdict);
    expect(await fitRow()).toMatchObject({ state: "warn", also: { command: "models.acceptFit" } });
    await invoke("models.use", { ...TIGHT, accept: true }, { project });
    expect(await fitRow()).toMatchObject({ state: "ok", caution: "Used anyway" });
  });

  it("models.usePack with accept keeps the verdict it judged; without accept, or on a pack that fits, nothing", async () => {
    forget();
    await invoke("models.use", { embedding: "bge-m3-q8", reranker: null }, { project });
    const pack = async (accept: boolean) => {
      const out = (await invoke("models.usePack", { pack: "quality", accept }, { project })) as { jobId?: string };
      if (out.jobId) expect((await waitJob(out.jobId)).status).toBe("done");
    };
    await pack(true);
    expect(readSettings().rag?.fitAccepted).toEqual({});
    // ponytail: a load measured on this PC weighs more than the catalog says — the Quality pair is tight now
    recordPerf({
      at: new Date().toISOString(),
      op: "model.load",
      model: "qwen3-embedding-8b-q4",
      items: 1,
      ms: 9,
      vramMB: 8000,
    });
    await invoke("models.use", { embedding: "bge-m3-q8", reranker: null }, { project });
    await pack(false);
    expect(await fitRow()).toMatchObject({ state: "warn", detail: expect.stringMatching(/^Tight/) });
    await invoke("models.use", { embedding: "bge-m3-q8", reranker: null }, { project });
    await pack(true);
    expect(await fitRow()).toMatchObject({ state: "ok", caution: "Used anyway" });
  });
});
