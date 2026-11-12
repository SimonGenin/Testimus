import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { activeModels, setActiveChoice } from "../../../../src/core/rag/activation.ts";
import type { MachineProfile } from "../../../../src/core/types.ts";

const machine = vi.hoisted(() => ({ known: null as MachineProfile | null, profiled: 0 }));

vi.mock("../../../../src/core/lib/machine/profile.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/machine/profile.ts")>();
  const { mockMachine } = await import("../../../../src/core/mock/machine.ts");
  return {
    ...real,
    knownMachine: () => machine.known,
    machineProfile: async () => {
      machine.profiled++;
      machine.known = mockMachine("gpu16");
      return machine.known;
    },
  };
});

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let root: string;
let dir: string;

// ponytail: BGE-M3 16-bit found in a models folder of this PC (TESTIMUS_MODELS), not registered: its device is
// decided when it is resolved
function foundOnDisk(models: string): void {
  const m = join(models, "Xenova", "bge-m3");
  mkdirSync(join(m, "onnx"), { recursive: true });
  for (const f of ["config.json", "tokenizer.json", "onnx/model_fp16.onnx"]) writeFileSync(join(m, f), "{}");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-activation-machine-"));
  dir = join(root, "Projet");
  cpSync(FIXTURE, dir, { recursive: true });
  foundOnDisk(join(root, "models"));
  vi.stubEnv("TESTIMUS_MODELS", join(root, "models"));
  vi.stubEnv("TESTIMUS_MACHINE", "");
  rmSync(registryFile(), { force: true });
  machine.known = null;
  machine.profiled = 0;
});

afterEach(() => {
  setActiveChoice(dir, null);
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("the device of the model in use", () => {
  it("a process that has not profiled this PC yet profiles it before resolving: a card's model goes to the card", async () => {
    setActiveChoice(dir, { embedding: "bge-m3-fp16", reranker: null });
    const a = await activeModels(dir);
    expect(a.embedding).toMatchObject({ device: "dml", dtype: "fp16" });
    expect(machine.profiled).toBe(1);
    await activeModels(dir);
    expect(machine.profiled).toBe(1);
  });
});
