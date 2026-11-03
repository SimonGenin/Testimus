import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogEntry, registryFile, SHIPPED } from "../../../../src/core/lib/models-catalog.ts";
import { fitOf, worst } from "../../../../src/core/lib/models-fit.ts";
import { pinMachineProfile } from "../../../../src/core/lib/models-hardware.ts";
import { downloadMBOf, packRows, planOf } from "../../../../src/core/lib/models-packs.ts";
import { adviceQuality, evalReports, type Measured, measuredRecall } from "../../../../src/core/lib/models-quality.ts";
import { readRegistry, writeRegistry } from "../../../../src/core/lib/models-registry.ts";
import {
  downloadRuntime,
  ggufPath,
  type Resolution,
  resolveChoice,
  resolveInstalled,
} from "../../../../src/core/lib/models-resolve.ts";
import type { EvalReport } from "../../../../src/core/rag/eval.ts";
import type { CatalogEntry, MachineProfile } from "../../../../src/core/types.ts";

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "cpu", threads: 24 },
  gpus: [{ name: "RTX 5080", vendor: "nvidia", vramTotalMB: 16303, vramUsedMB: 2490, source: "nvidia-smi" }],
  drives: [],
  loaded: [],
};
const entry = (id: string) => catalogEntry(id) as CatalogEntry;
const own = (id: string, over: Partial<CatalogEntry>): CatalogEntry => ({
  ...entry("bge-m3-q8"),
  id,
  label: id,
  ...over,
});

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  pinMachineProfile(null);
});
afterEach(() => {
  rmSync(registryFile(), { force: true });
  pinMachineProfile(null);
  vi.unstubAllEnvs();
});

describe("fit", () => {
  it("worst keeps the worse verdict either way; an empty pair is « nothing »", () => {
    expect(worst("fits", "tight")).toBe("tight");
    expect(worst("ram-too-small", "fits")).toBe("ram-too-small");
    expect(fitOf([], devPc, { headroom: 0.15 }).message).toMatch(/nothing/);
  });

  it("a GPU without a used-memory figure says so", () => {
    const m = { ...devPc, gpus: [{ ...devPc.gpus[0], vramUsedMB: null }] };
    expect(fitOf([entry("qwen3-embedding-0.6b-q8")], m, { headroom: 0.15 }).message).toMatch(
      /free memory not measured/,
    );
  });

  it("an unknown VRAM size with tight memory on the processor is tight", () => {
    const m: MachineProfile = { ...devPc, ramFreeMB: 600, gpus: [{ ...devPc.gpus[0], vramTotalMB: null }] };
    const f = fitOf([entry("qwen3-embedding-0.6b-q8"), entry("bge-reranker-v2-m3-q8")], m, { headroom: 0.15 });
    expect(f.verdict).toBe("tight");
    expect(f.message).toMatch(/On the processor side/);
  });

  it("a GPU fit with tight memory on the processor keeps the processor note", () => {
    const m: MachineProfile = { ...devPc, ramFreeMB: 600 };
    const f = fitOf([entry("qwen3-embedding-0.6b-q8"), entry("bge-reranker-v2-m3-q8")], m, { headroom: 0.15 });
    expect(f.message).toMatch(/^Fits: .* On the processor side, /);
  });

  it("another program's model the catalog does not know is named as loaded", () => {
    const big = entry("qwen3-embedding-8b-q8");
    const need = big.size.vramMB;
    const m: MachineProfile = {
      ...devPc,
      gpus: [{ ...devPc.gpus[0], vramTotalMB: need + 2000, vramUsedMB: 1900 }],
      loaded: [{ name: "someone-else.gguf", sizeMB: 1800, vramMB: 1800, runtime: "llamacpp" }],
    };
    const f = fitOf([big], m, { headroom: 0.15 });
    expect(f.verdict).toBe("tight");
    expect(f.message).toMatch(/llama\.cpp holds someone-else\.gguf/);
  });
});

describe("packs", () => {
  const res = (over: Partial<Resolution>): Resolution => ({
    choice: { pack: "light" },
    variant: null,
    variantIndex: null,
    embedding: null,
    reranker: null,
    skipped: [],
    missing: [],
    ...over,
  });

  it("a missing model unknown to the catalog weighs nothing", () => {
    expect(downloadMBOf(res({ missing: ["nope"] }))).toBe(0);
    expect(planOf(res({ missing: ["nope"] }), null)).toMatchObject({
      download: [{ model: "nope", sizeMB: 0 }],
      reindex: true,
      expected: "not measured on this PC yet",
    });
  });

  it("the same hand-picked models need no reindex", () => {
    const variant = { embedding: "bge-m3-q8", reranker: null };
    expect(planOf(res({ variant }), { embedding: "bge-m3-q8", reranker: null }).reindex).toBe(false);
    expect(planOf(res({ variant }), { embedding: "other", reranker: null }).reindex).toBe(true);
  });

  it("rows of a hand-picked choice mark no pack active", async () => {
    pinMachineProfile(devPc);
    const rows = await packRows({ embedding: "bge-m3-q8", reranker: null }, undefined, {}, undefined, []);
    expect(rows.every((r) => !r.active)).toBe(true);
  });
});

describe("quality", () => {
  const report = (embedding: string, behaviors: string[], totals = true): EvalReport =>
    ({
      version: 2,
      setting: `${embedding}-hybrid`,
      provisional: false,
      report: `${embedding}.json`,
      config: { embedding, reranker: null, mode: "hybrid", space: null, ks: [10], set: { hash: "s" }, corpus: "c" },
      policies: [
        {
          name: "search",
          available: true,
          ...(totals ? { totals: { n: 1, atK: { "10": { recall: 1, complete: 0, precision: 0, chars: 0 } } } } : {}),
        },
      ],
      behaviors: behaviors.map((id) => ({ id, policies: { search: { atK: { "10": { recall: 1 } }, roles: {} } } })),
    }) as unknown as EvalReport;
  const m = (r: EvalReport, file: string): Measured => ({ file, report: r, mtime: 0 });

  it("skips files that are not JSON in the eval folder", () => {
    const project = mkdtempSync(join(tmpdir(), "testimus-cov-quality-"));
    mkdirSync(join(project, ".testimus", "eval"), { recursive: true });
    writeFileSync(join(project, ".testimus", "eval", "notes.txt"), "x");
    writeFileSync(join(project, ".testimus", "eval", "a.json"), JSON.stringify(report("e1", ["b"])));
    expect(evalReports(project).map((x) => x.report.config.embedding)).toEqual(["e1"]);
  });

  it("a report without totals at 10 has no recall", () => {
    expect(measuredRecall({ embedding: "e1", reranker: null }, [m(report("e1", ["b"], false), "a")])).toBeNull();
  });

  it("reports that share no behavior, or one report for both sides, cannot be paired", () => {
    const a = m(report("e1", ["b1"]), "a");
    const b = m(report("e2", ["b2"]), "b");
    expect(adviceQuality({ embedding: "e1", reranker: null }, { embedding: "e2", reranker: null }, [a, b])).toMatch(
      /could not be paired/,
    );
    expect(adviceQuality({ embedding: "e1", reranker: null }, { embedding: "e1", reranker: null }, [a])).toMatch(
      /could not be paired/,
    );
  });
});

describe("resolve", () => {
  it("unknown ids, entries without a hub source and runtimes Testimus cannot download", async () => {
    const nohf = own("own-nohf", { source: {} });
    const odd = own("own-odd", { runtimes: ["mock"] });
    writeRegistry({ ...readRegistry(), catalog: [nohf, odd] });
    expect(resolveInstalled("nope")).toBeNull();
    expect(resolveInstalled("own-nohf")).toBeNull();
    expect(resolveInstalled("own-odd")).toBeNull();
    expect(downloadRuntime(odd)).toBeNull();
    expect(ggufPath("D:\\m", nohf)).toBeNull();
    const r = await resolveChoice({ embedding: "nope", reranker: "own-nohf" });
    expect(r.reasons).toMatchObject({
      nope: "nope is not in the catalog",
      "own-nohf": "own-nohf has no download source",
    });
    const unknownPack = await resolveChoice({ pack: "nope" }, undefined, { machine: async () => devPc });
    expect(unknownPack).toMatchObject({ variant: null, fit: null, skipped: [] });
  });

  it("a llama.cpp install keeps its own device when no machine is known", () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-cov-resolve-"));
    const file = join(dir, "m.gguf");
    writeFileSync(file, "");
    writeRegistry({
      ...readRegistry(),
      installs: [
        { model: "qwen3-embedding-0.6b-q8", via: "path", runtime: "llamacpp", path: file, status: "installed" },
        {
          model: "qwen3-embedding-4b-q8",
          via: "path",
          runtime: "llamacpp",
          path: file,
          device: "gpu",
          status: "installed",
        },
      ],
    });
    expect(resolveInstalled("qwen3-embedding-0.6b-q8")?.device).toBe("cpu");
    expect(resolveInstalled("qwen3-embedding-4b-q8")?.device).toBe("gpu");
  });

  it("a transformers model complete on disk without the pinned files has no revision", () => {
    vi.stubEnv("TESTIMUS_MODELS", "");
    const root = mkdtempSync(join(tmpdir(), "testimus-cov-resolve-tf-"));
    const base = entry("bge-m3-q8");
    const hf = base.source.hf as NonNullable<CatalogEntry["source"]["hf"]>;
    const e = own("own-bge", { source: { ...base.source, hf: { ...hf, repo: "own/bge-copy" } } });
    const dir = join(root, "own", "bge-copy");
    mkdirSync(join(dir, "onnx"), { recursive: true });
    writeFileSync(join(dir, "config.json"), "{}");
    writeFileSync(join(dir, "tokenizer.json"), "{}");
    writeFileSync(join(dir, "onnx", "model_quantized.onnx"), "");
    writeRegistry({ ...readRegistry(), dir: root, catalog: [e] });
    const r = resolveInstalled("own-bge");
    expect(r?.install.path).toBe(dir);
    expect(r?.install.revision).toBeUndefined();
  });

  it("the reasons of a skipped variant: GPU too small, free memory unknown", async () => {
    const small: MachineProfile = { ...devPc, gpus: [{ ...devPc.gpus[0], vramTotalMB: 2000, vramUsedMB: 100 }] };
    const r = await resolveChoice({ pack: "quality" }, undefined, { machine: async () => small });
    expect(r.skipped.join(" | ")).toMatch(/GB on the GPU \(gpu-too-small\)/);
    const blind: MachineProfile = { ...devPc, ramFreeMB: 600, gpus: [{ ...devPc.gpus[0], vramTotalMB: null }] };
    const b = await resolveChoice({ pack: "balanced" }, undefined, { machine: async () => blind });
    expect(b.skipped.join(" | ")).toMatch(/free memory unknown|cannot check the GPU/);
  });

  it("the shipped catalog is what the registry adds to", () => {
    expect(SHIPPED.entries.length).toBeGreaterThan(0);
  });
});
