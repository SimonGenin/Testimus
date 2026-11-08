import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { pinMachineProfile } from "../../../../src/core/lib/machine/profile.ts";
import { catalogEntry } from "../../../../src/core/lib/models-catalog.ts";
import { mockMachine } from "../../../../src/core/mock/machine.ts";
import { setActiveChoice } from "../../../../src/core/rag/activation.ts";
import { indexFile, listSpaces, openDb, RECIPE, spaceId } from "../../../../src/core/rag/db.ts";
import { runtimes } from "../../../../src/core/rag/embed.ts";
import { fingerprintOf, modelIdentity } from "../../../../src/core/rag/fingerprint.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import { mockRuntime } from "../../../../src/core/rag/runtimes/mock.ts";
import { batches } from "../../../../src/core/rag/runtimes/transformers.ts";
import type { Runtime } from "../../../../src/core/rag/runtimes/types.ts";
import { search } from "../../../../src/core/rag/search/hybrid.ts";
import { vector } from "../../../../src/core/rag/search/vector.ts";
import type { ResolvedModel, RuntimeId, SpaceFingerprint } from "../../../../src/core/types.ts";

const installed = vi.hoisted(() => new Set<string>());

vi.mock("../../../../src/core/lib/models-resolve.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/models-resolve.ts")>();
  const { catalogEntry } = await import("../../../../src/core/lib/models-catalog.ts");
  const resolveInstalled = (id: string, queryTask = real.DEFAULT_QUERY_TASK) => {
    const entry = catalogEntry(id);
    if (!entry || !installed.has(entry.id)) return null;
    const runtime = entry.runtimes[0];
    const dtype = entry.dtypeByDevice?.cpu;
    return {
      entry,
      install: { model: entry.id, via: "path", runtime, path: `D:/models/${entry.id}`, dtype, status: "installed" },
      runtime,
      device: "cpu",
      dtype,
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
const D4 = "SOSIE_211_D401-1_4";
const BGE = "bge-m3-q8";
const QWEN = "qwen3-embedding-0.6b-onnx-q8";
const GGUF = "qwen3-embedding-0.6b-q8";
const saved = { ...runtimes };
let dir: string;
let calls: string[];

function counting(): Runtime {
  return {
    ...mockRuntime,
    embed: async (m, texts, mode) => {
      calls.push(...texts.map(() => `${mode}:${m.runtime}:${m.entry.id}`));
      return mockRuntime.embed(m, texts, mode);
    },
  };
}

type SpaceRow = { id: string; model: string; complete: boolean; active: boolean; chunks: number };
const spaces = async () => (await invoke("rag.spaces", {}, { project: dir })) as SpaceRow[];
const use = (embedding: string | null) => setActiveChoice(dir, embedding ? { embedding, reranker: null } : null);

function resolved(id: string, patch: Partial<ResolvedModel> = {}): ResolvedModel {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(id);
  const runtime = (patch.runtime ?? entry.runtimes[0]) as RuntimeId;
  return {
    entry,
    install: { model: id, via: "path", runtime, path: "D:/a", status: "installed" },
    runtime,
    device: "cpu",
    dtype: entry.dtypeByDevice?.cpu,
    queryTask: "task A",
    ...patch,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-spaces-"));
  cpSync(FIXTURE, dir, { recursive: true });
  calls = [];
  installed.clear();
  for (const id of [BGE, QWEN, GGUF]) installed.add(id);
  runtimes.transformers = counting();
  runtimes.llamacpp = counting();
  pinMachineProfile(mockMachine("gpu16"));
});

afterEach(() => {
  Object.assign(runtimes, saved);
  pinMachineProfile(null);
  setActiveChoice(dir, null);
  rmSync(dir, { recursive: true, force: true });
});

describe("vector spaces", () => {
  it("keep two models side by side; switching back reuses the first space without re-embedding", async () => {
    const first = await indexProject(dir, quietCtx(dir));
    expect(first).toMatchObject({ embedding: BGE, embedded: 14, vectorsRebuilt: true });
    use(QWEN);
    const second = await indexProject(dir, quietCtx(dir));
    expect(second).toMatchObject({ embedding: QWEN, embedded: 14, vectorsRebuilt: true });
    expect(second.space).not.toBe(first.space);
    expect(second.docs.every((d) => d.status === "unchanged")).toBe(true);
    const listed = await spaces();
    expect(listed.map((s) => [s.model, s.complete, s.active, s.chunks]).sort()).toEqual([
      [BGE, true, false, 14],
      [QWEN, true, true, 14],
    ]);

    use(null);
    calls = [];
    const back = await indexProject(dir, quietCtx(dir));
    expect(back).toMatchObject({ embedding: BGE, embedded: 0, vectorsRebuilt: false, space: first.space });
    await search(dir, "représentation graphique du sectionneur");
    expect(calls).toEqual([`query:transformers:${BGE}`]);
  });

  it("--force re-embeds the active space only; another space keeps its vectors and stays complete", async () => {
    await indexProject(dir, quietCtx(dir));
    use(QWEN);
    const qwen = await indexProject(dir, quietCtx(dir));
    use(null);
    const forced = await indexProject(dir, quietCtx(dir), { force: true });
    expect(forced).toMatchObject({ embedding: BGE, embedded: 14, vectorsRebuilt: true });
    expect(forced.docs.every((d) => d.status === "indexed")).toBe(true);
    const listed = await spaces();
    expect(listed.find((s) => s.id === qwen.space)).toMatchObject({ model: QWEN, complete: true, chunks: 14 });
  });

  it("a changed chunk leaves inactive spaces incomplete until they are activated again", async () => {
    await indexProject(dir, quietCtx(dir));
    use(QWEN);
    await indexProject(dir, quietCtx(dir));
    const md4 = join(dir, "docs", D4, "doc.md");
    writeFileSync(md4, `${readFileSync(md4, "utf8")}\n\n## 4.3 Signal de manœuvre <!-- § 4.3 -->\n\nAutorise.\n`);
    const changed = await indexProject(dir, quietCtx(dir));
    expect(changed).toMatchObject({ embedding: QWEN, embedded: 1 });
    const after = await spaces();
    expect(after.find((s) => s.model === BGE)).toMatchObject({ complete: false, chunks: 14 });
    expect(after.find((s) => s.model === QWEN)).toMatchObject({ complete: true, chunks: 15 });

    use(null);
    const db = openDb(indexFile(dir));
    try {
      const v = await vector(db, dir, "signal", {});
      expect(v.ids).toEqual([]);
      expect(v.degraded).toMatch(/incomplete \(14\/15\)/);
    } finally {
      db.close();
    }
    calls = [];
    const again = await indexProject(dir, quietCtx(dir));
    expect(again).toMatchObject({ embedding: BGE, embedded: 1 });
    expect(calls).toEqual([`doc:transformers:${BGE}`]);
    expect((await spaces()).every((s) => s.complete)).toBe(true);
  });

  it("without an installed model: BM25 only, degraded, never an error", async () => {
    installed.clear();
    const warns: string[] = [];
    const r = await indexProject(dir, { ...quietCtx(dir), log: (_l, m) => warns.push(m) });
    expect(r).toMatchObject({ embedding: "none", dims: 0, embedded: 0, chunks: 14 });
    expect(r.degraded).toMatch(/No embedding model is installed/);
    expect(warns.join()).toMatch(/lexical index only/);
    const hits = await search(dir, "EXI_MOP_SPF_511_A_1670");
    expect(hits[0].anchor).toBe("§5.6.6");
    const db = openDb(indexFile(dir));
    try {
      expect((await vector(db, dir, "menu", {})).degraded).toMatch(/lexical search only/);
    } finally {
      db.close();
    }
    const st = (await invoke("rag.status", {}, { project: dir })) as Record<string, unknown> & {
      docs: { indexed: string }[];
    };
    expect(st).toMatchObject({ embedding: "none", activation: "none", profileMatches: false, chunks: 14 });
    expect(st.degraded).toMatch(/lexical search only/);
    expect(st.docs.map((d) => d.indexed)).toEqual(["fresh", "fresh", "fresh", "fresh", "fresh"]);
    expect(calls).toEqual([]);
  });

  it("a model that has no vectors yet degrades the hybrid search instead of failing", async () => {
    await indexProject(dir, quietCtx(dir));
    use(QWEN);
    calls = [];
    const hits = await search(dir, "EXI_MOP_SPF_511_A_1670");
    expect(hits[0].anchor).toBe("§5.6.6");
    expect(calls).toEqual([]);
    const st = (await invoke("rag.status", {}, { project: dir })) as Record<string, unknown>;
    expect(st).toMatchObject({ embedding: QWEN, activation: "machine", profileMatches: false, space: null });
    expect(st.degraded).toMatch(/No vectors for/);
  });

  it("dispatches a GGUF model to its runtime and keeps its space apart", async () => {
    await indexProject(dir, quietCtx(dir));
    use(GGUF);
    calls = [];
    const r = await indexProject(dir, quietCtx(dir));
    expect(r).toMatchObject({ embedding: GGUF, embedded: 14 });
    expect(new Set(calls)).toEqual(new Set([`doc:llamacpp:${GGUF}`]));
    const listed = await spaces();
    expect(listed).toHaveLength(2);
    expect(listed.find((s) => s.active)?.model).toBe(GGUF);
  });

  it("drops a space by id prefix, never the active one without force", async () => {
    const first = await indexProject(dir, quietCtx(dir));
    use(QWEN);
    const second = await indexProject(dir, quietCtx(dir));
    await expect(invoke("rag.dropSpace", { id: second.space }, { project: dir })).rejects.toThrow(/searches with/);
    await expect(invoke("rag.dropSpace", { id: "ffff" }, { project: dir })).rejects.toThrow(/No vector space/);
    const out = (await invoke("rag.dropSpace", { id: first.space?.slice(0, 6) }, { project: dir })) as {
      dropped: string;
      freedMB: number;
    };
    expect(out.dropped).toBe(first.space);
    expect(out.freedMB).toBeGreaterThan(0);
    expect((await spaces()).map((s) => s.model)).toEqual([QWEN]);
    await invoke("rag.dropSpace", { id: second.space, force: true }, { project: dir });
    expect(await spaces()).toEqual([]);
    const db = openDb(indexFile(dir));
    try {
      expect(listSpaces(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("fingerprint", () => {
  const id = (fp: SpaceFingerprint) => spaceId(fp);

  it("names the weights by their SHA-256, never by their path", () => {
    const bge = resolved(BGE);
    const weights = catalogEntry(BGE)?.source.hf?.files?.find((f) => f.path === "onnx/model_quantized.onnx");
    expect(modelIdentity(bge)).toBe(`sha256:${weights?.sha256}`);
    const fp16 = resolved("qwen3-embedding-0.6b-onnx-fp16", { dtype: "fp16" });
    expect(modelIdentity(fp16).split("+")).toHaveLength(2);
    const gguf = resolved(GGUF);
    expect(modelIdentity(gguf)).toBe(`sha256:${catalogEntry(GGUF)?.source.file?.sha256}`);
    const moved = resolved(BGE, { install: { ...bge.install, path: "E:/elsewhere/Xenova/bge-m3" } });
    expect(id(fingerprintOf(moved))).toBe(id(fingerprintOf(bge)));
  });

  it("changes with every element of the space's identity", () => {
    const q = resolved(QWEN);
    const base = fingerprintOf(q);
    expect(base).toMatchObject({
      runtime: "transformers",
      modelId: QWEN,
      pooling: "last",
      normalize: true,
      recipe: RECIPE,
    });
    expect(base.queryInstruction).toBe("Instruct: task A\nQuery: ");
    const variants: SpaceFingerprint[] = [
      { ...base, runtime: "mock" },
      fingerprintOf(resolved(QWEN, { runtime: "llamacpp" })),
      { ...base, model: "sha256:other" },
      { ...base, pooling: "mean" },
      { ...base, normalize: false },
      fingerprintOf(resolved(QWEN, { queryTask: "task B" })),
      { ...base, docInstruction: "Doc: " },
      fingerprintOf(resolved(QWEN, { install: { ...q.install, dims: 512 } })),
      { ...base, maxInputTokens: 512 },
      { ...base, recipe: RECIPE + 1 },
    ];
    const ids = new Set([id(base), ...variants.map(id)]);
    expect(ids.size).toBe(variants.length + 1);
  });

  it("a GGUF file registered from a folder or downloaded is the same model in the same space", () => {
    const gguf = resolved(GGUF);
    const downloaded = resolved(GGUF, { install: { ...gguf.install, via: "download", path: "E:/models/x.gguf" } });
    expect(fingerprintOf(downloaded).model).toBe(fingerprintOf(gguf).model);
    expect(id(fingerprintOf(downloaded))).toBe(id(fingerprintOf(gguf)));
  });
});

describe("transformers batches", () => {
  it("sorts by token length and keeps each batch under the token budget", () => {
    const groups = batches([100, 3000, 10, 600, 600, 600, 600, 600, 600, 600, 8000]);
    expect(groups.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(groups[0]).toEqual([2, 0, 3, 4, 5, 6]);
    expect(groups.at(-1)).toEqual([10]);
    expect(groups.at(-2)).toEqual([1]);
    expect(batches([5, 5, 5, 5, 5, 5, 5, 5, 5])).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [8]]);
  });
});
