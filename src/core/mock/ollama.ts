import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HttpReq, HttpRes } from "../env.ts";
import { fakeVector } from "../rag/runtimes/mock.ts";
import { ollamaExe, ollamaHost, ollamaIo } from "../rag/runtimes/ollama.ts";
import type { LoadedModel } from "../types.ts";

export const MOCK_OLLAMA_STATES = ["absent", "stopped", "running"] as const;
export type MockOllamaState = (typeof MOCK_OLLAMA_STATES)[number];

type Tag = { name: string; size: number; quant: string; embedding: boolean; dims: number; ctx: number; arch: string };

const MB = 1024 * 1024;
const VERSION = "0.12.6";

const SHIPPED_TAGS: Tag[] = [
  {
    name: "qwen3-embedding:0.6b",
    size: 639 * MB,
    quant: "Q8_0",
    embedding: true,
    dims: 1024,
    ctx: 32768,
    arch: "qwen3",
  },
  {
    name: "qwen3-embedding:4b",
    size: 2497 * MB,
    quant: "Q4_K_M",
    embedding: true,
    dims: 2560,
    ctx: 40960,
    arch: "qwen3",
  },
  { name: "llama3.2:3b", size: 2019 * MB, quant: "Q4_K_M", embedding: false, dims: 3072, ctx: 131072, arch: "llama" },
];
const PULLABLE: Tag[] = [
  {
    name: "qwen3-embedding:4b-q8_0",
    size: 4280 * MB,
    quant: "Q8_0",
    embedding: true,
    dims: 2560,
    ctx: 40960,
    arch: "qwen3",
  },
  {
    name: "qwen3-embedding:8b",
    size: 4676 * MB,
    quant: "Q4_K_M",
    embedding: true,
    dims: 4096,
    ctx: 40960,
    arch: "qwen3",
  },
  {
    name: "qwen3-embedding:8b-q8_0",
    size: 8047 * MB,
    quant: "Q8_0",
    embedding: true,
    dims: 4096,
    ctx: 40960,
    arch: "qwen3",
  },
];

// ponytail: the 4B model is loaded with less than its size on the GPU — Ollama's « partly on the processor »
export const MOCK_OLLAMA_LOADED: LoadedModel = {
  name: "qwen3-embedding:4b",
  sizeMB: 4300,
  vramMB: 2900,
  runtime: "ollama",
};

export const mockOllama = {
  state: "absent" as MockOllamaState,
  tags: [...SHIPPED_TAGS],
  pullMs: 2500,
};

export function mockOllamaState(raw = process.env.TESTIMUS_MOCK_OLLAMA): MockOllamaState {
  return (MOCK_OLLAMA_STATES as readonly string[]).includes(raw ?? "") ? (raw as MockOllamaState) : "absent";
}

const norm = (t: string) => (t.includes(":") ? t : `${t}:latest`).toLowerCase();
const find = (name: string) => mockOllama.tags.find((t) => norm(t.name) === norm(name));
const digestOf = (name: string) => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
};
const json = (body: unknown, status = 200): HttpRes => ({ status, headers: {}, text: JSON.stringify(body) });

function refused(url: string): Error {
  return new TypeError(`fetch failed (mock Ollama ${mockOllama.state}: connect ECONNREFUSED ${new URL(url).host})`);
}

export function isOllamaUrl(url: string): boolean {
  return url.startsWith(ollamaHost());
}

export async function ollamaHttp(req: HttpReq): Promise<HttpRes> {
  if (mockOllama.state !== "running") throw refused(req.url);
  const path = new URL(req.url).pathname;
  const body = () => JSON.parse(req.body || "{}") as { model?: string; input?: string[] | string };
  if (path === "/api/version") return json({ version: VERSION });
  if (path === "/api/tags")
    return json({
      models: mockOllama.tags.map((t) => ({
        name: t.name,
        model: t.name,
        digest: digestOf(t.name),
        size: t.size,
        details: { quantization_level: t.quant, family: t.arch },
      })),
    });
  if (path === "/api/ps")
    return json({
      models: [MOCK_OLLAMA_LOADED]
        .filter((l) => find(l.name))
        .map((l) => ({ name: l.name, model: l.name, size: l.sizeMB * MB, size_vram: l.vramMB * MB })),
    });
  if (path === "/api/show") {
    const t = find(body().model ?? "");
    if (!t) return json({ error: `model '${body().model}' not found` }, 404);
    return json({
      capabilities: t.embedding ? ["embedding"] : ["completion"],
      model_info: {
        "general.architecture": t.arch,
        [`${t.arch}.embedding_length`]: t.dims,
        [`${t.arch}.context_length`]: t.ctx,
        ...(t.embedding ? { [`${t.arch}.pooling_type`]: 3 } : {}),
      },
    });
  }
  if (path === "/api/embed") {
    const b = body();
    const t = find(b.model ?? "");
    if (!t) return json({ error: `model "${b.model}" not found, try pulling it first` }, 404);
    if (!t.embedding) return json({ error: `"${b.model}" does not support embeddings` }, 400);
    const input = Array.isArray(b.input) ? b.input : b.input ? [b.input] : [];
    return json({
      model: t.name,
      embeddings: input.map((s) => Array.from(fakeVector(s, t.dims))),
      prompt_eval_count: input.reduce((a, s) => a + s.split(/\s+/).length, 0),
    });
  }
  if (path === "/api/delete" && req.method === "DELETE") {
    const t = find(body().model ?? "");
    if (!t) return json({ error: `model '${body().model}' not found` }, 404);
    mockOllama.tags = mockOllama.tags.filter((x) => x !== t);
    return json({});
  }
  return json({ error: `mock Ollama: no route ${req.method} ${path}` }, 404);
}

async function pullStream(url: string, body: unknown, signal: AbortSignal, onLine: (line: string) => void) {
  if (mockOllama.state !== "running") throw refused(url);
  const name = String((body as { model?: string }).model ?? "");
  const known = find(name) ?? PULLABLE.find((t) => norm(t.name) === norm(name));
  if (!known) {
    onLine(JSON.stringify({ status: "pulling manifest" }));
    onLine(JSON.stringify({ error: "pull model manifest: file does not exist" }));
    return;
  }
  onLine(JSON.stringify({ status: "pulling manifest" }));
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    await new Promise((r) => setTimeout(r, mockOllama.pullMs / steps));
    onLine(
      JSON.stringify({
        status: `pulling ${digestOf(known.name).slice(0, 12)}`,
        digest: `sha256:${digestOf(known.name)}`,
        total: known.size,
        completed: Math.round((known.size * i) / steps),
      }),
    );
  }
  for (const status of ["verifying sha256 digest", "writing manifest", "success"]) onLine(JSON.stringify({ status }));
  if (!find(known.name)) mockOllama.tags.push(known);
}

export function setupOllamaMock(state: MockOllamaState): void {
  mockOllama.state = state;
  mockOllama.tags = [...SHIPPED_TAGS];
  mockOllama.pullMs = Number(process.env.TESTIMUS_MOCK_DOWNLOAD_MS) || 2500;
  if (state !== "absent") {
    mkdirSync(dirname(ollamaExe()), { recursive: true });
    writeFileSync(ollamaExe(), "");
  }
  ollamaIo.stream = (url, body, signal, onLine) =>
    new URL(url).pathname === "/api/pull" ? pullStream(url, body, signal, onLine) : Promise.reject(refused(url));
}
