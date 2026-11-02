import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, type HttpReq, type HttpRes } from "../../src/core/env.ts";
import { catalogEntry, registryFile } from "../../src/core/lib/models-catalog.ts";
import { readSettings, writeJson, writeSettings } from "../../src/core/lib/project.ts";
import { spaceId } from "../../src/core/rag/db.ts";
import { fingerprintOf } from "../../src/core/rag/fingerprint.ts";
import {
  catalogEntryForTag,
  isLoopbackHost,
  manifestFile,
  normalizeOllamaHost,
  ollamaDelete,
  ollamaHost,
  ollamaIo,
  ollamaPs,
  ollamaPull,
  ollamaRuntime,
  ollamaShow,
  ollamaStatus,
  ollamaUsage,
  partlyOnCpu,
} from "../../src/core/rag/runtimes/ollama.ts";
import type { ResolvedModel } from "../../src/core/types.ts";

const MB = 1024 * 1024;
const saved = { http: env.http, stream: ollamaIo.stream, envVars: { ...process.env } };
let calls: HttpReq[] = [];
let tmp = "";

function json(status: number, body: unknown): HttpRes {
  return { status, headers: {}, text: JSON.stringify(body) };
}

const SHOW_06B = {
  capabilities: ["embedding"],
  model_info: {
    "general.architecture": "qwen3",
    "qwen3.embedding_length": 1024,
    "qwen3.context_length": 32768,
    "qwen3.pooling_type": 3,
  },
};

function fakeOllama(over: Partial<Record<string, (req: HttpReq) => HttpRes>> = {}) {
  env.http = async (req) => {
    calls.push(req);
    const path = new URL(req.url).pathname;
    const h = over[path];
    if (h) return h(req);
    if (path === "/api/version") return json(200, { version: "0.12.6" });
    if (path === "/api/tags")
      return json(200, {
        models: [
          {
            name: "qwen3-embedding:0.6b",
            digest: "abc123",
            size: 639 * 1024 * 1024,
            details: { quantization_level: "Q8_0" },
          },
          {
            name: "llama3.2:latest",
            digest: "def456",
            size: 2019 * 1024 * 1024,
            details: { quantization_level: "Q4_K_M" },
          },
        ],
      });
    if (path === "/api/show") {
      const model = JSON.parse(req.body ?? "{}").model;
      return json(
        200,
        model === "qwen3-embedding:0.6b"
          ? SHOW_06B
          : { capabilities: ["completion"], model_info: { "general.architecture": "llama" } },
      );
    }
    if (path === "/api/ps")
      return json(200, {
        models: [{ name: "qwen3-embedding:8b-q8_0", size: 9100 * 1024 * 1024, size_vram: 6000 * 1024 * 1024 }],
      });
    if (path === "/api/embed") {
      const body = JSON.parse(req.body ?? "{}");
      return json(200, {
        embeddings: body.input.map((_: string, i: number) => [i, 1, 0]),
        prompt_eval_count: body.input.length * 7,
      });
    }
    return json(404, { error: "not found" });
  };
}

function model(over: Partial<ResolvedModel["install"]> = {}): ResolvedModel {
  const entry = catalogEntry("qwen3-embedding-0.6b-q8")!;
  return {
    entry,
    install: {
      model: entry.id,
      via: "ollama",
      runtime: "ollama",
      ollama: "qwen3-embedding:0.6b",
      status: "installed",
      ...over,
    },
    runtime: "ollama",
    device: "gpu",
    queryTask: "Find railway passages",
  };
}

beforeEach(() => {
  calls = [];
  tmp = mkdtempSync(join(tmpdir(), "testimus-ollama-"));
  delete process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_MODELS;
  process.env.LOCALAPPDATA = join(tmp, "local");
  process.env.USERPROFILE = join(tmp, "profile");
  rmSync(registryFile(), { force: true });
  writeSettings({ ...readSettings(), models: { allowRemote: true } });
});

afterEach(() => {
  env.http = saved.http;
  ollamaIo.stream = saved.stream;
  process.env = { ...saved.envVars };
  rmSync(tmp, { recursive: true, force: true });
});

describe("host", () => {
  it("defaults to loopback and parses OLLAMA_HOST like Ollama does", () => {
    expect(ollamaHost()).toBe("http://127.0.0.1:11434");
    expect(normalizeOllamaHost("0.0.0.0")).toBe("http://127.0.0.1:11434");
    expect(normalizeOllamaHost("localhost:5000")).toBe("http://localhost:5000");
    expect(normalizeOllamaHost("http://127.0.0.1")).toBe("http://127.0.0.1:80");
    expect(normalizeOllamaHost("https://box.lan/")).toBe("https://box.lan:443");
    process.env.OLLAMA_HOST = "127.0.0.2:7000";
    expect(ollamaHost()).toBe("http://127.0.0.2:7000");
  });

  it("reads the host from models.json when OLLAMA_HOST is not set", () => {
    writeJson(registryFile(), {
      allowRemote: true,
      installs: [],
      ollama: { enabled: true, host: "http://[::1]:9999" },
    });
    expect(ollamaHost()).toBe("http://[::1]:9999");
    expect(isLoopbackHost(ollamaHost())).toBe(true);
  });

  it("refuses a host that is not loopback, without calling it", async () => {
    process.env.OLLAMA_HOST = "http://192.168.1.20:11434";
    fakeOllama();
    const s = await ollamaStatus();
    expect(s.state).toBe("refused");
    expect(s.message).toMatch(/not on this PC/);
    expect(calls).toHaveLength(0);
    await expect(ollamaRuntime.embed(model(), ["x"], "doc")).rejects.toThrow(/refused/);
    expect(calls).toHaveLength(0);
  });
});

describe("status", () => {
  it("is disabled when settings say never, without any call", async () => {
    writeSettings({ ...readSettings(), models: { allowRemote: true, useOllama: "never" } });
    fakeOllama();
    const s = await ollamaStatus();
    expect(s.state).toBe("disabled");
    expect(calls).toHaveLength(0);
    await expect(ollamaPs()).rejects.toThrow(/turned off/);
  });

  it("is absent when nothing answers and ollama.exe is not there", async () => {
    env.http = async () => {
      throw new Error("ECONNREFUSED");
    };
    const s = await ollamaStatus();
    expect(s.state).toBe("absent");
    expect(s.message).toMatch(/not installed/);
    expect(s.models).toEqual([]);
  });

  it("is stopped when nothing answers but ollama.exe is installed", async () => {
    const dir = join(tmp, "local", "Programs", "Ollama");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ollama.exe"), "");
    env.http = async () => {
      throw new Error("ECONNREFUSED");
    };
    const s = await ollamaStatus();
    expect(s.state).toBe("stopped");
    expect(s.exe).toBe(join(dir, "ollama.exe"));
    expect(s.message).toMatch(/Start Ollama/);
  });

  it("is running with its models, their catalog match, what is loaded and where it stores", async () => {
    process.env.OLLAMA_MODELS = join(tmp, "ollama-models");
    fakeOllama();
    const s = await ollamaStatus();
    expect(s.state).toBe("running");
    expect(s.version).toBe("0.12.6");
    expect(s.storage).toMatchObject({ dir: join(tmp, "ollama-models"), fromEnv: true });
    expect(typeof s.storage.freeMB).toBe("number");
    expect(s.models).toEqual([
      {
        name: "qwen3-embedding:0.6b",
        digest: "abc123",
        sizeMB: 639,
        quantization: "Q8_0",
        embedding: true,
        catalogId: "qwen3-embedding-0.6b-q8",
        dims: 1024,
        contextLength: 32768,
        pooling: "last",
      },
      expect.objectContaining({ name: "llama3.2:latest", embedding: false, catalogId: undefined }),
    ]);
    expect(s.loaded).toEqual([{ name: "qwen3-embedding:8b-q8_0", sizeMB: 9100, vramMB: 6000, runtime: "ollama" }]);
    expect(s.message).toMatch(/1 embedding model\b/);
  });

  it("defaults the storage to the user's .ollama folder", async () => {
    env.http = async () => {
      throw new Error("down");
    };
    const s = await ollamaStatus();
    expect(s.storage).toMatchObject({ dir: join(tmp, "profile", ".ollama", "models"), fromEnv: false });
  });
});

describe("listing", () => {
  it("matches a tag with a catalog entry, :latest and registry prefix included", () => {
    expect(catalogEntryForTag("qwen3-embedding:4b-q8_0")?.id).toBe("qwen3-embedding-4b-q8");
    expect(catalogEntryForTag("registry.ollama.ai/library/qwen3-embedding:8b")?.id).toBe("qwen3-embedding-8b-q4");
    expect(catalogEntryForTag("qwen3-embedding")).toBeUndefined();
    expect(catalogEntryForTag("qwen3-embedding:latest")).toBeUndefined();
  });

  it("reads dimension, context and pooling from /api/show", async () => {
    fakeOllama();
    expect(await ollamaShow("qwen3-embedding:0.6b")).toEqual({
      capabilities: ["embedding"],
      embedding: true,
      dims: 1024,
      contextLength: 32768,
      pooling: "last",
    });
  });

  it("flags a model split between GPU and CPU from /api/ps", async () => {
    fakeOllama();
    const [m] = await ollamaPs();
    expect(partlyOnCpu(m)).toBe(true);
    expect(partlyOnCpu({ ...m, vramMB: m.sizeMB })).toBe(false);
  });
});

describe("embed", () => {
  it("sends batches of 16 with the instruction added by the app, and logs the prompt tokens", async () => {
    fakeOllama();
    const before = ollamaUsage.promptTokens;
    const texts = Array.from({ length: 40 }, (_, i) => `passage ${i}`);
    const out = await ollamaRuntime.embed(model(), texts, "query");
    expect(out).toHaveLength(40);
    expect(out[17]).toEqual(Float32Array.from([1, 1, 0]));
    const embeds = calls.filter((c) => c.url.endsWith("/api/embed")).map((c) => JSON.parse(c.body ?? "{}"));
    expect(embeds.map((b) => b.input.length)).toEqual([16, 16, 8]);
    expect(embeds[0]).toMatchObject({ model: "qwen3-embedding:0.6b", truncate: true, keep_alive: "5m" });
    expect(embeds[0].dimensions).toBeUndefined();
    expect(embeds[0].input[0]).toBe("Instruct: Find railway passages\nQuery: passage 0");
    expect(ollamaUsage.promptTokens - before).toBe(40 * 7);
  });

  it("adds no instruction on the document side and passes a smaller dimension when chosen", async () => {
    fakeOllama();
    const m = model({ dims: 512 });
    m.entry = { ...m.entry, dimsOptions: [256, 512, 1024] };
    await ollamaRuntime.embed(m, ["doc text"], "doc");
    const body = JSON.parse(calls.find((c) => c.url.endsWith("/api/embed"))?.body ?? "{}");
    expect(body.input).toEqual(["doc text"]);
    expect(body.dimensions).toBe(512);
  });

  it("fails clearly when the count of vectors does not match", async () => {
    fakeOllama({ "/api/embed": () => json(200, { embeddings: [] }) });
    await expect(ollamaRuntime.embed(model(), ["a"], "doc")).rejects.toThrow(/0 vectors for 1 texts/);
  });

  it("probes dimension and context", async () => {
    fakeOllama();
    expect(await ollamaRuntime.probe(model())).toEqual({ dims: 3, maxTokens: 32768 });
  });

  it("has no rerank", async () => {
    await expect(ollamaRuntime.rerank(model(), "q", ["a"])).rejects.toThrow(/no rerank endpoint/);
  });
});

describe("pull and delete", () => {
  it("streams the pull progress, then returns the digest from the tags", async () => {
    fakeOllama();
    let sent: unknown = null;
    ollamaIo.stream = async (url, body, _signal, onLine) => {
      sent = { url, body };
      for (const l of [
        { status: "pulling manifest" },
        { status: "pulling abc", total: 100, completed: 40 },
        { status: "pulling abc", total: 100, completed: 100 },
        { status: "verifying sha256 digest" },
        { status: "success" },
      ])
        onLine(JSON.stringify(l));
    };
    const seen: unknown[] = [];
    const r = await ollamaPull("qwen3-embedding:0.6b", (p) => seen.push(p), new AbortController().signal);
    expect(r).toEqual({ digest: "abc123" });
    expect(sent).toEqual({
      url: "http://127.0.0.1:11434/api/pull",
      body: { model: "qwen3-embedding:0.6b", stream: true },
    });
    expect(seen[1]).toEqual({ status: "pulling abc", total: 100, completed: 40 });
    expect(seen).toHaveLength(5);
  });

  it("reports an error line from Ollama", async () => {
    fakeOllama();
    ollamaIo.stream = async (_u, _b, _s, onLine) =>
      onLine(JSON.stringify({ error: "pull model manifest: file does not exist" }));
    await expect(ollamaPull("nope:1b", () => {}, new AbortController().signal)).rejects.toThrow(/file does not exist/);
  });

  it("can be cancelled", async () => {
    fakeOllama();
    const ctrl = new AbortController();
    ollamaIo.stream = async (_u, _b, signal, onLine) => {
      onLine(JSON.stringify({ status: "pulling abc", total: 100, completed: 10 }));
      ctrl.abort();
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
    };
    await expect(ollamaPull("qwen3-embedding:0.6b", () => {}, ctrl.signal)).rejects.toThrow(/cancelled/);
  });

  it("refuses a tag with odd characters", async () => {
    fakeOllama();
    await expect(ollamaPull("a b;rm", () => {}, new AbortController().signal)).rejects.toThrow(
      /Not an Ollama model tag/,
    );
  });

  it("deletes through DELETE /api/delete", async () => {
    fakeOllama({ "/api/delete": () => ({ status: 200, headers: {}, text: "" }) });
    await ollamaDelete("qwen3-embedding:0.6b");
    const del = calls.find((c) => c.url.endsWith("/api/delete"));
    expect(del?.method).toBe("DELETE");
    expect(JSON.parse(del?.body ?? "{}")).toEqual({ model: "qwen3-embedding:0.6b" });
  });

  it("says when the model to delete does not exist", async () => {
    fakeOllama();
    await expect(ollamaDelete("ghost:1b")).rejects.toThrow(/no model ghost:1b/);
  });
});

describe("model identity: the weight layer, not the manifest", () => {
  const LAYER = "a".repeat(64);
  const withModelfile = (digest: string) =>
    fakeOllama({
      "/api/tags": () => json(200, { models: [{ name: "qwen3-embedding:0.6b", digest, size: 639 * MB, details: {} }] }),
      "/api/show": () =>
        json(200, {
          ...SHOW_06B,
          modelfile: `# Modelfile generated by "ollama show"\nFROM C:UsersJean Dupont.ollamamodels\blobssha256-${LAYER}\nTEMPLATE {{ .Prompt }}\nPARAMETER num_ctx 8192\n`,
        }),
    });

  it("reads the model layer from /api/show: a re-pull that changes only the manifest keeps the identity", async () => {
    withModelfile("manifest1");
    const one = (await ollamaStatus()).models[0];
    expect(one.digest).toBe(`sha256:${LAYER}`);
    withModelfile("manifest2");
    const two = (await ollamaStatus()).models[0];
    expect(two.digest).toBe(one.digest);
    const a = fingerprintOf(model({ digest: one.digest }));
    const b = fingerprintOf(model({ digest: two.digest }));
    expect(a.model).toBe(`sha256:${LAYER}`);
    expect(spaceId(a)).toBe(spaceId(b));
  });

  it("a pull returns the layer digest", async () => {
    withModelfile("manifest1");
    ollamaIo.stream = async (_u, _b, _s, onLine) => onLine(JSON.stringify({ status: "success" }));
    expect(await ollamaPull("qwen3-embedding:0.6b", () => {}, new AbortController().signal)).toEqual({
      digest: `sha256:${LAYER}`,
    });
  });

  it("falls back to the manifest on disk (layer application/vnd.ollama.image.model)", async () => {
    const store = join(tmp, "ollama-models");
    process.env.OLLAMA_MODELS = store;
    const dir = join(store, "manifests", "registry.ollama.ai", "library", "qwen3-embedding");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "0.6b"),
      JSON.stringify({
        schemaVersion: 2,
        config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: `sha256:${"c".repeat(64)}` },
        layers: [
          { mediaType: "application/vnd.ollama.image.template", digest: `sha256:${"d".repeat(64)}` },
          { mediaType: "application/vnd.ollama.image.model", digest: `sha256:${"b".repeat(64)}` },
        ],
      }),
    );
    fakeOllama();
    expect((await ollamaStatus()).models.find((m) => m.name === "qwen3-embedding:0.6b")?.digest).toBe(
      `sha256:${"b".repeat(64)}`,
    );
    expect(manifestFile("user/emb:2b", store)).toBe(
      join(store, "manifests", "registry.ollama.ai", "user", "emb", "2b"),
    );
  });
});
