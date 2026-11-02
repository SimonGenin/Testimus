import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runClaude } from "../../src/core/claude/run.ts";
import { quietCtx } from "../../src/core/command.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { env, type HttpReq, type HttpRes } from "../../src/core/env.ts";
import { catalogEntry } from "../../src/core/lib/models-catalog.ts";
import {
  addTokens,
  journalFile,
  type PerfRecord,
  perfFields,
  readPerf,
  timeLoad,
  withPerfScope,
} from "../../src/core/lib/models-perf.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../src/core/lib/project.ts";
import { spaceId } from "../../src/core/rag/db.ts";
import { embedWith, rerankWith, runtimes } from "../../src/core/rag/embed.ts";
import { fingerprintOf } from "../../src/core/rag/fingerprint.ts";
import { indexProject } from "../../src/core/rag/indexer.ts";
import { ensureServer, serverIo, stopAllServers } from "../../src/core/rag/runtimes/llama-server.ts";
import { llamacppConfig } from "../../src/core/rag/runtimes/llamacpp.ts";
import { mockRuntime } from "../../src/core/rag/runtimes/mock.ts";
import { transformersIo } from "../../src/core/rag/runtimes/transformers.ts";
import type { ResolvedModel, RuntimeId } from "../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const SECRET = "Que se passe-t-il quand le DSO ouvre EXI_MOP_SPF_511_A_20";
const saved = { runtimes: { ...runtimes }, io: { ...serverIo }, tio: { ...transformersIo }, http: env.http };
const savedClaude = env.spawnClaude;
const savedHost = process.env.OLLAMA_HOST;
let tmp: string;

function model(id: string, patch: Partial<ResolvedModel> = {}, install: Partial<ResolvedModel["install"]> = {}) {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(id);
  const runtime = (patch.runtime ?? entry.runtimes[0]) as RuntimeId;
  return {
    entry,
    install: { model: id, via: "path", runtime, status: "installed", ...install },
    runtime,
    device: "cpu",
    dtype: entry.dtypeByDevice?.cpu,
    queryTask: "Find railway passages",
    ...patch,
  } as ResolvedModel;
}

const ok = (body: unknown): HttpRes => ({ status: 200, headers: {}, text: JSON.stringify(body) });
const lines = () => readPerf();
const raw = () => readFileSync(journalFile(), "utf8");

beforeEach(() => {
  rmSync(journalFile(), { force: true });
  tmp = mkdtempSync(join(tmpdir(), "testimus-perf-"));
});
afterEach(async () => {
  Object.assign(runtimes, saved.runtimes);
  await stopAllServers();
  Object.assign(serverIo, saved.io);
  Object.assign(transformersIo, saved.tio);
  env.http = saved.http;
  env.spawnClaude = savedClaude;
  llamacppConfig.build = null;
  if (savedHost === undefined) delete process.env.OLLAMA_HOST;
  else process.env.OLLAMA_HOST = savedHost;
});

describe("every model operation writes its line, without any text (§7.9)", () => {
  it("embed.query, embed.index and rerank through the dispatcher: catalog id, space, runtime, device, dtype, items, tokens", async () => {
    runtimes.transformers = {
      ...mockRuntime,
      embed: async (m, texts, mode) => {
        addTokens(texts.length * 11);
        return mockRuntime.embed(m, texts, mode);
      },
    };
    const m = model("bge-m3-q8");
    const r = model("bge-reranker-v2-m3-q8");
    await embedWith(m, [SECRET], "query");
    await embedWith(m, [SECRET, "deux", "trois"], "doc");
    await rerankWith(r, SECRET, ["a", "b", "c", "d"]);
    const [q, idx, rr] = lines();
    const space = spaceId(fingerprintOf(m));
    expect(q).toMatchObject({
      op: "embed.query",
      model: "bge-m3-q8",
      fingerprint: space,
      runtime: "transformers",
      device: "cpu",
      quantization: "q8",
      items: 1,
      tokens: 11,
    });
    expect(idx).toMatchObject({ op: "embed.index", model: "bge-m3-q8", fingerprint: space, items: 3, tokens: 33 });
    expect(rr).toMatchObject({ op: "rerank", model: "bge-reranker-v2-m3-q8", items: 4 });
    expect(rr.fingerprint).toBeUndefined();
    expect(raw()).not.toMatch(/DSO|EXI_MOP|deux|trois/);
  });

  it("a model loaded inside an operation is a model.load line; the operation's time leaves the load out", async () => {
    const m = model("bge-m3-q8");
    runtimes.transformers = {
      ...mockRuntime,
      embed: async (mm, texts, mode) => {
        await timeLoad(perfFields(mm), () => new Promise((res) => setTimeout(res, 60)));
        return mockRuntime.embed(mm, texts, mode);
      },
    };
    await withPerfScope({ project: "D:\\p", jobId: "rag-index-1" }, () => embedWith(m, ["x"], "query"));
    const [load, q] = lines();
    expect(load).toMatchObject({
      op: "model.load",
      model: "bge-m3-q8",
      items: 1,
      project: "D:\\p",
      jobId: "rag-index-1",
    });
    expect(load.loadMs).toBeGreaterThanOrEqual(50);
    expect(q).toMatchObject({ op: "embed.query", jobId: "rag-index-1" });
    expect(q.loadMs).toBeGreaterThanOrEqual(50);
    expect(q.ms).toBeLessThan(50);
  });

  it("rag.index: one embed.index line per batch, with the space, the project and the job", async () => {
    const dir = join(tmp, "project");
    cpSync(FIXTURE, dir, { recursive: true });
    const m = model("bge-m3-q8", { runtime: "mock" }, { runtime: "mock" });
    const report = await indexProject(dir, { ...quietCtx(dir), jobId: "rag-index-42" }, { model: m });
    const idx = lines().filter((l) => l.op === "embed.index");
    expect(report.embedded).toBeGreaterThan(0);
    expect(idx.length).toBe(Math.ceil(report.embedded / 16));
    expect(idx.reduce((a, l) => a + l.items, 0)).toBe(report.embedded);
    for (const l of idx)
      expect(l).toMatchObject({ fingerprint: report.space, project: dir, jobId: "rag-index-42", runtime: "mock" });
    const docs = readFileSync(join(dir, "docs", "SOSIE_211_D401-1_4", "doc.md"), "utf8");
    const someWords = docs.match(/[A-Za-zÀ-ÿ]{12,}/g)?.slice(0, 20) ?? [];
    for (const w of someWords) expect(raw()).not.toContain(w);
  });
});

describe("transformers.js: model.load with peak memory; a load that fails for memory is logged", () => {
  type T = { type: string; dims: number[]; data: Float32Array };
  const tensor = (dims: number[]): T & Record<string, unknown> => {
    const t = {
      type: "float32",
      dims,
      data: new Float32Array(dims.reduce((a, b) => a * b, 1)).fill(1),
      to: () => t,
      slice: () => tensor([dims[0], dims[dims.length - 1]]),
      normalize: () => t,
    };
    return t;
  };
  function fakeTransformers(fail?: string) {
    const tokenizer = Object.assign(
      (texts: string[]) => ({ input_ids: tensor([texts.length, 4]), attention_mask: tensor([texts.length, 4]) }),
      { encode: (t: string) => t.split(" "), padding_side: "right", model_max_length: 8192 },
    );
    const load = async () => {
      if (fail) throw new Error(fail);
      return async (inputs: { input_ids: T }) => ({ last_hidden_state: tensor([inputs.input_ids.dims[0], 4, 8]) });
    };
    transformersIo.import = async () =>
      ({
        env: {},
        AutoTokenizer: { from_pretrained: async () => tokenizer },
        AutoModel: { from_pretrained: load },
        AutoModelForSequenceClassification: { from_pretrained: load },
        mean_pooling: () => tensor([1, 8]),
      }) as never;
  }

  it("load → model.load (loadMs, peakRssMB); the query line counts tokens and leaves the load out", async () => {
    fakeTransformers();
    const m = model("bge-m3-q8", {}, { path: join(tmp, "BAAI", "bge-m3-a") });
    const [v] = await embedWith(m, ["un deux trois"], "query");
    expect(v).toHaveLength(8);
    const [load, q] = lines();
    expect(load).toMatchObject({ op: "model.load", model: "bge-m3-q8", runtime: "transformers", quantization: "q8" });
    expect(load.peakRssMB).toBeGreaterThan(10);
    expect(q).toMatchObject({ op: "embed.query", tokens: 3 });
    await embedWith(m, ["quatre"], "query");
    expect(lines().filter((l) => l.op === "model.load")).toHaveLength(1);
  });

  it("an allocation failure while loading → a model.load line flagged oom, and the error goes on", async () => {
    fakeTransformers("Failed to allocate memory for requested buffer of size 2147483648");
    const m = model("bge-m3-q8", { device: "dml" }, { path: join(tmp, "BAAI", "bge-m3-b") });
    await expect(embedWith(m, ["x"], "doc")).rejects.toThrow(/allocate/);
    const all = lines();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ op: "model.load", model: "bge-m3-q8", device: "dml", items: 0, oom: true });
  });

  it("another failure is not a memory failure", async () => {
    fakeTransformers("Could not locate file: tokenizer.json");
    const m = model("bge-m3-q8", {}, { path: join(tmp, "BAAI", "bge-m3-c") });
    await expect(embedWith(m, ["x"], "doc")).rejects.toThrow(/locate/);
    expect(lines()).toEqual([]);
  });
});

describe("llama.cpp: load time and the NVIDIA memory it took", () => {
  function fakeServer(opts: { exitWith?: string } = {}) {
    let vram = 2000;
    serverIo.spawn = () => ({
      pid: 4242,
      onOutput: (cb) => {
        if (opts.exitWith) cb(opts.exitWith);
      },
      exited: opts.exitWith ? Promise.resolve(1) : new Promise(() => {}),
    });
    serverIo.freePort = async () => 51234;
    serverIo.kill = async () => {};
    serverIo.sleep = async () => {};
    serverIo.vramUsedMB = async () => {
      const v = vram;
      vram += 610;
      return v;
    };
    const posts: HttpReq[] = [];
    env.http = async (req) => {
      if (req.url.endsWith("/health")) return opts.exitWith ? { status: 503, headers: {} } : ok({ status: "ok" });
      posts.push(req);
      const body = JSON.parse(req.body as string) as { input: string[] };
      return ok({
        data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })),
        usage: { prompt_tokens: 17 * body.input.length },
      });
    };
    return posts;
  }

  it("embedWith a GGUF: model.load with vramMB (nvidia-smi delta), then embed.query with tokens", async () => {
    fakeServer();
    const exe = join(tmp, "llama-server.exe");
    const gguf = join(tmp, "Qwen3-Embedding-0.6B-Q8_0.gguf");
    writeFileSync(exe, "");
    writeFileSync(gguf, "GGUF");
    llamacppConfig.build = { exe, build: "b12032", backend: "cuda", via: "path" };
    const m = model("qwen3-embedding-0.6b-q8", { runtime: "llamacpp", device: "gpu" }, { path: gguf });
    await embedWith(m, [SECRET, "b"], "query");
    const [load, q] = lines();
    expect(load).toMatchObject({
      op: "model.load",
      model: "qwen3-embedding-0.6b-q8",
      runtime: "llamacpp",
      device: "gpu",
      quantization: "Q8_0",
      vramMB: 610,
      items: 1,
    });
    expect(q).toMatchObject({ op: "embed.query", items: 2, tokens: 34, runtime: "llamacpp" });
    expect(raw()).not.toMatch(/DSO/);
  });

  it("a server that dies for lack of memory before it is ready → a model.load line flagged oom", async () => {
    fakeServer({
      exitWith: "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 9100 MiB: cudaMalloc failed: out of memory\n",
    });
    const perf = {
      model: "qwen3-embedding-8b-q8",
      runtime: "llamacpp" as const,
      device: "gpu" as const,
      quantization: "Q8_0",
    };
    await expect(ensureServer({ exe: "x.exe", model: join(tmp, "big.gguf"), kind: "embedding", perf })).rejects.toThrow(
      /stopped before it was ready/,
    );
    expect(lines()).toEqual([expect.objectContaining({ op: "model.load", model: "qwen3-embedding-8b-q8", oom: true })]);
  });
});

describe("Ollama: load_duration, and /api/ps says when a model is partly on the processor", () => {
  function fakeOllama(embed: (body: { input: string[] }) => HttpRes) {
    process.env.OLLAMA_HOST = "127.0.0.1:11434";
    writeSettings({ ...DEFAULT_SETTINGS });
    env.http = async (req) => {
      if (req.url.endsWith("/api/ps"))
        return ok({ models: [{ name: "qwen3-embedding:8b", size: 9100 * 1048576, size_vram: 6000 * 1048576 }] });
      if (req.url.endsWith("/api/embed")) return embed(JSON.parse(req.body as string));
      return { status: 404, headers: {}, text: "{}" };
    };
  }
  const ollamaModel = (tag: string) =>
    model(
      "qwen3-embedding-0.6b-q8",
      { runtime: "ollama", device: "gpu" },
      { via: "ollama", runtime: "ollama", ollama: tag },
    );

  it("first call → model.load (loadMs, vramMB, partialOffload); every later operation carries partialOffload", async () => {
    fakeOllama((b) =>
      ok({
        embeddings: b.input.map(() => [1, 0]),
        prompt_eval_count: 9 * b.input.length,
        load_duration: 1_500_000_000,
      }),
    );
    const m = ollamaModel("qwen3-embedding:8b");
    await embedWith(m, [SECRET], "query");
    await embedWith(m, ["b", "c"], "doc");
    const all = lines();
    expect(all.map((l) => l.op)).toEqual(["model.load", "embed.query", "embed.index"]);
    expect(all[0]).toMatchObject({ runtime: "ollama", loadMs: 1500, vramMB: 6000, partialOffload: true });
    expect(all[1]).toMatchObject({ partialOffload: true, tokens: 9, loadMs: 1500 });
    expect(all[2]).toMatchObject({ partialOffload: true, tokens: 18 });
    expect(all[2].loadMs).toBeUndefined();
  });

  it("Ollama refusing a model for memory → a model.load line flagged oom", async () => {
    fakeOllama(() => ({
      status: 500,
      headers: {},
      text: JSON.stringify({ error: "model requires more system memory (12.0 GiB) than is available (8.1 GiB)" }),
    }));
    await expect(embedWith(ollamaModel("qwen3-embedding:8b-q8_0"), ["x"], "query")).rejects.toThrow(/memory/);
    expect(lines()).toEqual([expect.objectContaining({ op: "model.load", runtime: "ollama", oom: true, items: 0 })]);
  });
});

describe("claude.run: the Claude part of a run", () => {
  it("one line per run with the Claude model, the project and its time; nothing of the prompt", async () => {
    const dir = join(tmp, "LFRPS12");
    cpSync(FIXTURE, dir, { recursive: true });
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
    const result = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      duration_ms: 1234,
    });
    env.spawnClaude = async (s) => {
      s.onLine?.(result);
      return { code: 0, stdout: `${result}\n`, stderr: "" };
    };
    await runClaude({ kind: "chat", project: dir, prompt: SECRET, model: "opus", effort: "low", jobId: "chat-7" });
    const [l] = lines();
    expect(l).toMatchObject({ op: "claude.run", model: "opus", project: dir, jobId: "chat-7", items: 1, ms: 1234 });
    expect(raw()).not.toMatch(/DSO/);
  });
});

describe("models perf reads what the operations wrote", () => {
  it("count, p50, throughput per op × model × device", async () => {
    runtimes.transformers = mockRuntime;
    const m = model("bge-m3-q8");
    for (let i = 0; i < 3; i++) await embedWith(m, ["q"], "query");
    await embedWith(m, ["a", "b", "c", "d"], "doc");
    const stats = (await invoke("models.perf", { model: "bge-m3-q8" }, { project: null })) as {
      op: string;
      count: number;
    }[];
    expect(stats.map((s) => [s.op, s.count])).toEqual([
      ["embed.index", 1],
      ["embed.query", 3],
    ]);
    const rec: PerfRecord[] = lines();
    expect(rec.every((l) => Object.keys(l).every((k) => !/text|query|prompt/.test(k)))).toBe(true);
  });
});
