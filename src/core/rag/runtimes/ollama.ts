import { existsSync, readFileSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import { catalog, registryFile } from "../../lib/models-catalog.ts";
import {
  addTokens,
  currentOp,
  isMemoryError,
  loadFailedForMemory,
  notePartial,
  perfFields,
  perfScope,
  recordPerf,
} from "../../lib/models-perf.ts";
import { readJson, readSettings } from "../../lib/project.ts";
import type { CatalogEntry, LoadedModel, ModelsRegistry, ResolvedModel } from "../../types.ts";
import type { Runtime } from "./types.ts";

export type OllamaModel = {
  name: string;
  digest: string;
  sizeMB: number;
  quantization: string;
  embedding: boolean;
  catalogId?: string;
  dims?: number;
  contextLength?: number;
  pooling?: string;
};
export type OllamaStatus = {
  state: "absent" | "stopped" | "running" | "disabled" | "refused";
  version?: string;
  host: string;
  exe?: string;
  storage: { dir: string; freeMB: number | null; fromEnv: boolean };
  models: OllamaModel[];
  loaded: LoadedModel[];
  message: string;
};
export type OllamaTag = { name: string; digest: string; sizeMB: number; quantization: string };
export type OllamaShow = {
  capabilities: string[];
  embedding: boolean;
  dims?: number;
  contextLength?: number;
  pooling?: string;
  layer?: string;
};

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const OLLAMA_BATCH = 16;
export const ollamaOptions = { keepAlive: "5m" as string | number };
export const ollamaUsage = { calls: 0, texts: 0, promptTokens: 0, lastPromptTokens: 0 };

const MB = 1024 * 1024;
const POOLING = ["none", "mean", "cls", "last", "rank"];

// ponytail: same parsing as Ollama's own envconfig.Host — no scheme means http and port 11434; 0.0.0.0 is a bind address, the client reaches it on loopback
export function normalizeOllamaHost(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  const scheme = m ? m[1].toLowerCase() : "http";
  const rest = (m ? m[2] : s).replace(/\/+$/, "");
  const defaultPort = !m ? "11434" : scheme === "https" ? "443" : "80";
  const u = new URL(`${scheme}://${rest || "127.0.0.1"}`);
  let host = u.hostname || "127.0.0.1";
  if (host === "0.0.0.0") host = "127.0.0.1";
  if (host === "[::]") host = "[::1]";
  return `${scheme}://${host}:${u.port || defaultPort}`;
}

export function isLoopbackHost(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);
}

export function ollamaHost(): string {
  const fromEnv = process.env.OLLAMA_HOST?.trim();
  const fromRegistry = readJson<Partial<ModelsRegistry>>(registryFile(), {}).ollama?.host;
  return normalizeOllamaHost(fromEnv || fromRegistry || DEFAULT_OLLAMA_HOST);
}

export function ollamaExe(): string {
  return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Programs", "Ollama", "ollama.exe");
}

export function freeMBAt(dir: string): number | null {
  let d = dir;
  while (!existsSync(d)) {
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  try {
    const s = statfsSync(d);
    return Math.round((Number(s.bavail) * Number(s.bsize)) / MB);
  } catch {
    return null;
  }
}

export function ollamaStorage(): OllamaStatus["storage"] {
  const fromEnv = process.env.OLLAMA_MODELS?.trim();
  const dir = fromEnv || join(process.env.USERPROFILE || homedir(), ".ollama", "models");
  return { dir, freeMB: freeMBAt(dir), fromEnv: !!fromEnv };
}

function disabled(): boolean {
  return readSettings().models.useOllama === "never";
}

function usableHost(): string {
  if (disabled())
    throw new UserError(
      "Ollama is turned off on this PC.",
      'Set models.useOllama to "auto" in Settings to let Testimus use it.',
    );
  const host = ollamaHost();
  if (!isLoopbackHost(host))
    throw new UserError(
      `Ollama host ${host} is not on this PC: refused (documents would leave the machine).`,
      "Point OLLAMA_HOST or models.json ollama.host at 127.0.0.1.",
    );
  return host;
}

function errorText(text: string | undefined): string {
  try {
    const j = JSON.parse(text ?? "") as { error?: unknown };
    if (typeof j.error === "string") return j.error;
  } catch {}
  return (text ?? "").slice(0, 200);
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
  const res = await env.http({
    method,
    url: usableHost() + path,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
  });
  if (res.status !== 200)
    throw new UserError(`Ollama ${method} ${path} failed: HTTP ${res.status} ${errorText(res.text)}`);
  return JSON.parse(res.text || "{}") as T;
}

function sameTag(a: string, b: string): boolean {
  const norm = (t: string) => {
    const s = t.toLowerCase().replace(/^registry\.ollama\.ai\/library\//, "");
    return s.includes(":") ? s : `${s}:latest`;
  };
  return norm(a) === norm(b);
}

export function catalogEntryForTag(tag: string, entries: CatalogEntry[] = catalog().entries): CatalogEntry | undefined {
  return entries.find((e) => e.source.ollama && sameTag(e.source.ollama, tag));
}

export async function ollamaTags(): Promise<OllamaTag[]> {
  const j = await call<{
    models?: {
      name: string;
      model?: string;
      digest: string;
      size: number;
      details?: { quantization_level?: string };
    }[];
  }>("GET", "/api/tags");
  return (j.models ?? []).map((m) => ({
    name: m.name || m.model || "",
    digest: m.digest,
    sizeMB: Math.round(m.size / MB),
    quantization: m.details?.quantization_level ?? "",
  }));
}

// ponytail: /api/show lists no layers, but its modelfile says FROM <models>lobs\sha256-<hex>: the weight layer
export function layerFromModelfile(modelfile: string | undefined): string | undefined {
  const m = modelfile?.match(/^FROM\s+.*?sha256[-:]([0-9a-f]{64})\s*$/im);
  return m ? `sha256:${m[1].toLowerCase()}` : undefined;
}

export function manifestFile(tag: string, dir = ollamaStorage().dir): string {
  const parts = tag.split("/");
  const last = parts.pop() ?? "";
  const colon = last.lastIndexOf(":");
  const name = colon < 0 ? last : last.slice(0, colon);
  const version = colon < 0 ? "latest" : last.slice(colon + 1);
  const host = parts.length >= 2 ? parts.shift() : "registry.ollama.ai";
  const ns = parts.length ? parts : ["library"];
  return join(dir, "manifests", host ?? "registry.ollama.ai", ...ns, name, version);
}

export function layerFromManifest(tag: string, dir = ollamaStorage().dir): string | undefined {
  try {
    const j = JSON.parse(readFileSync(manifestFile(tag, dir), "utf8")) as {
      layers?: { mediaType?: string; digest?: string }[];
    };
    return j.layers?.find((l) => l.mediaType === "application/vnd.ollama.image.model")?.digest;
  } catch {
    return undefined;
  }
}

export async function ollamaShow(tag: string): Promise<OllamaShow> {
  const j = await call<{ capabilities?: string[]; model_info?: Record<string, unknown>; modelfile?: string }>(
    "POST",
    "/api/show",
    { model: tag },
  );
  const info = j.model_info ?? {};
  const arch = String(info["general.architecture"] ?? "");
  const num = (k: string) => (typeof info[`${arch}.${k}`] === "number" ? (info[`${arch}.${k}`] as number) : undefined);
  const pooling = num("pooling_type");
  const capabilities = j.capabilities ?? [];
  return {
    capabilities,
    embedding: capabilities.includes("embedding"),
    dims: num("embedding_length"),
    contextLength: num("context_length"),
    pooling: pooling === undefined ? undefined : (POOLING[pooling] ?? String(pooling)),
    layer: layerFromModelfile(j.modelfile),
  };
}

export async function ollamaPs(): Promise<LoadedModel[]> {
  const j = await call<{ models?: { name: string; model?: string; size: number; size_vram?: number }[] }>(
    "GET",
    "/api/ps",
  );
  return (j.models ?? []).map((m) => ({
    name: m.name || m.model || "",
    sizeMB: Math.round(m.size / MB),
    vramMB: Math.round((m.size_vram ?? 0) / MB),
    runtime: "ollama" as const,
  }));
}

export function partlyOnCpu(m: LoadedModel): boolean {
  return m.vramMB < m.sizeMB;
}

export async function ollamaModels(): Promise<OllamaModel[]> {
  const entries = catalog().entries;
  const out: OllamaModel[] = [];
  for (const t of await ollamaTags()) {
    const show = await ollamaShow(t.name).catch(() => null);
    out.push({
      ...t,
      digest: show?.layer ?? layerFromManifest(t.name) ?? t.digest,
      embedding: show?.embedding ?? false,
      catalogId: catalogEntryForTag(t.name, entries)?.id,
      dims: show?.dims,
      contextLength: show?.contextLength,
      pooling: show?.pooling,
    });
  }
  return out;
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  const host = ollamaHost();
  const storage = ollamaStorage();
  const base = { host, storage, models: [] as OllamaModel[], loaded: [] as LoadedModel[] };
  if (disabled())
    return { ...base, state: "disabled", message: 'Ollama is turned off on this PC (models.useOllama = "never").' };
  if (!isLoopbackHost(host))
    return {
      ...base,
      state: "refused",
      message: `Ollama host ${host} is not on this PC: refused, only a loopback host is accepted (documents would leave the machine).`,
    };
  let version: string | undefined;
  try {
    const res = await env.http({ method: "GET", url: `${host}/api/version`, timeoutMs: 2000 });
    if (res.status === 200) version = (JSON.parse(res.text || "{}") as { version?: string }).version ?? "unknown";
  } catch {}
  if (version === undefined) {
    const exe = ollamaExe();
    if (existsSync(exe))
      return {
        ...base,
        state: "stopped",
        exe,
        message: "Ollama is installed but not running. Start Ollama, then Refresh.",
      };
    return {
      ...base,
      state: "absent",
      message:
        "Ollama is not installed. It is optional: every model also runs without it (llama.cpp or transformers.js).",
    };
  }
  const exe = existsSync(ollamaExe()) ? ollamaExe() : undefined;
  const models = await ollamaModels();
  const loaded = await ollamaPs().catch(() => []);
  const n = models.filter((m) => m.embedding).length;
  return {
    ...base,
    state: "running",
    version,
    exe,
    models,
    loaded,
    message: `Ollama ${version} is running at ${host}: ${n} embedding model${n === 1 ? "" : "s"}.`,
  };
}

function checkTag(tag: string): string {
  if (!/^[\w.\-/:]+$/.test(tag)) throw new UserError(`Not an Ollama model tag: ${tag}`);
  return tag;
}

export const ollamaIo = {
  async stream(url: string, body: unknown, signal: AbortSignal, onLine: (line: string) => void): Promise<void> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body)
      throw new UserError(
        `Ollama POST ${new URL(url).pathname} failed: HTTP ${res.status} ${errorText(await res.text())}`,
      );
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) onLine(l);
    }
    if (pending.trim()) onLine(pending);
  },
};

export async function ollamaPull(
  tag: string,
  onProgress: (p: { status: string; completed?: number; total?: number }) => void,
  signal: AbortSignal,
): Promise<{ digest: string }> {
  const host = usableHost();
  let failure: string | null = null;
  let success = false;
  try {
    await ollamaIo.stream(`${host}/api/pull`, { model: checkTag(tag), stream: true }, signal, (line) => {
      const j = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (j.error) failure = j.error;
      else if (j.status) {
        if (j.status === "success") success = true;
        onProgress({ status: j.status, completed: j.completed, total: j.total });
      }
    });
  } catch (e) {
    if (!signal.aborted) throw e;
  }
  if (signal.aborted) throw new UserError(`Ollama pull of ${tag} cancelled.`);
  if (failure || !success)
    throw new UserError(`Ollama could not pull ${tag}: ${failure ?? "the download stopped early"}`);
  const hit = (await ollamaTags()).find((t) => sameTag(t.name, tag));
  if (!hit) throw new UserError(`Ollama pulled ${tag} but does not list it.`);
  const show = await ollamaShow(hit.name).catch(() => null);
  return { digest: show?.layer ?? layerFromManifest(hit.name) ?? hit.digest };
}

export async function ollamaDelete(tag: string): Promise<void> {
  const res = await env.http({
    method: "DELETE",
    url: `${usableHost()}/api/delete`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: checkTag(tag) }),
    timeoutMs: 30000,
  });
  if (res.status === 404) throw new UserError(`Ollama has no model ${tag}.`);
  if (res.status !== 200)
    throw new UserError(`Ollama could not delete ${tag}: HTTP ${res.status} ${errorText(res.text)}`);
}

const loadedByUs = new Set<string>();

export async function ollamaUnload(tag: string): Promise<void> {
  await call("POST", "/api/embed", { model: checkTag(tag), input: [], keep_alive: 0 }, 30000);
  loadedByUs.delete(tag);
}

export async function ollamaUnloadOurs(): Promise<void> {
  for (const tag of [...loadedByUs]) await ollamaUnload(tag).catch(() => {});
}

function tagOf(m: ResolvedModel): string {
  const tag = m.install.ollama ?? m.entry.source.ollama;
  if (!tag) throw new UserError(`${m.entry.label} is not an Ollama model.`);
  return checkTag(tag);
}

export function instructionFor(m: ResolvedModel, mode: "query" | "doc"): string {
  return mode === "query" ? m.entry.queryInstruction.replaceAll("{task}", m.queryTask) : m.entry.docInstruction;
}

async function embed(m: ResolvedModel, texts: string[], mode: "query" | "doc"): Promise<Float32Array[]> {
  const tag = tagOf(m);
  const prefix = instructionFor(m, mode);
  const dims = m.install.dims && m.entry.dimsOptions?.includes(m.install.dims) ? m.install.dims : undefined;
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += OLLAMA_BATCH) {
    const input = texts.slice(i, i + OLLAMA_BATCH).map((t) => prefix + t);
    const fresh = !loadedByUs.has(tag);
    const t0 = performance.now();
    let j: { embeddings?: number[][]; prompt_eval_count?: number; load_duration?: number };
    try {
      j = await call<typeof j>(
        "POST",
        "/api/embed",
        {
          model: tag,
          input,
          truncate: true,
          keep_alive: ollamaOptions.keepAlive,
          ...(dims ? { dimensions: dims } : {}),
        },
        300000,
      );
    } catch (e) {
      if (fresh && isMemoryError(e)) {
        const ms = performance.now() - t0;
        const op = currentOp();
        if (op) op.loadMs += ms;
        loadFailedForMemory(perfFields(m), ms, op);
      }
      throw e;
    }
    loadedByUs.add(tag);
    if (fresh && j.load_duration !== undefined) await recordLoad(m, tag, j.load_duration / 1e6);
    if (offloaded.has(tag)) notePartial(offloaded.get(tag) === true);
    if (!j.embeddings || j.embeddings.length !== input.length)
      throw new UserError(`Ollama returned ${j.embeddings?.length ?? 0} vectors for ${input.length} texts (${tag}).`);
    ollamaUsage.calls++;
    ollamaUsage.texts += input.length;
    ollamaUsage.promptTokens += j.prompt_eval_count ?? 0;
    ollamaUsage.lastPromptTokens = j.prompt_eval_count ?? 0;
    if (j.prompt_eval_count) addTokens(j.prompt_eval_count);
    for (const v of j.embeddings) out.push(Float32Array.from(v));
  }
  return out;
}

const offloaded = new Map<string, boolean>();

// ponytail: Ollama loads on the first request and says how long it took; /api/ps then tells whether it all fit on the GPU
async function recordLoad(m: ResolvedModel, tag: string, loadMs: number): Promise<void> {
  const op = currentOp();
  if (op) op.loadMs += loadMs;
  let held: LoadedModel | undefined;
  try {
    held = (await ollamaPs()).find((x) => sameTag(x.name, tag));
  } catch {}
  if (held) offloaded.set(tag, partlyOnCpu(held));
  recordPerf({
    at: env.now().toISOString(),
    op: "model.load",
    ...perfFields(m),
    ...perfScope(),
    items: 1,
    ms: Math.round(loadMs),
    loadMs: Math.round(loadMs),
    ...(held ? { vramMB: held.vramMB, partialOffload: partlyOnCpu(held) } : {}),
  });
}

export const ollamaRuntime: Runtime = {
  probe: async (m) => {
    const show = await ollamaShow(tagOf(m));
    if (!show.embedding) throw new UserError(`Ollama model ${tagOf(m)} is not an embedding model.`);
    const [v] = await embed(m, ["Testimus probe sentence."], "doc");
    return { dims: v.length, maxTokens: show.contextLength ?? m.entry.maxInputTokens };
  },
  embed,
  rerank: async (m) => {
    throw new UserError(
      `Ollama has no rerank endpoint: ${m.entry.label} cannot run through Ollama.`,
      "Run the reranker through llama.cpp or transformers.js.",
    );
  },
};
