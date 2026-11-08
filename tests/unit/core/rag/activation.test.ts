import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { modelDeps, modelRows } from "../../../../src/core/lib/doctor-models.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { readProject, readSettings, writeProject } from "../../../../src/core/lib/project.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import {
  activeChoice,
  activeModels,
  projectKey,
  resolveModel,
  setActiveChoice,
} from "../../../../src/core/rag/activation.ts";
import { fingerprintOf } from "../../../../src/core/rag/fingerprint.ts";
import type { RagChoice } from "../../../../src/core/types.ts";

const installed = vi.hoisted(() => new Set<string>());

vi.mock("../../../../src/core/lib/models-resolve.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/models-resolve.ts")>();
  const { catalogEntry } = await import("../../../../src/core/lib/models-catalog.ts");
  const resolveInstalled = (id: string, queryTask = real.DEFAULT_QUERY_TASK) => {
    const entry = catalogEntry(id);
    if (!entry || !installed.has(entry.id)) return null;
    const runtime = entry.runtimes[0];
    return {
      entry,
      install: { model: entry.id, via: "path", runtime, path: `D:/models/${entry.id}`, status: "installed" },
      runtime,
      device: "cpu",
      dtype: entry.dtypeByDevice?.cpu,
      queryTask,
    };
  };
  return {
    ...real,
    resolveInstalled,
    resolveChoice: async (choice: unknown) => ({
      choice,
      variant: null,
      variantIndex: null,
      embedding: null,
      reranker: null,
      aside: [],
      picked: null,
      missing: [],
    }),
  };
});

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let root: string;
let dir: string;

function project(rag: Record<string, unknown>) {
  const p = readProject(dir);
  writeProject(dir, { ...p, rag: { ...p.rag, ...rag } as typeof p.rag });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-activation-"));
  dir = join(root, "Projet");
  cpSync(FIXTURE, dir, { recursive: true });
  installed.clear();
  pinMachineProfile(mockMachine("gpu16"));
});

afterEach(() => {
  setActiveChoice(dir, null);
  pinMachineProfile(null);
  env.mock = false;
  rmSync(root, { recursive: true, force: true });
});

describe("per-machine activation", () => {
  it("is keyed by the project folder's real path, whatever the spelling or link used to reach it", () => {
    const link = join(root, "lien");
    symlinkSync(dir, link, "junction");
    const choice: RagChoice = { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null };
    setActiveChoice(link, choice);
    expect(activeChoice(dir)).toEqual(choice);
    if (process.platform === "win32") expect(activeChoice(dir.toUpperCase())).toEqual(choice);
    expect(Object.keys(readSettings().rag?.byProject ?? {})).toEqual([projectKey(dir)]);
    setActiveChoice(dir, null);
    expect(activeChoice(link)).toBeNull();
  });

  it("falls back from this PC's choice to the reference, the Light pack, then BM25 only", async () => {
    project({ reference: { pack: "performance" } });
    setActiveChoice(dir, { embedding: "qwen3-embedding-4b-q8", reranker: null });

    installed.add("qwen3-embedding-4b-q8");
    expect(await activeModels(dir)).toMatchObject({ source: "machine", embedding: { runtime: "llamacpp" } });

    installed.clear();
    installed.add("qwen3-embedding-0.6b-onnx-fp16");
    const ref = await activeModels(dir);
    expect(ref).toMatchObject({
      source: "reference",
      choice: { pack: "performance", variant: { embedding: "qwen3-embedding-0.6b-onnx-fp16" } },
      pack: { id: "performance" },
    });
    expect(ref.embedding?.entry.id).toBe("qwen3-embedding-0.6b-onnx-fp16");
    expect(ref.missing).toEqual(["qwen3-embedding-4b-q8"]);

    installed.clear();
    installed.add("qwen3-embedding-0.6b-onnx-q8");
    installed.add("bge-reranker-v2-m3-q8");
    const ref2 = await activeModels(dir);
    expect(ref2.source).toBe("reference");
    expect(ref2.choice).toMatchObject({ variant: { embedding: "qwen3-embedding-0.6b-onnx-q8" } });

    project({ reference: undefined });
    installed.clear();
    installed.add("bge-m3-q8");
    const light = await activeModels(dir);
    expect(light).toMatchObject({ source: "light", reranker: null, pack: { id: "light" } });
    expect(light.embedding?.entry.id).toBe("bge-m3-q8");

    installed.clear();
    const none = await activeModels(dir);
    expect(none).toMatchObject({ source: "none", embedding: null, reranker: null, choice: null });
    expect(none.missing).toEqual(["qwen3-embedding-4b-q8"]);
  });

  it("carries the pack's retrieval settings; a reranker not on this PC is left out and named missing", async () => {
    installed.add("qwen3-embedding-8b-q4");
    installed.add("qwen3-reranker-4b-q8");
    setActiveChoice(dir, { pack: "quality" });
    const q = await activeModels(dir);
    expect(q).toMatchObject({
      source: "machine",
      choice: { pack: "quality", variant: { embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" } },
      retrieval: { candidates: 80, rerank: { top: 40, mode: "topk" } },
    });
    expect(q.reranker?.entry.id).toBe("qwen3-reranker-4b-q8");

    installed.add("bge-m3-q8");
    setActiveChoice(dir, { embedding: "bge-m3-q8", reranker: "qwen3-reranker-0.6b-onnx-q8" });
    const absent = await activeModels(dir);
    expect(absent.embedding?.entry.id).toBe("bge-m3-q8");
    expect(absent.reranker).toBeNull();
    expect(absent.missing).toEqual(["qwen3-reranker-0.6b-onnx-q8"]);

    installed.add("qwen3-reranker-0.6b-onnx-q8");
    const yesNo = await activeModels(dir);
    expect(yesNo.reranker?.entry.id).toBe("qwen3-reranker-0.6b-onnx-q8");
    expect(yesNo.missing).toEqual([]);
  });

  it("Quality chosen here but not on this PC: search falls back to Light, and only Quality's models are asked for", async () => {
    installed.add("bge-m3-q8");
    const quality = { embedding: "qwen3-embedding-8b-q4", reranker: "qwen3-reranker-4b-q8" };
    setActiveChoice(dir, { pack: "quality", variant: quality });
    const a = await activeModels(dir);
    expect(a).toMatchObject({ source: "light", choice: { pack: "light" } });
    expect(a.embedding?.entry.id).toBe("bge-m3-q8");
    expect(a.missing).toEqual([quality.embedding, quality.reranker]);

    const wanted = await modelDeps.active(dir);
    expect(wanted.wanted.slice(0, 2)).toEqual([quality.embedding, quality.reranker]);
    const rows = await modelRows(dir, {
      ...modelDeps,
      machine: async () => mockMachine("gpu16"),
      space: async () => null,
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by["model.embedding"]).toMatchObject({
      state: "warn",
      detail: "Qwen3 Embedding 8B (4-bit) is not on this PC: search uses BGE-M3 (8-bit, CPU) meanwhile",
      action: { command: "models.pull", input: { model: quality.embedding } },
    });
    expect(by["model.reranker"]).toMatchObject({ state: "warn", action: { input: { model: quality.reranker } } });
    for (const r of rows) expect(JSON.stringify(r.action ?? {})).not.toContain("bge-m3");
  });

  it("keeps the variant chosen with the pack while its models are here, whatever a fresh resolution would pick", async () => {
    const second = { embedding: "qwen3-embedding-4b-q4", reranker: "qwen3-reranker-4b-q8" };
    installed.add(second.embedding);
    installed.add(second.reranker);
    installed.add("qwen3-embedding-8b-q4");
    setActiveChoice(dir, { pack: "quality", variant: second });
    const a = await activeModels(dir);
    expect(a).toMatchObject({ source: "machine", choice: { pack: "quality", variant: second }, missing: [] });
    expect(a.embedding?.entry.id).toBe(second.embedding);
  });

  it("fills {task} from project.json rag.queryTask, in English by default", async () => {
    installed.add("qwen3-embedding-0.6b-onnx-q8");
    project({ reference: { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null } });
    const def = fingerprintOf((await activeModels(dir)).embedding as never);
    expect(def.queryInstruction).toMatch(/^Instruct: Given a question about a railway simulator .*\nQuery: $/);
    project({ queryTask: "Étant donné une question, trouver les passages" });
    const fr = fingerprintOf((await activeModels(dir)).embedding as never);
    expect(fr.queryInstruction).toBe("Instruct: Étant donné une question, trouver les passages\nQuery: ");
  });

  it("under --mock every catalog model resolves to the mock runtime", async () => {
    env.mock = true;
    expect(resolveModel("bge-m3-q8")).toMatchObject({ runtime: "mock", entry: { id: "bge-m3-q8" } });
    expect(resolveModel("nope")).toBeNull();
    expect((await activeModels(dir)).source).toBe("light");
  });
});

describe("folder keys", () => {
  it("normalise case on Windows only and survive a missing folder", () => {
    const ghost = join(root, "Absent", "Dossier");
    mkdirSync(join(root, "Absent"));
    const key = projectKey(ghost);
    expect(key).toBe(process.platform === "win32" ? ghost.toLowerCase() : ghost);
  });
});
