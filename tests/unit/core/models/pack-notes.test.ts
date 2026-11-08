import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { registryFile } from "../../../../src/core/lib/models-catalog.ts";
import { type PackContext, type PackRow, packRows } from "../../../../src/core/lib/models-packs.ts";
import { journalFile } from "../../../../src/core/lib/models-perf.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import { variantName } from "../../../../src/core/lib/models-resolve.ts";
import { readSettings, settingsFile, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import type { MachineProfile, PackVariant } from "../../../../src/core/types.ts";

const GB = 1024;
const Q8_4 = { embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" };
const Q4_4 = { embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-4b-q8" };
const LIGHT = { embedding: "bge-m3-q8", reranker: null };

// ponytail: an RTX 4070 (12 GB, 500 MB held by Windows), the design's PC; `loaded` = what llama.cpp holds for Testimus
function rtx4070(loaded: PackVariant | null = null): MachineProfile {
  const held = loaded
    ? [
        { name: loaded.embedding, sizeMB: 4460, vramMB: 6131, runtime: "llamacpp" as const },
        ...(loaded.reranker
          ? [{ name: loaded.reranker, sizeMB: 4081, vramMB: 5593, runtime: "llamacpp" as const }]
          : []),
      ]
    : [];
  const base = mockMachine("gpu16", held);
  return {
    ...base,
    gpus: [
      {
        ...base.gpus[0],
        name: "NVIDIA GeForce RTX 4070",
        vramTotalMB: 12 * GB,
        vramUsedMB: 500 + held.reduce((a, l) => a + l.vramMB, 0),
      },
    ],
  };
}

let dir: string;
function install(...ids: string[]) {
  writeRegistry({
    ...readRegistry(),
    installs: ids.map((model) => {
      const path = join(dir, model);
      mkdirSync(path, { recursive: true });
      return { model, via: "path" as const, runtime: "llamacpp" as const, path, status: "verified" as const };
    }),
  });
}

async function rows(machine: MachineProfile, ctx: PackContext | null): Promise<Record<string, PackRow>> {
  pinMachineProfile(machine);
  const all = await packRows(ctx, "task", { machine: async () => machine }, undefined, [], []);
  return Object.fromEntries(all.map((r) => [r.id, r]));
}

const using = (pack: string, variant: PackVariant): PackContext => ({
  chosen: { pack, variant },
  using: { pack, variant },
  reference: null,
});

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  rmSync(journalFile(), { force: true });
  dir = mkdtempSync(join(tmpdir(), "testimus-notes-"));
});
afterEach(() => pinMachineProfile(null));

describe("pack notes: one true sentence each, from one place in the core", () => {
  it("the variant in use is never called too big, even when its own load fills the GPU", async () => {
    install(...Object.values(Q8_4), "bge-m3-q8");
    const q = (await rows(rtx4070(Q8_4), using("quality", Q8_4))).quality;
    expect(q).toMatchObject({ active: true, variant: 0, installed: "all", device: "gpu" });
    expect(q.notes.join(" ")).not.toMatch(new RegExp(`« ${variantName(Q8_4)} » not chosen`));
    expect(q.notes[0]).toBe("Chosen here: already on this PC, and it fits without the margin.");
    expect(q.fit?.verdict).toBe("tight");
    expect(q.notes).toContain(q.fit?.message);
  });

  it("other programs fill the GPU after the pack was chosen: the variant in use stays, its fit says it is tight", async () => {
    install(...Object.values(Q8_4), "bge-m3-q8");
    const busy = rtx4070(Q8_4);
    busy.gpus[0].vramUsedMB = (busy.gpus[0].vramUsedMB ?? 0) + 1500;
    const q = (await rows(busy, using("quality", Q8_4))).quality;
    expect(q).toMatchObject({ active: true, variant: 0, installed: "all" });
    expect(q.notes).toEqual(["In use here: the variant set up when the pack was chosen.", q.fit?.message]);
    expect(q.fit?.message).toMatch(/^Tight: Qwen3 Embedding 8B .* need about 11\.4 GB/);
  });

  it("a model in use with a bigger variant left aside: the one reason, with the numbers", async () => {
    install(...Object.values(Q4_4), "bge-m3-q8");
    const r = await rows(rtx4070(Q4_4), using("quality", Q4_4));
    expect(r.quality).toMatchObject({ active: true, variant: 1, installed: "all" });
    expect(r.quality.notes).toEqual([
      "Chosen here: the first variant that fits (12.0 GB GPU).",
      `Variant « ${variantName(Q8_4)} » not chosen: needs 11.4 GB of GPU memory, 9.8 GB usable now.`,
    ]);
    expect(r.light.notes).toEqual(["Installed, not in use: the Quality pack does not need it."]);
  });

  it("Quality on a PC without BGE-M3: nothing asks for BGE-M3, Light only says what it would take", async () => {
    install(...Object.values(Q8_4));
    const r = await rows(mockMachine("gpu16"), using("quality", Q8_4));
    expect(r.quality).toMatchObject({ active: true, installed: "all", downloadMB: 0 });
    expect(r.quality.notes).toEqual(["Chosen here: the first variant that fits (16.0 GB GPU)."]);
    expect(r.light).toMatchObject({ active: false, chosen: false, installed: "none" });
    expect(r.light.notes).toEqual(["Fits this PC · 560 MB to download."]);
  });

  it("the team reference installed but not in use says why it is kept", async () => {
    install(...Object.values(Q8_4), "bge-m3-q8");
    const r = await rows(mockMachine("gpu16"), { ...using("quality", Q8_4), reference: { pack: "light" } });
    expect(r.light.notes).toEqual(["Kept as the team reference; the Quality pack does not need it."]);
  });

  it("chosen here but not on this PC: what is left, and what search uses meanwhile", async () => {
    install("bge-m3-q8");
    const r = await rows(mockMachine("gpu16"), {
      chosen: { pack: "quality", variant: Q8_4 },
      using: { pack: "light", variant: LIGHT },
      reference: null,
    });
    expect(r.quality).toMatchObject({ active: false, chosen: true, installed: "none" });
    expect(r.quality.notes).toEqual([
      "Chosen here: the first variant that fits (16.0 GB GPU).",
      "Fits this PC · 8.3 GB to download.",
      "Chosen for this project, not on this PC yet: search uses the Light pack meanwhile.",
    ]);
    expect(r.light.active).toBe(true);
  });

  it("a pack that cannot be installed: downloads off and nothing here", async () => {
    writeSettings({ ...readSettings(), models: { allowRemote: false } });
    const r = await rows(mockMachine("gpu16"), null);
    expect(r.light).toMatchObject({ available: false, models: [], device: null });
    expect(r.light.notes).toEqual([
      "Not available on this PC: BGE-M3 (8-bit, CPU) is not on this PC and downloads are off (allowRemote = false).",
    ]);
    expect(r.quality.notes[0]).toBe("Not available on this PC.");
    expect(r.quality.notes[1]).toBe(
      `Variant « ${variantName(Q8_4)} »: Qwen3 Embedding 8B (4-bit) is not on this PC and downloads are off (allowRemote = false).`,
    );
  });

  it("a Mac: no runtime for llama.cpp, the processor variant otherwise", async () => {
    const r = await rows(mockMachine("mac"), null);
    expect(r.quality).toMatchObject({ available: false });
    expect(r.quality.notes).toEqual([
      "Not available on this PC: no runtime here: runs on llama.cpp, which Testimus ships for Windows only.",
    ]);
    expect(r.performance).toMatchObject({ available: true, variant: 1, device: "cpu" });
    expect(r.performance.notes[1]).toBe(
      "Variant « Qwen3 Embedding 0.6B (16-bit, DirectML) » not chosen: no runtime here: is made for DirectML, which exists only on Windows.",
    );
  });

  it("a PC with no GPU: a GPU pack on the processor says so", async () => {
    const r = await rows(mockMachine("cpu-only"), null);
    expect(r.light).toMatchObject({ available: true, device: "cpu", processorOnly: false });
    expect(r.performance.processorOnly).toBe(true);
    expect(r.performance.notes).toContain("Made for a GPU: here it runs on the processor, several times slower.");
    for (const p of Object.values(r)) for (const n of p.notes) expect(n).not.toMatch(/skipped/i);
  });
});
