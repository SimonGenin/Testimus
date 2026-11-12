import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../../../../src/core/env.ts";
import { sha256 } from "../../../../../src/core/lib/hash.ts";
import { pinMachineProfile } from "../../../../../src/core/lib/machine/profile.ts";
import { catalogEntry, registryFile } from "../../../../../src/core/lib/models-catalog.ts";
import { readPerf, withPerfScope } from "../../../../../src/core/lib/models-perf.ts";
import { writeZip } from "../../../../../src/core/lib/zip.ts";
import { embedWith } from "../../../../../src/core/rag/embed.ts";
import { serverIo } from "../../../../../src/core/rag/runtimes/llama-server.ts";
import {
  chooseBackend,
  extractZip,
  findLlamaBuild,
  LLAMA_ASSETS,
  llamacppConfig,
  llamacppRuntime,
  llamaIo,
  pullLlamaBuild,
  stopAllServers,
} from "../../../../../src/core/rag/runtimes/llamacpp.ts";
import type { GpuInfo, MachineProfile, ResolvedModel } from "../../../../../src/core/types.ts";

const saved = { io: { ...serverIo }, http: env.http, download: llamaIo.download, cpu: LLAMA_ASSETS.cpu };
let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "testimus-llama-"));
});

afterEach(async () => {
  await stopAllServers();
  Object.assign(serverIo, saved.io);
  env.http = saved.http;
  llamaIo.download = saved.download;
  LLAMA_ASSETS.cpu = saved.cpu;
  llamacppConfig.build = null;
  pinMachineProfile(null);
  rmSync(tmp, { recursive: true, force: true });
});

function machine(gpus: Partial<GpuInfo>[]): MachineProfile {
  return {
    at: "",
    ramTotalMB: 65536,
    ramFreeMB: 30000,
    cpu: { model: "x", threads: 24 },
    gpus: gpus.map((g) => ({ name: "GPU", vendor: "other", vramTotalMB: null, vramUsedMB: null, source: "wmi", ...g })),
    drives: [],
    loaded: [],
  };
}

describe("backend", () => {
  it("picks CUDA when an NVIDIA driver supports CUDA 13, else Vulkan on a GPU, else CPU", () => {
    expect(chooseBackend(machine([{ name: "NVIDIA GeForce RTX 5080", vendor: "nvidia", driver: "591.44" }]))).toBe(
      "cuda",
    );
    expect(chooseBackend(machine([{ name: "NVIDIA GeForce GTX 1080", vendor: "nvidia", driver: "560.94" }]))).toBe(
      "vulkan",
    );
    expect(chooseBackend(machine([{ name: "NVIDIA T500", vendor: "nvidia" }]))).toBe("vulkan");
    expect(chooseBackend(machine([{ name: "Intel(R) Iris(R) Xe Graphics", vendor: "intel" }]))).toBe("vulkan");
    expect(chooseBackend(machine([{ name: "Microsoft Basic Display Adapter" }]))).toBe("cpu");
    expect(chooseBackend(machine([]))).toBe("cpu");
  });
});

describe("finding a build (path A)", () => {
  function build(name: string, files: string[]): string {
    const d = join(tmp, name);
    mkdirSync(d, { recursive: true });
    for (const f of ["llama-server.exe", ...files]) writeFileSync(join(d, f), "");
    return d;
  }

  it("reads the backend from the DLLs and the build from the folder name", () => {
    expect(findLlamaBuild(build("b12032-cuda13", ["ggml-cuda.dll", "cudart64_13.dll"]))).toEqual({
      exe: join(tmp, "b12032-cuda13", "llama-server.exe"),
      build: "b12032",
      backend: "cuda",
      via: "path",
    });
    expect(findLlamaBuild(build("b12032-vulkan", ["ggml-vulkan.dll"]))?.backend).toBe("vulkan");
    expect(findLlamaBuild(build("llama", ["ggml-cpu-x64.dll"]))).toMatchObject({ backend: "cpu", build: "unknown" });
  });

  it("accepts the exe itself, reads the build marker, and returns null without llama-server.exe", () => {
    const d = build("whatever", ["GGML-CUDA.DLL"]);
    writeFileSync(join(d, "testimus-build.json"), JSON.stringify({ build: "b9999" }));
    expect(findLlamaBuild(join(d, "llama-server.exe"))).toMatchObject({ backend: "cuda", build: "b9999" });
    mkdirSync(join(tmp, "empty"));
    expect(findLlamaBuild(join(tmp, "empty"))).toBeNull();
    expect(findLlamaBuild(join(tmp, "missing"))).toBeNull();
  });
});

describe("downloading a build (path B)", () => {
  const enc = new TextEncoder();
  const zip = writeZip([
    { name: "llama-server.exe", data: enc.encode("MZ server") },
    { name: "ggml-cpu-x64.dll", data: enc.encode("dll") },
    { name: "sub/readme.txt", data: enc.encode("hello") },
  ]);

  function serve(bytes: Uint8Array, name = "llama-b12032-bin-win-cpu-x64.zip") {
    LLAMA_ASSETS.cpu = [{ name, sha256: sha256(bytes), size: bytes.length }];
    const urls: string[] = [];
    llamaIo.download = async (url, file, onBytes) => {
      urls.push(url);
      writeFileSync(file, bytes.subarray(0, 10));
      onBytes(10, bytes.length);
      writeFileSync(file, bytes);
      onBytes(bytes.length, bytes.length);
    };
    return urls;
  }

  it("downloads the pinned zip with progress, checks its SHA-256, extracts it and returns the build", async () => {
    const urls = serve(zip);
    const seen: { file: string; loaded: number; total: number }[] = [];
    const rt = await pullLlamaBuild("cpu", tmp, (p) => seen.push(p), new AbortController().signal);
    const target = join(tmp, "b12032-cpu");
    expect(rt).toEqual({ exe: join(target, "llama-server.exe"), build: "b12032", backend: "cpu", via: "download" });
    expect(urls).toEqual([
      "https://github.com/ggml-org/llama.cpp/releases/download/b12032/llama-b12032-bin-win-cpu-x64.zip",
    ]);
    expect(seen).toEqual([
      { file: "llama-b12032-bin-win-cpu-x64.zip", loaded: 10, total: zip.length },
      { file: "llama-b12032-bin-win-cpu-x64.zip", loaded: zip.length, total: zip.length },
    ]);
    expect(readFileSync(join(target, "sub", "readme.txt"), "utf8")).toBe("hello");
    expect(existsSync(join(target, ".download"))).toBe(false);
    const again = await pullLlamaBuild("cpu", tmp, () => {}, new AbortController().signal);
    expect(again).toEqual(rt);
    expect(urls).toHaveLength(1);
  });

  it("deletes a file whose SHA-256 does not match and fails", async () => {
    serve(zip);
    LLAMA_ASSETS.cpu = [{ ...LLAMA_ASSETS.cpu[0], sha256: "0".repeat(64) }];
    await expect(pullLlamaBuild("cpu", tmp, () => {}, new AbortController().signal)).rejects.toThrow(
      /does not match its published SHA-256/,
    );
    expect(readdirSync(join(tmp, "b12032-cpu", ".download"))).toEqual([]);
    expect(existsSync(join(tmp, "b12032-cpu", "llama-server.exe"))).toBe(false);
  });

  it("can be cancelled, leaving no partial file", async () => {
    serve(zip);
    const ctrl = new AbortController();
    llamaIo.download = async (_u, file, onBytes, signal) => {
      writeFileSync(file, zip.subarray(0, 5));
      onBytes(5, zip.length);
      ctrl.abort();
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
    };
    await expect(pullLlamaBuild("cpu", tmp, () => {}, ctrl.signal)).rejects.toThrow(/cancelled/);
    expect(readdirSync(join(tmp, "b12032-cpu", ".download"))).toEqual([]);
  });

  it("knows the pinned assets of each backend", () => {
    expect(saved.cpu.map((a) => a.name)).toEqual(["llama-b12032-bin-win-cpu-x64.zip"]);
    expect(LLAMA_ASSETS.cuda.map((a) => a.name)).toEqual([
      "llama-b12032-bin-win-cuda-13.4-x64.zip",
      "cudart-llama-bin-win-cuda-13.4-x64.zip",
    ]);
    expect(LLAMA_ASSETS.vulkan.map((a) => a.name)).toEqual(["llama-b12032-bin-win-vulkan-x64.zip"]);
    for (const a of [...saved.cpu, ...LLAMA_ASSETS.cuda, ...LLAMA_ASSETS.vulkan]) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.size).toBeGreaterThan(1e6);
    }
  });

  it("strips a single top folder and refuses an entry outside the target", () => {
    const f = join(tmp, "a.zip");
    writeFileSync(
      f,
      writeZip([
        { name: "llama-b1/llama-server.exe", data: enc.encode("x") },
        { name: "llama-b1/ggml.dll", data: enc.encode("y") },
      ]),
    );
    expect(extractZip(f, join(tmp, "out")).sort()).toEqual(["ggml.dll", "llama-server.exe"]);
    writeFileSync(f, writeZip([{ name: "../evil.dll", data: enc.encode("x") }]));
    expect(() => extractZip(f, join(tmp, "out2"))).toThrow(/outside the target/);
    expect(existsSync(join(tmp, "evil.dll"))).toBe(false);
  });
});

describe("runtime", () => {
  let calls: HttpReq[] = [];
  let spawned: { args: string[]; low: boolean }[] = [];

  function json(status: number, body: unknown): HttpRes {
    return { status, headers: {}, text: JSON.stringify(body) };
  }

  function setup(): { emb: ResolvedModel; rr: ResolvedModel } {
    calls = [];
    const exe = join(tmp, "llama-server.exe");
    writeFileSync(exe, "");
    llamacppConfig.build = { exe, build: "b12032", backend: "cuda", via: "path" };
    pinMachineProfile(machine([{ vendor: "nvidia", driver: "591.44", vramTotalMB: 16303, vramUsedMB: 0 }]));
    for (const f of ["e.gguf", "r.gguf"]) writeFileSync(join(tmp, f), "gguf");
    spawned = [];
    serverIo.spawn = (_exe, args, low = false) => {
      spawned.push({ args, low });
      return { pid: 7, onOutput: () => {}, exited: new Promise(() => {}) };
    };
    serverIo.freePort = async () => 51000;
    serverIo.kill = async () => {};
    serverIo.randomKey = () => "secret";
    env.http = async (req) => {
      calls.push(req);
      const path = new URL(req.url).pathname;
      if (path === "/health") return json(200, { status: "ok" });
      if (req.headers?.authorization !== "Bearer secret") return json(401, {});
      const body = JSON.parse(req.body ?? "{}");
      if (path === "/v1/embeddings")
        return json(200, {
          data: body.input.map((_: string, i: number) => ({ index: i, embedding: [i, 0.5] })).reverse(),
        });
      if (path === "/v1/rerank")
        return json(200, {
          results: body.documents
            .map((d: string, index: number) => ({ index, relevance_score: d.length / 10 }))
            .sort(
              (a: { relevance_score: number }, b: { relevance_score: number }) => b.relevance_score - a.relevance_score,
            ),
        });
      return json(404, {});
    };
    const model = (id: string, path: string): ResolvedModel => {
      const entry = catalogEntry(id)!;
      return {
        entry,
        install: { model: id, via: "path", runtime: "llamacpp", path, status: "installed" },
        runtime: "llamacpp",
        device: "gpu",
        queryTask: "Find passages",
      };
    };
    return {
      emb: model("qwen3-embedding-0.6b-q8", join(tmp, "e.gguf")),
      rr: model("qwen3-reranker-0.6b-q8", join(tmp, "r.gguf")),
    };
  }

  it("embeds in batches of 16 with the query instruction, back in the order of the texts", async () => {
    const { emb } = setup();
    const out = await llamacppRuntime.embed(
      emb,
      Array.from({ length: 20 }, (_, i) => `t${i}`),
      "query",
    );
    expect(out[3]).toEqual(Float32Array.from([3, 0.5]));
    expect(out[19]).toEqual(Float32Array.from([3, 0.5]));
    const posts = calls.filter((c) => c.url.endsWith("/v1/embeddings")).map((c) => JSON.parse(c.body ?? "{}"));
    expect(posts.map((p) => p.input.length)).toEqual([16, 4]);
    expect(posts[0].input[0]).toBe("Instruct: Find passages\nQuery: t0");
    expect(calls[0].url).toBe("http://127.0.0.1:51000/health");
  });

  it("on a PC with a card its CUDA build places the layers; on a PC without one the same build runs on the processor, low priority, with the PC's threads less two", async () => {
    const { emb, rr } = setup();
    await llamacppRuntime.embed(emb, ["a"], "doc");
    expect(spawned[0].low).toBe(false);
    expect(spawned[0].args).toEqual(expect.arrayContaining(["-ngl", "auto"]));
    await stopAllServers();
    pinMachineProfile(machine([]));
    await llamacppRuntime.embed(emb, ["a"], "doc");
    await llamacppRuntime.rerank(rr, "q", ["a"]);
    for (const s of spawned.slice(1)) {
      expect(s.low).toBe(true);
      expect(s.args).toEqual(expect.arrayContaining(["-dev", "none", "-t", "22", "-tb", "22"]));
      expect(s.args).not.toContain("-ngl");
    }
    expect(spawned).toHaveLength(3);
    expect(
      readPerf()
        .filter((l) => l.op === "model.load")
        .map((l) => l.device)
        .slice(-3),
    ).toEqual(["gpu", "cpu", "cpu"]);
  });

  it("a processor build runs on the processor even on a PC with a card", async () => {
    const { emb } = setup();
    llamacppConfig.build = { ...(llamacppConfig.build as NonNullable<typeof llamacppConfig.build>), backend: "cpu" };
    await llamacppRuntime.embed(emb, ["a"], "doc");
    expect(spawned[0]).toMatchObject({ low: true });
    expect(spawned[0].args).toEqual(expect.arrayContaining(["-dev", "none", "-t", "22"]));
  });

  it("puts the rerank scores back in the order of the passages", async () => {
    const { rr } = setup();
    const scores = await llamacppRuntime.rerank(rr, "q", ["a", "abcde", "abc"]);
    expect(scores).toEqual([0.1, 0.5, 0.3]);
    const post = JSON.parse(calls.find((c) => c.url.endsWith("/v1/rerank"))?.body ?? "{}");
    expect(post).toEqual({ query: "q", documents: ["a", "abcde", "abc"], top_n: 3 });
    expect(await llamacppRuntime.rerank(rr, "q", [])).toEqual([]);
  });

  it("probes an embedding and a reranker", async () => {
    const { emb, rr } = setup();
    expect(await llamacppRuntime.probe(emb)).toEqual({ dims: 2, maxTokens: 8192 });
    expect(await llamacppRuntime.probe(rr)).toEqual({ dims: 1, maxTokens: 8192 });
  });

  it("cancelling the index job while llama-server loads stops the load and kills it (#9)", async () => {
    const { emb } = setup();
    const killed: number[] = [];
    serverIo.kill = async (pid) => {
      killed.push(pid);
    };
    serverIo.sleep = () => new Promise((r) => setTimeout(r, 1));
    const ctrl = new AbortController();
    let n = 0;
    env.http = async () => {
      if (++n === 2) ctrl.abort();
      return json(503, { error: { message: "Loading model" } });
    };
    const job = withPerfScope(
      { jobId: "rag-index-x", project: tmp },
      () => embedWith(emb, ["a passage"], "doc"),
      ctrl.signal,
    );
    await expect(job).rejects.toThrow(/cancelled/);
    await new Promise((r) => setTimeout(r, 10));
    expect(killed).toEqual([7]);
    expect(n).toBeLessThan(10);
  });

  it("says what is missing: the build, or the GGUF file", async () => {
    const { emb } = setup();
    llamacppConfig.build = null;
    rmSync(registryFile(), { force: true });
    await expect(llamacppRuntime.embed(emb, ["x"], "doc")).rejects.toThrow(/llama.cpp is not installed/);
    setup();
    await expect(
      llamacppRuntime.embed({ ...emb, install: { ...emb.install, path: join(tmp, "gone.gguf") } }, ["x"], "doc"),
    ).rejects.toThrow(/GGUF file is missing/);
  });
});
