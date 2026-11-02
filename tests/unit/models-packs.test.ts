import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { modelsDeps } from "../../src/core/commands/models.ts";
import { catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { downloadDeps } from "../../src/core/lib/models-download.ts";
import { pinMachineProfile } from "../../src/core/lib/models-hardware.ts";
import { packRows, suggestPack } from "../../src/core/lib/models-packs.ts";
import { journalFile, recordPerf } from "../../src/core/lib/models-perf.ts";
import { readRegistry, writeRegistry } from "../../src/core/lib/models-registry.ts";
import { resolveInstalled } from "../../src/core/lib/models-resolve.ts";
import { DEFAULT_PROJECT, readProject, readSettings, settingsFile, writeProject } from "../../src/core/lib/project.ts";
import type { ActiveChoice, CatalogEntry, MachineProfile, PerfLine, RagChoice } from "../../src/core/types.ts";

const devPc: MachineProfile = {
  at: "2026-11-02T10:00:00.000Z",
  ramTotalMB: 65000,
  ramFreeMB: 40000,
  cpu: { model: "Intel Core Ultra 9 285K", threads: 24 },
  gpus: [
    {
      name: "NVIDIA GeForce RTX 5080",
      vendor: "nvidia",
      driver: "591.44",
      vramTotalMB: 16303,
      vramUsedMB: 2490,
      source: "nvidia-smi",
    },
  ],
  drives: [],
  loaded: [],
};
const cpuLaptop: MachineProfile = { ...devPc, gpus: [], ramTotalMB: 16000, ramFreeMB: 8000 };
const amdPc: MachineProfile = {
  ...devPc,
  gpus: [{ name: "AMD Radeon 780M", vendor: "amd", vramTotalMB: null, vramUsedMB: null, source: "wmi" }],
};

const saved = { ...modelsDeps };
const savedDl = { ...downloadDeps };
let active: ActiveChoice | RagChoice | null = null;
let set: (ActiveChoice | RagChoice)[] = [];
let indexed: string[] = [];
let project: string;

beforeEach(() => {
  rmSync(registryFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  rmSync(journalFile(), { force: true });
  project = mkdtempSync(join(tmpdir(), "testimus-packs-"));
  writeProject(project, DEFAULT_PROJECT);
  pinMachineProfile(devPc);
  active = null;
  set = [];
  indexed = [];
  modelsDeps.activeChoice = async () => active as ActiveChoice | null;
  modelsDeps.setActiveChoice = async (_p, c) => {
    set.push(c);
    active = c;
  };
  modelsDeps.queryTask = async () => "task";
  modelsDeps.startIndex = async (p) => {
    indexed.push(p);
    return "rag-index-fake";
  };
  modelsDeps.activeModels = async () => {
    const c = active;
    const v = c && "variant" in c && c.variant ? c.variant : c && "embedding" in c ? c : null;
    const embedding = v ? resolveInstalled(v.embedding) : null;
    return {
      embedding,
      reranker: v?.reranker ? resolveInstalled(v.reranker) : null,
      choice: c as ActiveChoice | null,
      source: "machine" as const,
      missing: [],
    };
  };
  downloadDeps.fetch = async () => new Response("nope", { status: 404 });
});
afterEach(() => {
  Object.assign(modelsDeps, saved);
  Object.assign(downloadDeps, savedDl);
  pinMachineProfile(null);
});

describe("pack cards (models.packs)", () => {
  it("each pack with the variant it resolves to here, why the ones above were skipped, what is left to download", async () => {
    const rows = await packRows(null, "task", { machine: async () => devPc });
    expect(rows.map((r) => [r.id, r.variant, r.available])).toEqual([
      ["light", 0, true],
      ["performance", 0, true],
      ["balanced", 0, true],
      ["quality", 0, true],
    ]);
    const q = rows[3];
    expect(q.skipped).toEqual([]);
    expect(q.downloadMB).toBe(
      (catalogEntry("qwen3-embedding-8b-q4") as CatalogEntry).size.downloadMB +
        (catalogEntry("qwen3-reranker-4b-q8") as CatalogEntry).size.downloadMB,
    );
    expect(q.quality).toBe("quality not measured yet");
    const busy: MachineProfile = { ...devPc, gpus: [{ ...devPc.gpus[0], vramUsedMB: 6000 }] };
    const qb = (await packRows(null, "task", { machine: async () => busy }))[3];
    expect([qb.variant, qb.available]).toEqual([1, true]);
    expect(qb.skipped[0]).toMatch(/10\.3 GB needed, 8\.6 GB usable/);
    expect(qb.downloadMB).toBe(
      (catalogEntry("qwen3-embedding-8b-q4") as CatalogEntry).size.downloadMB +
        (catalogEntry("qwen3-reranker-0.6b-q8") as CatalogEntry).size.downloadMB,
    );
    const marked = await packRows({ pack: "light" }, "task", { machine: async () => devPc });
    expect(marked.filter((r) => r.active).map((r) => r.id)).toEqual(["light"]);
  });

  it("the command answers for the open project", async () => {
    const rows = (await invoke("models.packs", {}, { project })) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["light", "performance", "balanced", "quality"]);
  });
});

describe("first launch (decision 11)", () => {
  it("suggests the pack that fits best; Light when the hardware is unknown", () => {
    expect(suggestPack(devPc)).toBe("quality");
    expect(suggestPack(cpuLaptop)).toBe("performance");
    expect(suggestPack(amdPc)).toBe("performance");
    expect(suggestPack(null)).toBe("light");
    expect(suggestPack({ ...cpuLaptop, ramTotalMB: 1500, ramFreeMB: 1000 })).toBe("light");
  });
});

describe("models.usePack", () => {
  it("--dry-run is the plan: downloads, where, reindex, expected speed", async () => {
    const r = (await invoke("models.usePack", { pack: "quality", dryRun: true }, { project })) as {
      variant: number;
      plan: { download: { model: string; sizeMB: number }[]; dir: string | null; reindex: boolean; expected: string };
      jobIds: string[];
    };
    expect(r.variant).toBe(0);
    expect(r.plan.download.map((d) => d.model).sort()).toEqual(["qwen3-embedding-8b-q4", "qwen3-reranker-4b-q8"]);
    expect(r.plan.dir).toBeNull();
    expect(r.plan.reindex).toBe(true);
    expect(r.plan.expected).toBe("not measured on this PC yet");
    expect(r.jobIds).toEqual([]);
    expect(set).toEqual([]);
  });

  it("refuses to download before the models folder is chosen (P6)", async () => {
    await expect(invoke("models.usePack", { pack: "quality" }, { project })).rejects.toThrow(
      /Choose where models are stored/,
    );
    expect(set).toEqual([]);
  });

  it("downloads in a job, and activates only once the downloads succeed", async () => {
    const { downloadDeps } = await import("../../src/core/lib/models-download.ts");
    const realFree = downloadDeps.freeMB;
    downloadDeps.freeMB = () => 1e9;
    try {
      writeRegistry({ ...readRegistry(), dir: mkdtempSync(join(tmpdir(), "testimus-packs-dir-")) });
      const r = (await invoke("models.usePack", { pack: "quality" }, { project })) as { jobIds: string[] };
      expect(r.jobIds[0]).toMatch(/^models-usePack-/);
      const { waitJob } = await import("../../src/core/jobs.ts");
      await expect(waitJob(r.jobIds[0])).rejects.toThrow(/HTTP 404/);
      expect(set).toEqual([]);
    } finally {
      downloadDeps.freeMB = realFree;
    }
  });

  it("nothing to download: activates the variant for this PC, sets the reference if asked, starts the index", async () => {
    const light = resolveInstalled("bge-m3-q8");
    if (!light) {
      const dir = mkdtempSync(join(tmpdir(), "testimus-packs-m-"));
      writeRegistry({
        ...readRegistry(),
        installs: [{ model: "bge-m3-q8", via: "path", runtime: "transformers", path: dir, status: "verified" }],
      });
    }
    const r = (await invoke("models.usePack", { pack: "light", reference: true }, { project })) as { jobIds: string[] };
    expect(set).toEqual([{ pack: "light", variant: { embedding: "bge-m3-q8", reranker: null } }]);
    expect(readProject(project).rag.reference).toEqual({ pack: "light" });
    expect(r.jobIds).toEqual(["rag-index-fake"]);
    expect(indexed).toEqual([project]);
    const again = (await invoke("models.usePack", { pack: "light" }, { project })) as {
      plan: { reindex: boolean };
      jobIds: string[];
    };
    expect(again.plan.reindex).toBe(false);
    expect(again.jobIds).toEqual([]);
  });

  it("a pack with no variant that fits here is refused with the reason", async () => {
    pinMachineProfile({ ...cpuLaptop, ramTotalMB: 2000, ramFreeMB: 1500 });
    await expect(invoke("models.usePack", { pack: "quality" }, { project })).rejects.toThrow(
      /not available on this PC: .*ram-too-small/,
    );
  });
});

describe("models.use (Custom)", () => {
  function installAt(id: string) {
    const dir = mkdtempSync(join(tmpdir(), "testimus-use-"));
    writeRegistry({
      ...readRegistry(),
      installs: [
        ...readRegistry().installs,
        { model: id, via: "path", runtime: "llamacpp", path: dir, status: "verified" },
      ],
    });
  }

  it("activates a hand-picked pair that is installed, with its fit; reindex follows a new embedding", async () => {
    installAt("qwen3-embedding-4b-q8");
    installAt("qwen3-reranker-0.6b-q8");
    const r = (await invoke(
      "models.use",
      { embedding: "qwen3-embedding-4b-q8", reranker: "qwen3-reranker-0.6b-q8" },
      { project },
    )) as { fit: { verdict: string }; reindex: boolean };
    expect(r.fit.verdict).toBe("fits");
    expect(r.reindex).toBe(true);
    expect(set).toEqual([{ embedding: "qwen3-embedding-4b-q8", reranker: "qwen3-reranker-0.6b-q8" }]);
    expect(indexed).toEqual([project]);
    const rr = (await invoke("models.use", { reranker: null }, { project })) as { reindex: boolean; choice: unknown };
    expect(rr).toMatchObject({ reindex: false, choice: { embedding: "qwen3-embedding-4b-q8", reranker: null } });
  });

  it("refuses what is not here yet, and what does not fit in RAM", async () => {
    await expect(
      invoke("models.use", { embedding: "qwen3-embedding-8b-q8", reranker: null }, { project }),
    ).rejects.toThrow(/Not on this PC yet: qwen3-embedding-8b-q8/);
    pinMachineProfile({ ...cpuLaptop, ramTotalMB: 2000, ramFreeMB: 1500 });
    await expect(
      invoke("models.use", { embedding: "qwen3-embedding-8b-q8", reranker: null }, { project }),
    ).rejects.toThrow(/of memory; this PC has/);
    await expect(invoke("models.use", { embedding: "bge-reranker-v2-m3-q8" }, { project })).rejects.toThrow(
      /not an embedding/,
    );
  });
});

describe("models.advice and models.dismiss", () => {
  it("returns the current suggestion; a dismissed one stays hidden until the numbers move", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-adv-"));
    writeRegistry({
      ...readRegistry(),
      installs: [{ model: "qwen3-embedding-8b-q8", via: "path", runtime: "llamacpp", path: dir, status: "verified" }],
    });
    active = { embedding: "qwen3-embedding-8b-q8", reranker: null };
    for (let i = 0; i < 10; i++)
      recordPerf({
        at: new Date().toISOString(),
        op: "embed.query",
        model: "qwen3-embedding-8b-q8",
        items: 1,
        ms: 2000,
      });
    const advice = (await invoke("models.advice", {}, { project })) as { id: string; to: unknown; reason: string }[];
    expect(advice).toHaveLength(1);
    expect(advice[0].to).toEqual({ embedding: "qwen3-embedding-8b-q4", reranker: null });
    expect(advice[0]).not.toHaveProperty("metric");
    await invoke("models.dismiss", { id: advice[0].id }, { project });
    expect(readSettings().rag?.dismissed?.[advice[0].id]).toBe("2000");
    expect(await invoke("models.advice", {}, { project })).toEqual([]);
    await expect(invoke("models.dismiss", { id: "nope" }, { project })).rejects.toThrow(/No current advice/);
  });
});

function writeReport(
  dir: string,
  name: string,
  embedding: string,
  reranker: string | null,
  recall: number,
  provisional: boolean,
) {
  const totals = { n: 4, atK: { "10": { recall, complete: 0, precision: 0, chars: 0 } } };
  mkdirSync(join(dir, ".testimus", "eval"), { recursive: true });
  writeFileSync(
    join(dir, ".testimus", "eval", name),
    JSON.stringify({
      version: 2,
      setting: `${embedding}-hybrid`,
      provisional,
      config: { embedding, reranker, mode: "hybrid", space: null, ks: [10], set: { hash: "s" }, corpus: "c" },
      policies: [{ name: "search", available: true, totals }],
      behaviors: [],
      report: name,
    }),
  );
}

describe("pack cards: speed from the journal, quality from the benchmark (N-perf)", () => {
  const at = new Date().toISOString();
  const deps = (lines: PerfLine[] = []) => ({ machine: async () => devPc, lines });

  it("speed: query, rerank and index throughput measured on this PC for the variant's models", async () => {
    const lines: PerfLine[] = [
      ...Array.from({ length: 5 }, () => ({
        at,
        op: "embed.query" as const,
        model: "bge-m3-q8",
        device: "cpu" as const,
        items: 1,
        ms: 40,
      })),
      { at, op: "embed.index", model: "bge-m3-q8", device: "cpu", items: 120, ms: 1000 },
      { at, op: "embed.query", model: "qwen3-embedding-4b-q4", device: "gpu", items: 1, ms: 30 },
      { at, op: "rerank", model: "qwen3-reranker-0.6b-q8", device: "gpu", items: 30, ms: 25 },
    ];
    const rows = await packRows(null, "task", deps(lines));
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by("light")?.speed).toBe("on this PC: query 40 ms, index 120 passages/s");
    expect(by("balanced")?.speed).toBe("on this PC: query 30 ms, rerank 25 ms");
    expect(by("performance")?.speed).toBeUndefined();
  });

  it("quality: evidence recall measured on this project for the variant, provisional when the set is", async () => {
    writeReport(project, "light.json", "bge-m3-q8", null, 0.625, true);
    writeReport(project, "balanced.json", "qwen3-embedding-4b-q4", "qwen3-reranker-0.6b-q8", 0.8, false);
    const rows = await packRows(null, "task", deps(), project);
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by("light")?.quality).toBe("evidence recall 62.5 % on this project (recall@10, 4 behaviors, provisional)");
    expect(by("balanced")?.quality).toBe("evidence recall 80 % on this project (recall@10, 4 behaviors)");
    expect(by("quality")?.quality).toBe("quality not measured yet");
    const viaCommand = (await invoke("models.packs", {}, { project })) as { id: string; quality: string }[];
    expect(viaCommand.find((r) => r.id === "light")?.quality).toMatch(/^evidence recall 62\.5 % .*provisional\)$/);
  });
});
