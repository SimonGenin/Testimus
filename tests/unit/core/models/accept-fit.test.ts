import { afterEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ModelDeps, modelDeps, modelRows } from "../../../../src/core/lib/doctor-models.ts";
import { readSettings } from "../../../../src/core/lib/project.ts";
import type { DoctorCheck, MachineProfile } from "../../../../src/core/types.ts";

const pc = (vramTotalMB = 16303, ramFreeMB = 40000): MachineProfile => ({
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
});

const QUALITY = ["qwen3-embedding-8b-q8", "qwen3-reranker-4b-q8"];
const saved = { ...modelDeps };
let machine = pc();
let wanted = QUALITY;
Object.assign(modelDeps, {
  machine: async () => machine,
  active: async () => ({ embedding: null, reranker: null, wanted }),
} satisfies Partial<ModelDeps>);

afterEach(() => {
  machine = pc();
  wanted = QUALITY;
});

const fitRow = async () =>
  (
    await modelRows(null, { ...saved, machine: modelDeps.machine, active: modelDeps.active, space: async () => null })
  ).find((r) => r.id === "model.fit") as DoctorCheck;
const accept = (undo = false) => invoke("models.acceptFit", { undo }, { project: null });

describe("Use anyway on a tight fit (models.acceptFit)", () => {
  it("a tight pair warns with Use anyway beside the lighter pack; once accepted it is ok, marked Used anyway", async () => {
    const before = await fitRow();
    expect(before).toMatchObject({
      state: "warn",
      action: { command: "models.usePack" },
      also: { label: "Use anyway", command: "models.acceptFit" },
    });
    expect(before.detail).toMatch(/^Tight:/);
    expect(before.fix).toMatch(/testimus models acceptFit/);
    expect(await accept()).toEqual({ models: QUALITY, verdict: "tight", accepted: true });
    expect(readSettings().rag?.fitAccepted).toEqual({ [QUALITY.join("+")]: "tight" });
    const after = await fitRow();
    expect(after).toEqual({
      id: "model.fit",
      label: "Models fit this PC",
      state: "ok",
      detail: before.detail,
      caution: "Used anyway",
    });
  });

  it("a worse verdict for the same models, or other models, asks again; undo takes it back", async () => {
    await accept();
    machine = pc(8000);
    expect(await fitRow()).toMatchObject({ state: "warn", also: { command: "models.acceptFit" } });
    machine = pc();
    wanted = ["qwen3-embedding-8b-q8", "qwen3-reranker-0.6b-q8"];
    expect((await fitRow()).caution).toBeUndefined();
    wanted = QUALITY;
    expect((await fitRow()).caution).toBe("Used anyway");
    expect(await accept(true)).toMatchObject({ accepted: false });
    expect((await fitRow()).state).toBe("warn");
  });

  it("a fit that fits, or one that cannot run, cannot be accepted", async () => {
    wanted = ["qwen3-embedding-4b-q8"];
    await expect(accept()).rejects.toThrow(/nothing to accept/);
    wanted = QUALITY;
    machine = { ...pc(0, 512), gpus: [], ramTotalMB: 1024 };
    const row = await fitRow();
    expect(row.state).toBe("fail");
    expect(row.also).toBeUndefined();
    await expect(accept()).rejects.toThrow(/cannot run on this PC/);
    wanted = [];
    await expect(accept()).rejects.toThrow(/No model in use/);
  });
});
