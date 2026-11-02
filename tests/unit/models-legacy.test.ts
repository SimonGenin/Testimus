import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { pinMachineProfile } from "../../src/core/lib/models-hardware.ts";
import { readRegistry, updateRegistry } from "../../src/core/lib/models-registry.ts";
import { ggufPath, resolveChoice } from "../../src/core/lib/models-resolve.ts";
import { readSettings, settingsFile } from "../../src/core/lib/project.ts";
import type { CatalogEntry, MachineProfile } from "../../src/core/types.ts";

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB: 16303, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
};

const writeRaw = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};

let gguf = "";
beforeEach(() => {
  pinMachineProfile(devPc);
  const root = mkdtempSync(join(tmpdir(), "testimus-legacy-"));
  gguf = ggufPath(root, catalogEntry("qwen3-embedding-0.6b-q8") as CatalogEntry) as string;
  mkdirSync(dirname(gguf), { recursive: true });
  writeFileSync(gguf, "gguf");
  writeRaw(settingsFile(), {
    projects: [],
    lastProject: "",
    theme: "system",
    stepLayout: "stacked",
    claude: { exe: "claude" },
    models: { allowRemote: true, useOllama: "auto" },
  });
  writeRaw(registryFile(), {
    allowRemote: true,
    ollama: { enabled: true, host: "http://127.0.0.1:11434" },
    installs: [
      {
        model: "qwen3-embedding-4b-q4",
        via: "ollama",
        runtime: "ollama",
        ollama: "qwen3-embedding:4b",
        digest: "sha256:abc",
        status: "installed",
      },
      { model: "qwen3-embedding-0.6b-q8", via: "path", runtime: "llamacpp", path: gguf, status: "verified" },
    ],
  });
});
afterEach(() => {
  pinMachineProfile(null);
  rmSync(registryFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  vi.restoreAllMocks();
});

describe("models.json and settings.json written when Testimus still used Ollama (D-12)", () => {
  it("read without error: the Ollama block and installation are dropped, said once on stderr", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(readSettings().models.allowRemote).toBe(true);
    const r = readRegistry();
    expect(r).not.toHaveProperty("ollama");
    expect(r.installs).toEqual([expect.objectContaining({ model: "qwen3-embedding-0.6b-q8", via: "path" })]);
    readRegistry();
    const warned = err.mock.calls.map((c) => String(c[0])).filter((t) => /through Ollama; ignored/.test(t));
    expect(warned).toHaveLength(1);

    const list = (await invoke("models.list", {}, { project: null })) as { model: string; via: string }[];
    expect(list.map((l) => `${l.model}:${l.via}`)).toContain("qwen3-embedding-0.6b-q8:path");
    expect(list.map((l) => l.model)).not.toContain("qwen3-embedding-4b-q4");

    const old = await resolveChoice({ embedding: "qwen3-embedding-4b-q4", reranker: null }, "task", {
      machine: async () => devPc,
    });
    expect(old.sources).toEqual({ "qwen3-embedding-4b-q4": "download" });
    const kept = await resolveChoice({ embedding: "qwen3-embedding-0.6b-q8", reranker: null }, "task", {
      machine: async () => devPc,
    });
    expect(kept.sources).toEqual({ "qwen3-embedding-0.6b-q8": "registered" });
    expect(kept.embedding).toMatchObject({ runtime: "llamacpp", install: { path: gguf } });
  });

  it("the next write leaves no Ollama key behind", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    updateRegistry(() => {});
    expect(readFileSync(registryFile(), "utf8")).not.toMatch(/ollama/i);
  });
});
